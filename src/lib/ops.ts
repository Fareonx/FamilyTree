import { FamilyGraph } from './graph';
import { emptyPerson, type Person, type TreeData, type Union, type UnionChild } from './types';

/** A set of changes to persist; every editing action is expressed as one of these. */
export interface ChangeSet {
  upsertPersons: Person[];
  deletePersons: string[];
  upsertUnions: Union[];
  deleteUnions: string[];
  upsertChildren: UnionChild[];
  deleteChildren: Array<{ union_id: string; child_id: string }>;
}

export function emptyChanges(): ChangeSet {
  return { upsertPersons: [], deletePersons: [], upsertUnions: [], deleteUnions: [], upsertChildren: [], deleteChildren: [] };
}

export function applyChanges(data: TreeData, ch: ChangeSet): TreeData {
  const persons = new Map(data.persons.map((p) => [p.id, p]));
  for (const id of ch.deletePersons) persons.delete(id);
  for (const p of ch.upsertPersons) persons.set(p.id, p);

  const unions = new Map(data.unions.map((u) => [u.id, u]));
  for (const id of ch.deleteUnions) unions.delete(id);
  for (const u of ch.upsertUnions) unions.set(u.id, u);
  // Mirror "on delete set null" for removed people.
  const gone = new Set(ch.deletePersons);
  for (const [id, u] of unions) {
    if ((u.partner1_id && gone.has(u.partner1_id)) || (u.partner2_id && gone.has(u.partner2_id))) {
      unions.set(id, {
        ...u,
        partner1_id: u.partner1_id && gone.has(u.partner1_id) ? null : u.partner1_id,
        partner2_id: u.partner2_id && gone.has(u.partner2_id) ? null : u.partner2_id,
      });
    }
  }

  const key = (c: { union_id: string; child_id: string }) => `${c.union_id}|${c.child_id}`;
  const kids = new Map(data.children.map((c) => [key(c), c]));
  for (const c of ch.deleteChildren) kids.delete(key(c));
  for (const c of ch.upsertChildren) kids.set(key(c), c);
  for (const [k, c] of kids) {
    if (!unions.has(c.union_id) || gone.has(c.child_id)) kids.delete(k);
  }
  return { persons: [...persons.values()], unions: [...unions.values()], children: [...kids.values()] };
}

const newId = () => crypto.randomUUID();

export type AddKind = 'father' | 'mother' | 'spouse' | 'child' | 'sibling';

export interface AddResult {
  changes: ChangeSet;
  /** Person the user should edit next (new person, or the existing one that was linked). */
  personId: string;
  error?: 'parents-full' | 'already-linked' | 'self';
}

/**
 * Adds a relative of `anchorId`. With `existingId` the relation is made to someone already in the tree
 * (the way to connect a person who is a relative through two different lines), otherwise a new person is created.
 * For a child, `unionId` picks the couple; without it the first couple (or a new single-parent one) is used.
 */
export function addRelative(
  data: TreeData,
  anchorId: string,
  kind: AddKind,
  opts: { existingId?: string; unionId?: string; patch?: Partial<Person> } = {},
): AddResult {
  const g = new FamilyGraph(data);
  const ch = emptyChanges();
  if (opts.existingId === anchorId) return { changes: ch, personId: anchorId, error: 'self' };
  let personId = opts.existingId ?? '';
  const ensurePerson = (patch: Partial<Person>) => {
    if (personId) return;
    personId = newId();
    ch.upsertPersons.push(emptyPerson(personId, { ...patch, ...opts.patch }));
  };
  const nextOrder = (unionId: string) => g.childrenOf(unionId).length;

  if (kind === 'father' || kind === 'mother') {
    const gender = kind === 'father' ? 'male' : 'female';
    const u = g.parentUnion(anchorId);
    if (!u) {
      ensurePerson({ gender });
      const union: Union = { id: newId(), partner1_id: kind === 'father' ? personId : null, partner2_id: kind === 'mother' ? personId : null, kind: 'married', sort_order: 0 };
      ch.upsertUnions.push(union);
      ch.upsertChildren.push({ union_id: union.id, child_id: anchorId, relation: 'biological', sort_order: 0 });
    } else {
      if (opts.existingId && (u.partner1_id === opts.existingId || u.partner2_id === opts.existingId)) {
        return { changes: ch, personId, error: 'already-linked' };
      }
      const slot: 'partner1_id' | 'partner2_id' | null = !u.partner1_id ? 'partner1_id' : !u.partner2_id ? 'partner2_id' : null;
      if (!slot) return { changes: ch, personId: anchorId, error: 'parents-full' };
      ensurePerson({ gender });
      const updated = { ...u, [slot]: personId };
      // Keep father first when we can.
      if (kind === 'father' && slot === 'partner2_id') {
        updated.partner2_id = u.partner1_id;
        updated.partner1_id = personId;
      }
      ch.upsertUnions.push(updated);
    }
  } else if (kind === 'spouse') {
    if (opts.existingId && g.spousesOf(anchorId).includes(opts.existingId)) return { changes: ch, personId, error: 'already-linked' };
    const anchor = g.person(anchorId);
    const gender = anchor?.gender === 'male' ? 'female' : anchor?.gender === 'female' ? 'male' : 'unknown';
    // Fill an existing "unknown partner" couple first (children were added before the partner was known).
    const open = g.unionsOf(anchorId).find((u) => !u.partner1_id || !u.partner2_id);
    ensurePerson({ gender });
    if (open) {
      ch.upsertUnions.push(open.partner1_id ? { ...open, partner2_id: personId } : { ...open, partner1_id: personId });
    } else {
      const first = anchor?.gender !== 'female';
      ch.upsertUnions.push({
        id: newId(),
        partner1_id: first ? anchorId : personId,
        partner2_id: first ? personId : anchorId,
        kind: 'married',
        sort_order: g.unionsOf(anchorId).length,
      });
    }
  } else if (kind === 'child') {
    let union = opts.unionId ? g.unions.get(opts.unionId) : g.unionsOf(anchorId)[0];
    if (!union) {
      union = { id: newId(), partner1_id: anchorId, partner2_id: null, kind: 'married', sort_order: 0 };
      ch.upsertUnions.push(union);
    }
    if (opts.existingId && g.childrenOf(union.id).includes(opts.existingId)) return { changes: ch, personId, error: 'already-linked' };
    ensurePerson({});
    ch.upsertChildren.push({ union_id: union.id, child_id: personId, relation: 'biological', sort_order: nextOrder(union.id) });
  } else if (kind === 'sibling') {
    let union = g.parentUnion(anchorId);
    if (!union) {
      // Parents unknown: create an empty couple both siblings belong to.
      union = { id: newId(), partner1_id: null, partner2_id: null, kind: 'unknown', sort_order: 0 };
      ch.upsertUnions.push(union);
      ch.upsertChildren.push({ union_id: union.id, child_id: anchorId, relation: 'biological', sort_order: 0 });
    }
    if (opts.existingId && g.childrenOf(union.id).includes(opts.existingId)) return { changes: ch, personId, error: 'already-linked' };
    ensurePerson({});
    ch.upsertChildren.push({ union_id: union.id, child_id: personId, relation: 'biological', sort_order: nextOrder(union.id) + 1 });
  }
  return { changes: ch, personId };
}

