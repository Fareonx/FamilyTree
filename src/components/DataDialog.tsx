import { useRef, useState } from 'react';
import { fromGedcom, toGedcom } from '../lib/gedcom';
import { downloadText } from '../lib/image';
import { normalizeForSearch } from '../lib/names';
import { emptyChanges, type ChangeSet } from '../lib/ops';
import type { TreeData } from '../lib/types';
import { useI18n } from '../i18n';

/**
 * Merges an imported GEDCOM into the current tree. People whose name and birth year match exactly one
 * existing person are treated as the same person; everyone else is added.
 */
export function mergeImport(current: TreeData, incoming: TreeData): { changes: ChangeSet; added: number; matched: number } {
  const key = (p: { first_name: string | null; last_name: string | null; birth_date: string | null }) =>
    `${normalizeForSearch(p.first_name ?? '')}|${normalizeForSearch(p.last_name ?? '')}|${(p.birth_date ?? '').slice(0, 4)}`;
  const index = new Map<string, string[]>();
  for (const p of current.persons) {
    if (!p.first_name) continue;
    const k = key(p);
    index.set(k, [...(index.get(k) ?? []), p.id]);
  }
  const remap = new Map<string, string>();
  const ch = emptyChanges();
  let matched = 0;
  for (const p of incoming.persons) {
    const hits = p.first_name ? index.get(key(p)) : undefined;
    if (hits?.length === 1) {
      remap.set(p.id, hits[0]);
      matched++;
      const existing = current.persons.find((x) => x.id === hits[0])!;
      // Fill only what is missing here.
      const filled = { ...existing };
      let changed = false;
      for (const f of ['birth_date', 'birth_place', 'death_date', 'last_name', 'maiden_name', 'description'] as const) {
        if (!filled[f] && p[f]) {
          filled[f] = p[f];
          changed = true;
        }
      }
      if (filled.gender === 'unknown' && p.gender !== 'unknown') {
        filled.gender = p.gender;
        changed = true;
      }
      if (changed) ch.upsertPersons.push(filled);
    } else {
      remap.set(p.id, p.id);
      ch.upsertPersons.push(p);
    }
  }
  const id = (x: string | null) => (x ? remap.get(x) ?? x : null);
  const pairKey = (a: string | null, b: string | null) => [a ?? '', b ?? ''].sort().join('|');
  const existingPairs = new Map(current.unions.filter((u) => u.partner1_id || u.partner2_id).map((u) => [pairKey(u.partner1_id, u.partner2_id), u.id]));
  const unionMap = new Map<string, string>();
  for (const u of incoming.unions) {
    const p1 = id(u.partner1_id);
    const p2 = id(u.partner2_id);
    const same = p1 && p2 ? existingPairs.get(pairKey(p1, p2)) : undefined;
    if (same) unionMap.set(u.id, same);
    else {
      unionMap.set(u.id, u.id);
      ch.upsertUnions.push({ ...u, partner1_id: p1, partner2_id: p2 });
    }
  }
  const haveChild = new Set(current.children.map((c) => `${c.union_id}|${c.child_id}`));
  for (const c of incoming.children) {
    const uid = unionMap.get(c.union_id)!;
    const cid = id(c.child_id)!;
    if (!haveChild.has(`${uid}|${cid}`)) ch.upsertChildren.push({ ...c, union_id: uid, child_id: cid });
  }
  return { changes: ch, added: incoming.persons.length - matched, matched };
}

export function DataDialog(props: {
  data: TreeData;
  editable: boolean;
  apply(ch: ChangeSet): Promise<void>;
  replaceAll(d: TreeData): Promise<void>;
  onClose(): void;
}) {
  const { t } = useI18n();
  const gedRef = useRef<HTMLInputElement>(null);
  const jsonRef = useRef<HTMLInputElement>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const stamp = new Date().toISOString().slice(0, 10);

  const importGed = async (f?: File) => {
    if (!f) return;
    const parsed = fromGedcom(await f.text());
    const res = mergeImport(props.data, parsed.data);
    await props.apply(res.changes);
    setMsg(`${t('importDone')}: ${res.added} ${t('added')}, ${res.matched} ${t('matched')}`);
  };

  const importJson = async (f?: File) => {
    if (!f) return;
    const d = JSON.parse(await f.text()) as TreeData;
    if (!Array.isArray(d.persons) || !Array.isArray(d.unions) || !Array.isArray(d.children)) throw new Error('Bad file');
    if (!confirm(t('importJsonConfirm'))) return;
    await props.replaceAll(d);
    setMsg(`${t('importDone')}: ${d.persons.length}`);
  };

  return (
    <div className="modal-backdrop" onClick={props.onClose}>
      <div className="modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>{t('data')}</h2>
          <button className="icon-btn" onClick={props.onClose} aria-label={t('close')}>
            ✕
          </button>
        </div>
        <h3>{t('myheritageTitle')}</h3>
        <p className="small muted">{t('myheritageHelp')}</p>
        <div className="col">
          <button onClick={() => downloadText(`family-tree-${stamp}.ged`, toGedcom(props.data), 'text/plain')}>⬇ {t('exportGedcom')}</button>
          {props.editable && (
            <>
              <button onClick={() => gedRef.current?.click()}>⬆ {t('importGedcom')}</button>
              <span className="small muted">{t('importGedcomHint')}</span>
            </>
          )}
          <input ref={gedRef} type="file" accept=".ged,.gedcom,text/plain" hidden onChange={(e) => void importGed(e.target.files?.[0]).catch((er) => setMsg(String(er)))} />
        </div>
        <h3>JSON</h3>
        <div className="col">
          <button onClick={() => downloadText(`family-tree-${stamp}.json`, JSON.stringify(props.data, null, 1), 'application/json')}>⬇ {t('exportJson')}</button>
          {props.editable && <button onClick={() => jsonRef.current?.click()}>⬆ {t('importJson')}</button>}
          <input ref={jsonRef} type="file" accept=".json,application/json" hidden onChange={(e) => void importJson(e.target.files?.[0]).catch((er) => setMsg(String(er)))} />
        </div>
        {msg && <p className="notice">{msg}</p>}
      </div>
    </div>
  );
}
