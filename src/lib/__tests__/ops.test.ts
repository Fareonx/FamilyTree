import { describe, expect, it } from 'vitest';
import { FamilyGraph } from '../graph';
import { bloodLinks } from '../kinship';
import { addRelative, applyChanges, deletePerson, mergePersons } from '../ops';
import { parseDateInput } from '../dates';
import { doubleRelativeTree, tree } from './fixture';

describe('ops', () => {
  it('merging a duplicate keeps both lines of relation', () => {
    // X entered twice: once on each side.
    let data = doubleRelativeTree();
    data = {
      ...data,
      persons: [...data.persons, { ...data.persons.find((p) => p.id === 'X')!, id: 'X2', birth_date: '2001' }],
      children: data.children.map((c) => (c.union_id === 'u-x' ? c : c)),
    };
    // Re-point the mother's-side link to the duplicate.
    data.unions = data.unions.map((u) => (u.id === 'u-x' ? { ...u, partner2_id: null } : u));
    data.unions.push({ id: 'u-x2', partner1_id: null, partner2_id: 'Cousin', kind: 'married', sort_order: 0 });
    data.children.push({ union_id: 'u-x2', child_id: 'X2', relation: 'biological', sort_order: 0 });
    expect(bloodLinks(new FamilyGraph(data), 'Ego', 'X')).toHaveLength(1);

    const merged = applyChanges(data, mergePersons(data, 'X', 'X2'));
    const g = new FamilyGraph(merged);
    expect(g.person('X2')).toBeUndefined();
    expect(g.person('X')?.birth_date).toBe('2001');
    expect(bloodLinks(g, 'Ego', 'X')).toHaveLength(2);
  });

  it('adds parents, spouse, child and sibling', () => {
    let data = tree().person('Me', 'male').data;
    const step = (kind: Parameters<typeof addRelative>[2], opts = {}) => {
      const r = addRelative(data, 'Me', kind, opts);
      expect(r.error).toBeUndefined();
      data = applyChanges(data, r.changes);
      return r.personId;
    };
    const dad = step('father');
    const mom = step('mother');
    const wife = step('spouse');
    const kid = step('child');
    const sis = step('sibling');
    const g = new FamilyGraph(data);
    expect(g.parentsOf('Me').sort()).toEqual([dad, mom].sort());
    expect(g.person(dad)?.gender).toBe('male');
    expect(g.spousesOf('Me')).toEqual([wife]);
    expect(g.person(wife)?.gender).toBe('female');
    expect(g.allChildrenOf('Me')).toEqual([kid]);
    expect(g.siblingsOf('Me')).toEqual([sis]);
    expect(addRelative(data, 'Me', 'father').error).toBe('parents-full');
  });

  it('linking an existing person as a parent does not create anyone', () => {
    const data = tree().person('Me', 'male').person('Old', 'male').data;
    const r = addRelative(data, 'Me', 'father', { existingId: 'Old' });
    expect(r.changes.upsertPersons).toHaveLength(0);
    expect(new FamilyGraph(applyChanges(data, r.changes)).parentsOf('Me')).toEqual(['Old']);
  });

  it('deleting a person removes empty couples', () => {
    const data = tree().person('A', 'male').person('B', 'female').couple('u', 'A', null, ['B']).data;
    const after = applyChanges(data, deletePerson(data, 'A'));
    expect(after.unions).toHaveLength(1); // child still belongs to the (now unknown) couple
    const after2 = applyChanges(after, deletePerson(after, 'B'));
    expect(after2.persons).toHaveLength(0);
  });

  it('parses user date input', () => {
    expect(parseDateInput('05.03.1990')).toBe('1990-03-05');
    expect(parseDateInput('3.1990')).toBe('1990-03');
    expect(parseDateInput('1990')).toBe('1990');
    expect(parseDateInput('')).toBeNull();
    expect(parseDateInput('31.13.1990')).toBe('invalid');
  });
});
