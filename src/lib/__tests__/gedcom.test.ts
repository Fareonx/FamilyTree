import { describe, expect, it } from 'vitest';
import { fromGedcom, parseGedDate, toGedcom } from '../gedcom';
import { doubleRelativeTree } from './fixture';

describe('gedcom', () => {
  it('round-trips people, couples and children', () => {
    const data = doubleRelativeTree();
    data.persons[0] = { ...data.persons[0], last_name: 'Əliyev', birth_date: '1990-03-05', birth_place: 'Bakı', description: 'line 1\nline 2' };
    data.persons[1] = { ...data.persons[1], birth_date: '1960', death_date: '2020-07', is_deceased: true };
    const ged = toGedcom(data);
    expect(ged).toContain('1 CHAR UTF-8');
    expect(ged).toContain('2 DATE 5 MAR 1990');
    let n = 0;
    const back = fromGedcom(ged, () => `id${n++}`).data;
    expect(back.persons).toHaveLength(data.persons.length);
    expect(back.unions).toHaveLength(data.unions.length);
    expect(back.children).toHaveLength(data.children.length);
    const ego = back.persons.find((p) => p.first_name === 'Ego')!;
    expect(ego).toMatchObject({ last_name: 'Əliyev', birth_date: '1990-03-05', birth_place: 'Bakı', description: 'line 1\nline 2', gender: 'male' });
    const dad = back.persons.find((p) => p.first_name === 'Dad')!;
    expect(dad).toMatchObject({ birth_date: '1960', death_date: '2020-07', is_deceased: true });
  });

  it('parses partial and qualified dates', () => {
    expect(parseGedDate('12 MAR 1950')).toBe('1950-03-12');
    expect(parseGedDate('ABT 1950')).toBe('1950');
    expect(parseGedDate('MAR 1950')).toBe('1950-03');
    expect(parseGedDate('BET 1940 AND 1945')).toBe('1945');
    expect(parseGedDate('unknown')).toBeNull();
  });
});
