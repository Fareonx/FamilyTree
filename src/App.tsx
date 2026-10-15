import { useEffect, useMemo, useRef, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { AuthScreen } from './components/AuthScreen';
import { DataDialog } from './components/DataDialog';
import { LangSwitch } from './components/LangSwitch';
import { PeopleList } from './components/PeopleList';
import { PersonPanel } from './components/PersonPanel';
import { searchPersons, personContext } from './components/PersonPicker';
import { TreeView, type TreeViewHandle } from './components/TreeView';
import { useI18n } from './i18n';
import { buildLayout, type PlacedCard, type ViewMode } from './lib/layout';
import { displayName } from './lib/names';
import { emptyChanges } from './lib/ops';
import { emptyPerson } from './lib/types';
import { LocalStore } from './store/local';
import type { Store } from './store/store';
import { supabase, SupabaseStore } from './store/supabase';
import { useTree } from './useTree';

type Role = 'editor' | 'viewer';

export default function App() {
  const { t } = useI18n();
  const [session, setSession] = useState<Session | null | undefined>(supabase ? undefined : null);
  const [role, setRole] = useState<Role | null | undefined>(supabase ? undefined : 'editor');

  useEffect(() => {
    if (!supabase) return;
    void supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!supabase || !session) return;
    setRole(undefined);
    void supabase
      .from('app_users')
      .select('role')
      .eq('email', session.user.email?.toLowerCase() ?? '')
      .then(({ data }) => setRole((data?.[0]?.role as Role | undefined) ?? null));
  }, [session]);

  const store = useMemo<Store | null>(() => {
    if (!supabase) return new LocalStore();
    return session && role ? new SupabaseStore(supabase) : null;
  }, [session, role]);

  if (supabase && session === undefined) return <div className="center muted">{t('loading')}</div>;
  if (supabase && !session) return <AuthScreen client={supabase} />;
  if (supabase && role === undefined) return <div className="center muted">{t('loading')}</div>;
  if (supabase && role === null)
    return (
      <div className="center col">
        <p>{t('noAccess')}</p>
        <p className="muted small">{session?.user.email}</p>
        <button onClick={() => void supabase!.auth.signOut()}>{t('signOut')}</button>
      </div>
    );
  return <Workspace store={store!} editable={role === 'editor'} />;
}

