import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FamilyGraph } from './lib/graph';
import { applyChanges, type ChangeSet } from './lib/ops';
import type { TreeData } from './lib/types';
import type { Store } from './store/store';

export type SaveState = 'idle' | 'saving' | 'saved' | 'error';

export function useTree(store: Store | null) {
  const [data, setData] = useState<TreeData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [homeId, setHomeIdState] = useState<string | null>(null);
  const [photoUrls, setPhotoUrls] = useState<Map<string, string>>(new Map());
  const dataRef = useRef<TreeData | null>(null);
  dataRef.current = data;

  const reload = useCallback(async () => {
    if (!store) return;
    try {
      const [d, home] = await Promise.all([store.load(), store.getSetting<string>('home_person_id')]);
      setData(d);
      setHomeIdState(home);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [store]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const graph = useMemo(() => (data ? new FamilyGraph(data) : null), [data]);

  // Fetch (signed) URLs for every photo in the tree.
  useEffect(() => {
    if (!store || !data) return;
    const paths = data.persons.map((p) => p.photo_path).filter((p): p is string => !!p);
    if (!paths.length) return;
    let alive = true;
    store
      .photoUrls(paths)
      .then((m) => alive && setPhotoUrls(m))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [store, data]);

  /** Applies changes immediately on screen, then persists them; on failure the server state is reloaded. */
  const apply = useCallback(
    async (changes: ChangeSet) => {
      if (!store || !dataRef.current) return;
      setData(applyChanges(dataRef.current, changes));
      setSaveState('saving');
      try {
        await store.save(changes);
        setSaveState('saved');
      } catch (e) {
        setSaveState('error');
        setError(e instanceof Error ? e.message : String(e));
        await reload();
      }
    },
    [store, reload],
  );

  const replaceAll = useCallback(
    async (next: TreeData) => {
      if (!store) return;
      setSaveState('saving');
      try {
        await store.replaceAll(next);
        setData(next);
        setSaveState('saved');
      } catch (e) {
        setSaveState('error');
        setError(e instanceof Error ? e.message : String(e));
        await reload();
      }
    },
    [store, reload],
  );

  const setHomeId = useCallback(
    async (id: string) => {
      setHomeIdState(id);
      await store?.setSetting('home_person_id', id);
    },
    [store],
  );

  return { data, graph, error, setError, saveState, apply, replaceAll, homeId, setHomeId, photoUrls, reload };
}
