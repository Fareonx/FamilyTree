import { describe, expect, it } from 'vitest';
import { FamilyGraph } from '../graph';
import { buildLayout } from '../layout';
import { doubleRelativeTree } from './fixture';

describe('layout', () => {
  it('draws a double relative once and links the other occurrences', () => {
    const g = new FamilyGraph(doubleRelativeTree());
    for (const mode of ['family', 'ancestors', 'descendants'] as const) {
      const focus = mode === 'ancestors' ? 'X' : mode === 'descendants' ? 'A' : 'Ego';
      const l = buildLayout(g, mode, focus);
      const full = l.cards.filter((c) => c.ref.kind === 'person');
      const ids = full.map((c) => (c.ref.kind === 'person' ? c.ref.personId : ''));
      expect(new Set(ids).size).toBe(ids.length); // every person at most once as a full card
    }
    const family = buildLayout(g, 'family', 'Ego');
    // Everyone is on the canvas in "whole family".
    expect(family.primary.size).toBe(g.persons.size);
  });

  it('puts unknown parents as a placeholder card', () => {
    const g = new FamilyGraph(doubleRelativeTree());
    const l = buildLayout(g, 'ancestors', 'BroSon');
    expect(l.cards.some((c) => c.ref.kind === 'ghost')).toBe(true);
  });

  it('keeps cards from overlapping', () => {
    const g = new FamilyGraph(doubleRelativeTree());
    const l = buildLayout(g, 'family', 'Ego');
    const rows = new Map<number, number[]>();
    for (const c of l.cards) rows.set(c.y, [...(rows.get(c.y) ?? []), c.x]);
    for (const xs of rows.values()) {
      xs.sort((a, b) => a - b);
      for (let i = 1; i < xs.length; i++) expect(xs[i] - xs[i - 1]).toBeGreaterThanOrEqual(172);
    }
  });
});