function Workspace({ store, editable }: { store: Store; editable: boolean }) {
  const { t } = useI18n();
  const tree = useTree(store);
  const { data, graph } = tree;
  const [view, setView] = useState<'tree' | 'people'>('tree');
  const [mode, setMode] = useState<ViewMode>('family');
  const [focusId, setFocusId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editNew, setEditNew] = useState(false);
  const [showData, setShowData] = useState(false);
  const [q, setQ] = useState('');
  const treeRef = useRef<TreeViewHandle>(null);
  const centeredOnce = useRef(false);

  const effectiveFocus = focusId ?? tree.homeId ?? data?.persons[0]?.id ?? null;
  const layout = useMemo(() => (graph ? buildLayout(graph, mode, effectiveFocus) : null), [graph, mode, effectiveFocus]);

  // First render: show the home person.
  useEffect(() => {
    if (!layout || centeredOnce.current || !layout.cards.length) return;
    centeredOnce.current = true;
    requestAnimationFrame(() => {
      if (effectiveFocus && layout.primary.has(effectiveFocus)) treeRef.current?.centerOn(effectiveFocus, { zoomTo: 0.85 });
      else treeRef.current?.fit();
    });
  }, [layout, effectiveFocus]);

  const select = (id: string, opts: { edit?: boolean } = {}) => {
    setSelectedId(id);
    setEditNew(!!opts.edit);
  };

  const goTo = (id: string) => {
    setView('tree');
    select(id);
    requestAnimationFrame(() => treeRef.current?.centerOn(id, { flash: true }));
  };

  const changeMode = (m: ViewMode) => {
    setMode(m);
    requestAnimationFrame(() => {
      if (effectiveFocus) treeRef.current?.centerOn(effectiveFocus, { zoomTo: 0.8 });
    });
  };

  const onGhost = (card: PlacedCard) => {
    if (card.ref.kind !== 'ghost' || !graph) return;
    const child = card.ref.forChild ?? (card.ref.unionId ? graph.childrenOf(card.ref.unionId)[0] : undefined);
    if (child) select(child);
  };

  const addFirst = async () => {
    const id = crypto.randomUUID();
    const ch = emptyChanges();
    ch.upsertPersons.push(emptyPerson(id));
    await tree.apply(ch);
    if (!tree.homeId) await tree.setHomeId(id);
    select(id, { edit: true });
  };

  const results = useMemo(() => (graph && q.trim() ? searchPersons(graph, q, 12) : []), [graph, q]);

  if (tree.error && !data) return <div className="center error">{tree.error}</div>;
  if (!data || !graph || !layout) return <div className="center muted">{t('loading')}</div>;

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">🌳 <span className="brand-text">{t('appTitle')}</span></div>
        <nav className="segmented" aria-label="view">
          <button className={view === 'tree' ? 'active' : ''} onClick={() => setView('tree')}>
            {t('tree')}
          </button>
          <button className={view === 'people' ? 'active' : ''} onClick={() => setView('people')}>
            {t('people')} <span className="muted">{data.persons.length}</span>
          </button>
        </nav>
        {view === 'tree' && (
          <nav className="segmented" aria-label="mode">
            {(
              [
                ['family', 'modeFamily'],
                ['ancestors', 'modeAncestors'],
                ['descendants', 'modeDescendants'],
              ] as const
            ).map(([m, label]) => (
              <button key={m} className={mode === m ? 'active' : ''} onClick={() => changeMode(m)}>
                {t(label)}
              </button>
            ))}
          </nav>
        )}
        <div className="search" hidden={view !== 'tree'}>
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('search')} aria-label={t('search')} />
          {results.length > 0 && (
            <ul className="search-results">
              {results.map((p) => (
                <li key={p.id}>
                  <button
                    onClick={() => {
                      setQ('');
                      goTo(p.id);
                    }}
                  >
                    <span>{displayName(p)}</span>
                    <span className="muted small">{personContext(graph, p)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="topbar-right">
          <span className={`save-state save-${tree.saveState}`}>
            {tree.saveState === 'saving' ? t('saving') : tree.saveState === 'saved' ? t('saved') : tree.saveState === 'error' ? t('error') : ''}
          </span>
          {!editable && <span className="badge">{t('readOnly')}</span>}
          <button onClick={() => setShowData(true)}>{t('data')}</button>
          <LangSwitch />
          {supabase && (
            <button className="link-btn" onClick={() => void supabase!.auth.signOut()}>
              {t('signOut')}
            </button>
          )}
        </div>
      </header>

      {store.kind === 'local' && <div className="banner">{t('localMode')}</div>}
      {tree.error && (
        <div className="banner banner-error" onClick={() => tree.setError(null)}>
          {t('error')}: {tree.error}
        </div>
      )}

      <main className="main">
        {view === 'tree' ? (
          data.persons.length ? (
            <>
              <TreeView
                ref={treeRef}
                layout={layout}
                graph={graph}
                photoUrls={tree.photoUrls}
                selectedId={selectedId}
                homeId={tree.homeId}
                onSelect={(id) => select(id)}
                onGhost={onGhost}
              />
              <div className="zoom-controls">
                <button onClick={() => treeRef.current?.zoomBy(1.25)} aria-label={t('zoomIn')} title={t('zoomIn')}>
                  +
                </button>
                <button onClick={() => treeRef.current?.zoomBy(0.8)} aria-label={t('zoomOut')} title={t('zoomOut')}>
                  −
                </button>
                <button onClick={() => treeRef.current?.fit()} title={t('fit')} aria-label={t('fit')}>
                  ⤢
                </button>
                {effectiveFocus && (
                  <button onClick={() => treeRef.current?.centerOn(effectiveFocus, { flash: true })} title={t('findMe')} aria-label={t('findMe')}>
                    ◎
                  </button>
                )}
              </div>
              {effectiveFocus && (
                <div className="focus-chip">
                  {t('focus')}: <strong>{displayName(graph.person(effectiveFocus))}</strong>
                </div>
              )}
            </>
          ) : (
            <div className="center col">
              <p className="muted">{t('emptyTree')}</p>
              {editable && (
                <button className="primary" onClick={() => void addFirst()}>
                  {t('addFirst')}
                </button>
              )}
            </div>
          )
        ) : (
          <PeopleList graph={graph} homeId={tree.homeId} onOpen={(id) => select(id)} />
        )}

        {selectedId && graph.person(selectedId) && (
          <PersonPanel
            graph={graph}
            data={data}
            store={store}
            personId={selectedId}
            homeId={tree.homeId}
            photoUrls={tree.photoUrls}
            occurrences={layout.occurrences.get(selectedId) ?? 0}
            editable={editable}
            startEditing={editNew}
            apply={tree.apply}
            onSelect={(id, opts) => {
              select(id, opts);
              if (view === 'tree') requestAnimationFrame(() => treeRef.current?.centerOn(id));
            }}
            onFocus={(id) => {
              setFocusId(id);
              setView('tree');
              requestAnimationFrame(() => treeRef.current?.centerOn(id, { flash: true }));
            }}
            onSetHome={(id) => void tree.setHomeId(id)}
            onGoToMain={(id) => goTo(id)}
            onClose={() => setSelectedId(null)}
          />
        )}
      </main>

      {showData && (
        <DataDialog data={data} editable={editable} apply={tree.apply} replaceAll={tree.replaceAll} onClose={() => setShowData(false)} />
      )}
    </div>
  );
}
