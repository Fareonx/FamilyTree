import { emptyPerson, type Gender, type TreeData } from '../types';

/** Small builder for test trees: people by name, couples, children. Names are invented. */
export function tree() {
  const data: TreeData = { persons: [], unions: [], children: [] };
  const api = {
    data,
    person(name: string, gender: Gender) {
      data.persons.push(emptyPerson(name, { first_name: name, gender }));
      return api;
    },
    couple(id: string, a: string | null, b: string | null, kids: string[] = []) {
      data.unions.push({ id, partner1_id: a, partner2_id: b, kind: 'married', sort_order: 0 });
      kids.forEach((k, i) => data.children.push({ union_id: id, child_id: k, relation: 'biological', sort_order: i }));
      return api;
    },
  };
  return api;
}

/**
 * The case from the request: X is, on mother's side, the son of grandfather's cousin and, on father's side,
 * the grandson of grandmother's brother.
 *
 *   Father's side:   GGF + GGM ─► PatGM, Bro            Bro ─► BroSon ─► X
 *                    PatGF + PatGM ─► Dad
 *   Mother's side:   A + B ─► C1, C2   C1 ─► MatGF ─► Mom      C2 ─► Cousin ─► X
 */
export function doubleRelativeTree() {
  return tree()
    .person('Ego', 'male')
    .person('Dad', 'male')
    .person('Mom', 'female')
    .person('PatGF', 'male')
    .person('PatGM', 'female')
    .person('GGF', 'male')
    .person('GGM', 'female')
    .person('Bro', 'male')
    .person('BroSon', 'male')
    .person('X', 'male')
    .person('Cousin', 'female')
    .person('MatGF', 'male')
    .person('MatGM', 'female')
    .person('C1', 'male')
    .person('C2', 'male')
    .person('A', 'male')
    .person('B', 'female')
    .couple('u-parents', 'Dad', 'Mom', ['Ego'])
    .couple('u-pat', 'PatGF', 'PatGM', ['Dad'])
    .couple('u-ggp', 'GGF', 'GGM', ['PatGM', 'Bro'])
    .couple('u-bro', 'Bro', null, ['BroSon'])
    .couple('u-x', 'BroSon', 'Cousin', ['X'])
    .couple('u-mat', 'MatGF', 'MatGM', ['Mom'])
    .couple('u-c1', 'C1', null, ['MatGF'])
    .couple('u-c2', 'C2', null, ['Cousin'])
    .couple('u-ab', 'A', 'B', ['C1', 'C2']).data;
}
