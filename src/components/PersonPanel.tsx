import { useEffect, useRef, useState } from 'react';
import type { FamilyGraph } from '../lib/graph';
import { ageAt, formatDate, parseDateInput } from '../lib/dates';
import { compressImage } from '../lib/image';
import { displayName, lifeSpan, shortName } from '../lib/names';
import { addRelative, deletePerson, emptyChanges, mergePersons, removeParentLink, removePartner, type AddKind, type ChangeSet } from '../lib/ops';
import type { Gender, Person, TreeData } from '../lib/types';
import type { Store } from '../store/store';
import { useI18n, type TKey } from '../i18n';
import { KinshipBox } from './Kinship';
import { PersonPicker } from './PersonPicker';

interface Props {
  graph: FamilyGraph;
  data: TreeData;
  store: Store;
  personId: string;
  homeId: string | null;
  photoUrls: Map<string, string>;
  occurrences: number;
  editable: boolean;
  startEditing?: boolean;
  apply(ch: ChangeSet): Promise<void>;
  onSelect(id: string, opts?: { edit?: boolean }): void;
  onFocus(id: string): void;
  onSetHome(id: string): void;
  onGoToMain(id: string): void;
  onClose(): void;
}

export function PersonPanel(props: Props) {
  const { graph, personId, editable } = props;
  const { t } = useI18n();
  const p = graph.person(personId);
  const [editing, setEditing] = useState(!!props.startEditing);
  const [adding, setAdding] = useState<AddKind | null>(null);
  const [merging, setMerging] = useState(false);

  useEffect(() => {
    setEditing(!!props.startEditing);
    setAdding(null);
    setMerging(false);
  }, [personId, props.startEditing]);

  if (!p) return null;
  const photo = p.photo_path ? props.photoUrls.get(p.photo_path) : undefined;
  const age = !p.is_deceased && !p.death_date ? ageAt(p.birth_date) : p.death_date ? ageAt(p.birth_date, p.death_date) : null;

  const rel = (id: string, extra?: React.ReactNode) => {
    const r = graph.person(id);
    return (
      <li key={id}>
        <button className={`rel-chip rel-chip-${r?.gender ?? 'unknown'}`} onClick={() => props.onSelect(id)}>
          <span>{displayName(r)}</span>
          <span className="muted small">{r ? lifeSpan(r) : ''}</span>
        </button>
        {extra}
      </li>
    );
  };
  const unlinkBtn = (ch: () => ChangeSet) =>
    editable && editing ? (
      <button className="icon-btn" title={t('unlink')} onClick={() => confirm(t('confirmUnlink')) && void props.apply(ch())}>
        ✕
      </button>
    ) : null;

  const parentUnion = graph.parentUnion(personId);
  const siblings = graph.siblingsOf(personId);
  const unions = graph.unionsOf(personId);

  return (
    <aside className="panel" aria-label={displayName(p)}>
      <div className="panel-head">
        <button className="icon-btn panel-close" onClick={props.onClose} aria-label={t('close')}>
          ✕
        </button>
        <div className={`panel-photo panel-photo-${p.gender}`}>
          {photo ? <img src={photo} alt="" /> : <span>{(p.first_name ?? '?').slice(0, 1)}</span>}
        </div>
        <h2>{displayName(p)}</h2>
        {p.maiden_name && <div className="muted">({p.maiden_name})</div>}
        <div className="muted">
          {[p.birth_date && `* ${formatDate(p.birth_date)}`, p.death_date && `† ${formatDate(p.death_date)}`, !p.death_date && p.is_deceased && '†', age !== null && `${age}`]
            .filter(Boolean)
            .join('   ')}
        </div>
        {p.birth_place && <div className="muted">{p.birth_place}</div>}
        <div className="panel-actions">
          {editable && !editing && <button onClick={() => setEditing(true)}>{t('edit')}</button>}
          <button onClick={() => props.onFocus(personId)}>{t('makeFocus')}</button>
          {props.homeId !== personId ? (
            editable && <button onClick={() => props.onSetHome(personId)}>{t('makeHome')}</button>
          ) : (
            <span className="badge">★ {t('home')}</span>
          )}
        </div>
      </div>

      {editing && editable ? (
        <PersonForm
          person={p}
          store={props.store}
          photoUrl={photo}
          onCancel={() => setEditing(false)}
          onSave={async (next) => {
            const ch = emptyChanges();
            ch.upsertPersons.push(next);
            await props.apply(ch);
            setEditing(false);
          }}
        />
      ) : (
        p.description && <p className="description">{p.description}</p>
      )}

      {props.occurrences > 1 && (
        <div className="double-box">
          <strong>🔗 {t('doubleRelation')}</strong>
          <p className="small">{t('doubleRelationHint')}</p>
          <p className="small">
            {t('appearsTimes')}: {props.occurrences}{' '}
            <button className="link-btn" onClick={() => props.onGoToMain(personId)}>
              {t('goToMain')}
            </button>
          </p>
        </div>
      )}

      {props.homeId && graph.person(props.homeId) && props.homeId !== personId && (
        <section>
          <h3>{t('relationshipTo')}</h3>
          <KinshipBox graph={graph} homeId={props.homeId} personId={personId} onSelect={(id) => props.onSelect(id)} />
        </section>
      )}

      <section>
        <h3>{t('parents')}</h3>
        <ul className="rel-list">
          {parentUnion &&
            [parentUnion.partner1_id, parentUnion.partner2_id]
              .filter((id): id is string => !!id)
              .map((id) => rel(id, unlinkBtn(() => removeParentLink(parentUnion.id, personId))))}
        </ul>
      </section>

      <section>
        <h3>{t('spouses')}</h3>
        <ul className="rel-list">
          {unions.map((u) => {
            const s = graph.spouseIn(u, personId);
            const kids = graph.childrenOf(u.id);
            return (
              <li key={u.id} className="union-block">
                {s ? (
                  rel(s, unlinkBtn(() => removePartner(props.data, u.id, s)))
                ) : (
                  <div className="muted small">
                    {t('addSpouse')}: {t('unknownPartner')}
                  </div>
                )}
                {kids.length > 0 && (
                  <ul className="rel-list nested">
                    <li className="muted small">{t('children')}:</li>
                    {kids.map((c) => rel(c, unlinkBtn(() => removeParentLink(u.id, c))))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      </section>

      {siblings.length > 0 && (
        <section>
          <h3>{t('siblings')}</h3>
          <ul className="rel-list">{siblings.map((s) => rel(s))}</ul>
        </section>
      )}

      {editable && (
        <section>
          <h3>{t('addRelative')}</h3>
          <div className="add-buttons">
            {(['father', 'mother', 'spouse', 'child', 'sibling'] as AddKind[]).map((k) => (
              <button key={k} className={adding === k ? 'active' : ''} onClick={() => setAdding(adding === k ? null : k)}>
                + {t(ADD_LABEL[k])}
              </button>
            ))}
          </div>
          {adding && (
            <AddRelative
              key={adding}
              kind={adding}
              graph={graph}
              data={props.data}
              personId={personId}
              onDone={async (ch, newId, isNew) => {
                await props.apply(ch);
                setAdding(null);
                props.onSelect(newId, { edit: isNew });
              }}
            />
          )}
        </section>
      )}

      {editable && (
        <section className="danger-zone">
          {!merging ? (
            <div className="row">
              <button onClick={() => setMerging(true)}>{t('merge')}</button>
              <button
                className="danger"
                onClick={async () => {
                  if (!confirm(t('confirmDelete'))) return;
                  if (p.photo_path) void props.store.deletePhoto(p.photo_path).catch(() => undefined);
                  await props.apply(deletePerson(props.data, personId));
                  props.onClose();
                }}
              >
                {t('delete')}
              </button>
            </div>
          ) : (
            <div>
              <p className="small">{t('mergeHint')}</p>
              <PersonPicker
                graph={graph}
                exclude={[personId]}
                placeholder={t('mergeWith')}
                autoFocus
                onPick={async (dropId) => {
                  if (!confirm(`${t('mergeConfirm')}\n\n${displayName(p)} ⟵ ${displayName(graph.person(dropId))}`)) return;
                  await props.apply(mergePersons(props.data, personId, dropId));
                  setMerging(false);
                }}
              />
              <button onClick={() => setMerging(false)}>{t('cancel')}</button>
            </div>
          )}
        </section>
      )}
    </aside>
  );
}

const ADD_LABEL: Record<AddKind, TKey> = {
  father: 'addFather',
  mother: 'addMother',
  spouse: 'addSpouse',
  child: 'addChild',
  sibling: 'addSibling',
};

function AddRelative(props: {
  kind: AddKind;
  graph: FamilyGraph;
  data: TreeData;
  personId: string;
  onDone(ch: ChangeSet, personId: string, isNew: boolean): Promise<void>;
}) {
  const { t } = useI18n();
  const { kind, graph, personId } = props;
  const [mode, setMode] = useState<'new' | 'existing'>('new');
  const [name, setName] = useState('');
  const [gender, setGender] = useState<Gender>(kind === 'father' ? 'male' : kind === 'mother' ? 'female' : 'unknown');
  const unions = graph.unionsOf(personId);
  const [unionId, setUnionId] = useState<string | undefined>(unions[0]?.id);
  const [error, setError] = useState<string | null>(null);

  const run = async (existingId?: string) => {
    const res = addRelative(props.data, personId, kind, {
      existingId,
      unionId: kind === 'child' ? unionId : undefined,
      patch: existingId ? undefined : { first_name: name.trim() || null, gender },
    });
    if (res.error) {
      setError(t(res.error === 'parents-full' ? 'parentsFull' : 'alreadyLinked'));
      return;
    }
    await props.onDone(res.changes, res.personId, !existingId);
  };

  return (
    <div className="add-box">
      {kind === 'child' && unions.length > 1 && (
        <label>
          {t('chooseCouple')}
          <select value={unionId} onChange={(e) => setUnionId(e.target.value)}>
            {unions.map((u) => {
              const s = graph.spouseIn(u, personId);
              return (
                <option key={u.id} value={u.id}>
                  {shortName(graph.person(personId))} + {s ? displayName(graph.person(s)) : t('unknownPartner')}
                </option>
              );
            })}
          </select>
        </label>
      )}
      <div className="segmented">
        <button className={mode === 'new' ? 'active' : ''} onClick={() => setMode('new')}>
          {t('newPerson')}
        </button>
        <button className={mode === 'existing' ? 'active' : ''} onClick={() => setMode('existing')}>
          {t('existingPerson')}
        </button>
      </div>
      {error && <p className="error small">{error}</p>}
      {mode === 'new' ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void run();
          }}
        >
          <label>
            {t('firstName')}
            <input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          </label>
          {(kind === 'spouse' || kind === 'child' || kind === 'sibling') && (
            <GenderSelect value={gender} onChange={setGender} />
          )}
          <button type="submit" className="primary">
            {t('add')}
          </button>
        </form>
      ) : (
        <>
          <p className="small muted">{t('existingHint')}</p>
          <PersonPicker graph={graph} exclude={[personId]} placeholder={t('search')} autoFocus onPick={(id) => void run(id)} />
        </>
      )}
    </div>
  );
}

function GenderSelect({ value, onChange }: { value: Gender; onChange(g: Gender): void }) {
  const { t } = useI18n();
  return (
    <fieldset className="gender">
      <legend>{t('gender')}</legend>
      {(['male', 'female', 'unknown'] as Gender[]).map((g) => (
        <label key={g} className="radio">
          <input type="radio" checked={value === g} onChange={() => onChange(g)} />
          {t(g)}
        </label>
      ))}
    </fieldset>
  );
}

function PersonForm(props: {
  person: Person;
  store: Store;
  photoUrl?: string;
  onCancel(): void;
  onSave(p: Person): Promise<void>;
}) {
  const { t } = useI18n();
  const p = props.person;
  const [first, setFirst] = useState(p.first_name ?? '');
  const [last, setLast] = useState(p.last_name ?? '');
  const [maiden, setMaiden] = useState(p.maiden_name ?? '');
  const [gender, setGender] = useState<Gender>(p.gender);
  const [birth, setBirth] = useState(formatDate(p.birth_date));
  const [birthPlace, setBirthPlace] = useState(p.birth_place ?? '');
  const [death, setDeath] = useState(formatDate(p.death_date));
  const [deceased, setDeceased] = useState(p.is_deceased || !!p.death_date);
  const [description, setDescription] = useState(p.description ?? '');
  const [photoPath, setPhotoPath] = useState(p.photo_path);
  const [preview, setPreview] = useState(props.photoUrl);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const birthParsed = parseDateInput(birth);
  const deathParsed = parseDateInput(death);
  const birthKnown = birthParsed !== null && birthParsed !== 'invalid';

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (birthParsed === 'invalid' || (birthKnown && deceased && deathParsed === 'invalid')) {
      setErr(t('invalidDate'));
      return;
    }
    setBusy(true);
    try {
      await props.onSave({
        ...p,
        first_name: first.trim() || null,
        last_name: last.trim() || null,
        maiden_name: maiden.trim() || null,
        gender,
        birth_date: birthParsed,
        birth_place: birthPlace.trim() || null,
        death_date: birthKnown && deceased && deathParsed !== 'invalid' ? deathParsed : null,
        is_deceased: deceased,
        description: description.trim() || null,
        photo_path: photoPath,
      });
    } finally {
      setBusy(false);
    }
  };

  const onFile = async (f: File | undefined) => {
    if (!f) return;
    setBusy(true);
    setErr(null);
    try {
      const blob = await compressImage(f);
      const path = await props.store.uploadPhoto(p.id, blob);
      setPreview(URL.createObjectURL(blob));
      setPhotoPath(path);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="person-form" onSubmit={submit}>
      <div className="photo-edit">
        <div className={`panel-photo panel-photo-${gender}`}>{preview && photoPath ? <img src={preview} alt="" /> : <span>{(first || '?').slice(0, 1)}</span>}</div>
        <div className="col">
          <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => void onFile(e.target.files?.[0])} />
          <button type="button" onClick={() => fileRef.current?.click()} disabled={busy}>
            {photoPath ? t('changePhoto') : t('uploadPhoto')}
          </button>
          {photoPath && (
            <button type="button" className="link-btn" onClick={() => setPhotoPath(null)}>
              {t('removePhoto')}
            </button>
          )}
        </div>
      </div>
      <label>
        {t('firstName')}
        <input value={first} onChange={(e) => setFirst(e.target.value)} autoFocus />
      </label>
      <label>
        {t('lastName')}
        <input value={last} onChange={(e) => setLast(e.target.value)} />
      </label>
      {gender !== 'male' && (
        <label>
          {t('maidenName')}
          <input value={maiden} onChange={(e) => setMaiden(e.target.value)} />
        </label>
      )}
      <GenderSelect value={gender} onChange={setGender} />
      <label>
        {t('birthDate')}
        <input value={birth} onChange={(e) => setBirth(e.target.value)} placeholder={t('datePlaceholder')} inputMode="numeric" aria-invalid={birthParsed === 'invalid'} />
        {birthParsed === 'invalid' && <span className="error small">{t('invalidDate')}</span>}
      </label>
      <label>
        {t('birthPlace')}
        <input value={birthPlace} onChange={(e) => setBirthPlace(e.target.value)} />
      </label>
      <label className="check">
        <input type="checkbox" checked={deceased} onChange={(e) => setDeceased(e.target.checked)} />
        {t('deceased')}
      </label>
      {deceased && (
        <label>
          {t('deathDate')}
          <input
            value={death}
            onChange={(e) => setDeath(e.target.value)}
            placeholder={birthKnown ? t('datePlaceholder') : t('deathNeedsBirth')}
            disabled={!birthKnown}
            inputMode="numeric"
            aria-invalid={birthKnown && deathParsed === 'invalid'}
          />
          {!birthKnown && <span className="muted small">{t('deathNeedsBirth')}</span>}
          {birthKnown && deathParsed === 'invalid' && <span className="error small">{t('invalidDate')}</span>}
        </label>
      )}
      <label>
        {t('description')}
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={4} />
      </label>
      {err && <p className="error small">{err}</p>}
      <div className="row">
        <button type="submit" className="primary" disabled={busy}>
          {t('save')}
        </button>
        <button type="button" onClick={props.onCancel}>
          {t('cancel')}
        </button>
      </div>
    </form>
  );
}
