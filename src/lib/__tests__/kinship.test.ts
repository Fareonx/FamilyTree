import { describe, expect, it } from 'vitest';
import { FamilyGraph } from '../graph';
import { bloodLinks, describeLink, relations } from '../kinship';
import { doubleRelativeTree, tree } from './fixture';

describe('kinship', () => {
  it('finds both lines for a person related through mother and father', () => {
    const g = new FamilyGraph(doubleRelativeTree());
    const links = bloodLinks(g, 'Ego', 'X');
    expect(links).toHaveLength(2);
    const father = links.find((l) => l.egoPath[1] === 'Dad')!;
    const mother = links.find((l) => l.egoPath[1] === 'Mom')!;
    // Father's side: grandson of grandmother's brother.
    expect(father.ancestors.sort()).toEqual(['GGF', 'GGM']);
    expect([father.up, father.down]).toEqual([3, 3]);
    expect(describeLink(g, father, 'ru')).toEqual({ term: 'троюродный брат', side: 'по папе' });
    // Mother's side: son of grandfather's cousin.
    expect(mother.ancestors.sort()).toEqual(['A', 'B']);
    expect([mother.up, mother.down]).toEqual([4, 3]);
    expect(describeLink(g, mother, 'ru')).toEqual({ term: 'троюродный дядя', side: 'по маме' });
    expect(describeLink(g, mother, 'az').term).toBe('ulu babamın qardaşının nəvəsi');
  });

  it('names close relatives', () => {
    const data = tree()
      .person('Me', 'female')
      .person('Pa', 'male')
      .person('Ma', 'female')
      .person('Sis', 'female')
      .person('Uncle', 'male')
      .person('Aunt', 'female')
      .person('GP', 'male')
      .person('GM', 'female')
      .person('Cuz', 'male')
      .person('Niece', 'female')
      .couple('p', 'Pa', 'Ma', ['Me', 'Sis'])
      .couple('g', 'GP', 'GM', ['Ma', 'Uncle', 'Aunt'])
      .couple('a', 'Aunt', null, ['Cuz'])
      .couple('s', 'Sis', null, ['Niece']).data;
    const g = new FamilyGraph(data);
    const term = (id: string, lang: 'ru' | 'az' = 'ru') => describeLink(g, bloodLinks(g, 'Me', id)[0], lang).term;
    expect(term('Pa')).toBe('отец');
    expect(term('GM')).toBe('бабушка');
    expect(term('Sis')).toBe('сестра');
    expect(term('Uncle')).toBe('дядя');
    expect(term('Uncle', 'az')).toBe('dayı');
    expect(term('Aunt', 'az')).toBe('xala');
    expect(term('Cuz')).toBe('двоюродный брат');
    expect(term('Cuz', 'az')).toBe('xalaoğlu');
    expect(term('Niece')).toBe('племянница');
    expect(term('Niece', 'az')).toBe('bacımın qızı');
  });

  it('reports in-law relations and spouses', () => {
    const data = tree()
      .person('Me', 'male')
      .person('Wife', 'female')
      .person('Bro', 'male')
      .person('BroWife', 'female')
      .person('Pa', 'male')
      .couple('p', 'Pa', null, ['Me', 'Bro'])
      .couple('m', 'Me', 'Wife')
      .couple('b', 'Bro', 'BroWife').data;
    const g = new FamilyGraph(data);
    expect(relations(g, 'Me', 'Wife')[0]).toEqual({ type: 'spouse' });
    const r = relations(g, 'Me', 'BroWife');
    expect(r[0].type).toBe('spouse-of');
  });

  it('marks half siblings', () => {
    const data = tree()
      .person('Me', 'male')
      .person('Half', 'female')
      .person('Pa', 'male')
      .person('Ma1', 'female')
      .person('Ma2', 'female')
      .couple('a', 'Pa', 'Ma1', ['Me'])
      .couple('b', 'Pa', 'Ma2', ['Half']).data;
    const g = new FamilyGraph(data);
    const [link] = bloodLinks(g, 'Me', 'Half');
    expect(link.half).toBe(true);
    expect(describeLink(g, link, 'ru').term).toBe('единокровная сестра');
  });
});

describe('kinship with unknown parents', () => {
  it('relates children of a couple whose members are unknown', () => {
    const data = tree()
      .person('Me', 'male')
      .person('Ma', 'female')
      .person('GP', 'male')
      .person('GPBro', 'male')
      .person('Kid', 'female')
      .couple('p', null, 'Ma', ['Me'])
      .couple('g', 'GP', null, ['Ma'])
      .couple('top', null, null, ['GP', 'GPBro'])
      .couple('k', 'GPBro', null, ['Kid']).data;
    const g = new FamilyGraph(data);
    const links = bloodLinks(g, 'Me', 'Kid');
    expect(links).toHaveLength(1);
    expect([links[0].up, links[0].down]).toEqual([3, 2]);
    expect(describeLink(g, links[0], 'ru')).toEqual({ term: 'двоюродная тётя', side: 'по маме' });
  });
});