/** Removes a person; couples left with nobody and no children disappear too. */
export function deletePerson(data: TreeData, personId: string): ChangeSet {
  const g = new FamilyGraph(data);
  const ch = emptyChanges();
  ch.deletePersons.push(personId);
  for (const u of g.unionsOf(personId)) {
    const other = g.spouseIn(u, personId);
    if (!other && g.childrenOf(u.id).length === 0) ch.deleteUnions.push(u.id);
  }
  for (const u of g.parentUnions(personId)) {
    const rest = g.childrenOf(u.id).filter((c) => c !== personId);
    if (!u.partner1_id && !u.partner2_id && rest.length <= 1) ch.deleteUnions.push(u.id);
  }
  return ch;
}

export function removeParentLink(unionId: string, childId: string): ChangeSet {
  const ch = emptyChanges();
  ch.deleteChildren.push({ union_id: unionId, child_id: childId });
  return ch;
}

/** Unlinks two partners. The couple is kept (with an unknown partner) while it still has children. */
export function removePartner(data: TreeData, unionId: string, personId: string): ChangeSet {
  const g = new FamilyGraph(data);
  const ch = emptyChanges();
  const u = g.unions.get(unionId);
  if (!u) return ch;
  if (g.childrenOf(unionId).length === 0) ch.deleteUnions.push(unionId);
  else ch.upsertUnions.push({ ...u, partner1_id: u.partner1_id === personId ? null : u.partner1_id, partner2_id: u.partner2_id === personId ? null : u.partner2_id });
  return ch;
}

/**
 * Merges `dropId` into `keepId`: the same human entered twice (for example once on mother's side and
 * once on father's side). All relations move to the kept record; empty fields are filled from the other one.
 */
export function mergePersons(data: TreeData, keepId: string, dropId: string): ChangeSet {
  const g = new FamilyGraph(data);
  const ch = emptyChanges();
  const keep = g.person(keepId);
  const drop = g.person(dropId);
  if (!keep || !drop || keepId === dropId) return ch;

  const merged: Person = { ...keep };
  for (const k of Object.keys(drop) as Array<keyof Person>) {
    if (k === 'id') continue;
    const kv = merged[k];
    if ((kv === null || kv === '' || (k === 'gender' && kv === 'unknown')) && drop[k] !== null) {
      (merged as unknown as Record<string, unknown>)[k] = drop[k];
    }
  }
  if (keep.description && drop.description && keep.description !== drop.description) {
    merged.description = `${keep.description}\n\n${drop.description}`;
  }
  merged.is_deceased = keep.is_deceased || drop.is_deceased;
  ch.upsertPersons.push(merged);

  // Couples: re-point to the kept person; two couples between the same pair become one.
  const keepSpouses = new Map(g.unionsOf(keepId).map((u) => [g.spouseIn(u, keepId) ?? `none:${u.id}`, u]));
  for (const u of g.unionsOf(dropId)) {
    const other = g.spouseIn(u, dropId);
    const twin = other ? keepSpouses.get(other) : undefined;
    if (other === keepId) {
      ch.deleteUnions.push(u.id); // they were "married to each other"
      continue;
    }
    if (twin) {
      for (const c of g.childrenOf(u.id)) {
        if (!g.childrenOf(twin.id).includes(c)) ch.upsertChildren.push({ union_id: twin.id, child_id: c, relation: 'biological', sort_order: 99 });
      }
      ch.deleteUnions.push(u.id);
    } else {
      ch.upsertUnions.push({ ...u, partner1_id: u.partner1_id === dropId ? keepId : u.partner1_id, partner2_id: u.partner2_id === dropId ? keepId : u.partner2_id });
    }
  }
  // Parent links.
  const keepParentUnions = new Set(g.parentUnions(keepId).map((u) => u.id));
  for (const link of data.children.filter((c) => c.child_id === dropId)) {
    ch.deleteChildren.push({ union_id: link.union_id, child_id: dropId });
    if (!keepParentUnions.has(link.union_id)) ch.upsertChildren.push({ ...link, child_id: keepId });
  }
  ch.deletePersons.push(dropId);
  return ch;
}
