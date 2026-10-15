import type { Person, TreeData, Union, UnionChild } from './types';

/** Read-only index over the tree data with the lookups every feature needs. */
export class FamilyGraph {
  readonly persons = new Map<string, Person>();
  readonly unions = new Map<string, Union>();
  private unionsByPartner = new Map<string, Union[]>();
  private childrenByUnion = new Map<string, UnionChild[]>();
  private parentUnionsByChild = new Map<string, UnionChild[]>();

  constructor(readonly data: TreeData) {
    for (const p of data.persons) this.persons.set(p.id, p);
    for (const u of data.unions) {
      this.unions.set(u.id, u);
      for (const pid of [u.partner1_id, u.partner2_id]) {
        if (pid) push(this.unionsByPartner, pid, u);
      }
    }
    for (const c of data.children) {
      push(this.childrenByUnion, c.union_id, c);
      push(this.parentUnionsByChild, c.child_id, c);
    }
    for (const list of this.unionsByPartner.values()) list.sort((a, b) => a.sort_order - b.sort_order);
    for (const list of this.childrenByUnion.values()) {
      list.sort((a, b) => compareChildren(this.persons.get(a.child_id), this.persons.get(b.child_id)) || a.sort_order - b.sort_order);
    }
  }

  person(id: string): Person | undefined {
    return this.persons.get(id);
  }

  unionsOf(personId: string): Union[] {
    return this.unionsByPartner.get(personId) ?? [];
  }

  spouseIn(union: Union, personId: string): string | null {
    return union.partner1_id === personId ? union.partner2_id : union.partner1_id;
  }

  spousesOf(personId: string): string[] {
    return this.unionsOf(personId)
      .map((u) => this.spouseIn(u, personId))
      .filter((id): id is string => !!id);
  }

  childrenOf(unionId: string): string[] {
    return (this.childrenByUnion.get(unionId) ?? []).map((c) => c.child_id);
  }

  allChildrenOf(personId: string): string[] {
    return this.unionsOf(personId).flatMap((u) => this.childrenOf(u.id));
  }

  parentUnions(personId: string): Union[] {
    return (this.parentUnionsByChild.get(personId) ?? [])
      .map((c) => this.unions.get(c.union_id))
      .filter((u): u is Union => !!u);
  }

  /** Main (first, preferably biological) parent couple of a person. */
  parentUnion(personId: string): Union | undefined {
    const links = this.parentUnionsByChild.get(personId) ?? [];
    const bio = links.find((l) => l.relation === 'biological') ?? links[0];
    return bio ? this.unions.get(bio.union_id) : undefined;
  }

  parentsOf(personId: string): string[] {
    const u = this.parentUnion(personId);
    return u ? [u.partner1_id, u.partner2_id].filter((id): id is string => !!id) : [];
  }

  hasParents(personId: string): boolean {
    return (this.parentUnionsByChild.get(personId) ?? []).length > 0;
  }

  siblingsOf(personId: string): string[] {
    const out = new Set<string>();
    for (const u of this.parentUnions(personId)) {
      for (const c of this.childrenOf(u.id)) if (c !== personId) out.add(c);
    }
    return [...out];
  }
}

function push<K, V>(map: Map<K, V[]>, key: K, value: V) {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

function compareChildren(a?: Person, b?: Person): number {
  const ay = a?.birth_date ?? '';
  const by = b?.birth_date ?? '';
  if (ay && by) return ay.localeCompare(by);
  return 0;
}
