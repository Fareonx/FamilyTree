import type { FamilyGraph } from './graph';
import type { Union } from './types';

export const CARD_W = 172;
export const CARD_H = 76;
const COUPLE_GAP = 32;
const SIBLING_GAP = 28;
const GROUP_GAP = 56;
const ROOT_GAP = 120;
const ROW_H = CARD_H + 96;

/**
 * What a card on the canvas shows.
 * - person: the one full card of that person
 * - link:   the same person appearing again elsewhere (relative through two lines, pedigree collapse)
 * - ghost:  an unknown parent/partner slot
 */
export type CardRef =
  | { kind: 'person'; personId: string }
  | { kind: 'link'; personId: string }
  | { kind: 'ghost'; unionId: string | null; forChild?: string };

export interface PlacedCard {
  key: string;
  x: number;
  y: number;
  ref: CardRef;
}

export interface Edge {
  key: string;
  points: Array<[number, number]>;
  kind: 'couple' | 'child';
  dashed?: boolean;
}

export interface TreeLayout {
  cards: PlacedCard[];
  edges: Edge[];
  width: number;
  height: number;
  /** Top-left corner of each person's full card. */
  primary: Map<string, { x: number; y: number }>;
  /** Number of cards (full + links) showing each person. */
  occurrences: Map<string, number>;
}

export type ViewMode = 'family' | 'ancestors' | 'descendants';

export function buildLayout(graph: FamilyGraph, mode: ViewMode, focusId: string | null, maxDepth = 12): TreeLayout {
  if (mode === 'ancestors' && focusId && graph.person(focusId)) return ancestorsLayout(graph, focusId, maxDepth);
  const builder = new DescendantBuilder(graph, maxDepth);
  const units =
    mode === 'descendants' && focusId && graph.person(focusId)
      ? [builder.unitForPerson(focusId, maxDepth)]
      : builder.forest(focusId);
  return placeUnits(units);
}

// ---------------------------------------------------------------------------
// Descendant layout ("whole family" is a forest of descendant trees)

interface Unit {
  main: CardRef;
  groups: Group[];
  width: number;
}

interface Group {
  unionId: string;
  spouse: CardRef | null;
  children: Unit[];
  childrenWidth: number;
}

class DescendantBuilder {
  private placed = new Set<string>();
  private expanded = new Set<string>();

  constructor(
    private g: FamilyGraph,
    private maxDepth: number,
  ) {}

  /** All root couples (nobody in them has parents), ordered by where they sit in the focus person's pedigree. */
  forest(focusId: string | null): Unit[] {
    const rank = focusId ? pedigreeRank(this.g, focusId) : new Map<string, number>();
    const unionRank = (u: Union) =>
      Math.min(rank.get(u.partner1_id ?? '') ?? Infinity, rank.get(u.partner2_id ?? '') ?? Infinity);
    const isRoot = (u: Union) =>
      ![u.partner1_id, u.partner2_id].some((p) => p && this.g.hasParents(p));

    const unions = [...this.g.unions.values()];
    const roots = unions.filter(isRoot).sort((a, b) => unionRank(a) - unionRank(b) || a.sort_order - b.sort_order);
    const units: Unit[] = [];
    for (const u of roots) if (!this.expanded.has(u.id)) units.push(this.unitForUnion(u));
    // Whatever is still not drawn: couples reached only partially, people with no relations at all.
    for (const u of unions) if (!this.expanded.has(u.id)) units.push(this.unitForUnion(u));
    for (const p of this.g.persons.keys()) if (!this.placed.has(p)) units.push(this.unitForPerson(p, this.maxDepth));
    return units;
  }

  unitForPerson(personId: string, depth: number): Unit {
    if (this.placed.has(personId)) {
      return { main: { kind: 'link', personId }, groups: [], width: 0 };
    }
    this.placed.add(personId);
    return { main: { kind: 'person', personId }, groups: this.groupsFor(personId, depth), width: 0 };
  }

  private unitForUnion(u: Union): Unit {
    const partners = [u.partner1_id, u.partner2_id].filter((p): p is string => !!p);
    if (partners.length === 0) {
      this.expanded.add(u.id);
      return {
        main: { kind: 'ghost', unionId: u.id },
        groups: [{ unionId: u.id, spouse: null, children: this.childUnits(u, this.maxDepth), childrenWidth: 0 }],
        width: 0,
      };
    }
    const main = partners.find((p) => !this.placed.has(p)) ?? partners[0];
    if (!this.placed.has(main)) return this.unitForPerson(main, this.maxDepth);
    return { main: { kind: 'link', personId: main }, groups: this.groupsFor(main, this.maxDepth), width: 0 };
  }

  private groupsFor(personId: string, depth: number): Group[] {
    const groups: Group[] = [];
    for (const u of this.g.unionsOf(personId)) {
      if (this.expanded.has(u.id)) continue;
      this.expanded.add(u.id);
      const spouseId = this.g.spouseIn(u, personId);
      const children = depth > 0 ? this.childUnits(u, depth - 1) : [];
      let spouse: CardRef | null = null;
      if (spouseId) {
        if (this.placed.has(spouseId)) spouse = { kind: 'link', personId: spouseId };
        else {
          this.placed.add(spouseId);
          spouse = { kind: 'person', personId: spouseId };
        }
      } else if (children.length) {
        spouse = { kind: 'ghost', unionId: u.id };
      }
      groups.push({ unionId: u.id, spouse, children, childrenWidth: 0 });
    }
    return groups;
  }

  private childUnits(u: Union, depth: number): Unit[] {
    return this.g.childrenOf(u.id).map((c) => this.unitForPerson(c, depth));
  }
}

/**
 * Horizontal position (0..1) of every ancestor in the focus person's pedigree chart,
 * father's side first, so the forest is drawn in the same left-to-right order.
 */
function pedigreeRank(g: FamilyGraph, focusId: string): Map<string, number> {
  const rank = new Map<string, number>();
  const queue: Array<[string, number, number]> = [[focusId, 0, 1]]; // id, generation, ahnentafel number
  while (queue.length) {
    const [id, gen, n] = queue.shift()!;
    if (rank.has(id) || gen > 30) continue;
    rank.set(id, (n - 2 ** gen + 0.5) / 2 ** gen);
    const u = g.parentUnion(id);
    if (!u) continue;
    const [father, mother] = orderParents(g, u);
    if (father) queue.push([father, gen + 1, 2 * n]);
    if (mother) queue.push([mother, gen + 1, 2 * n + 1]);
  }
  return rank;
}

/** [father, mother] — by gender when known, otherwise in stored order. */
export function orderParents(g: FamilyGraph, u: Union): [string | null, string | null] {
  const a = u.partner1_id;
  const b = u.partner2_id;
  const ga = a ? g.person(a)?.gender : undefined;
  const gb = b ? g.person(b)?.gender : undefined;
  if (ga === 'female' || gb === 'male') return [b, a];
  return [a, b];
}

function measure(unit: Unit): number {
  const ownCount = 1 + unit.groups.filter((gr) => gr.spouse).length;
  const ownW = ownCount * CARD_W + (ownCount - 1) * COUPLE_GAP;
  let childrenW = 0;
  let nonEmpty = 0;
  for (const gr of unit.groups) {
    gr.childrenWidth = gr.children.reduce((s, c) => s + measure(c), 0) + Math.max(0, gr.children.length - 1) * SIBLING_GAP;
    if (gr.children.length) {
      childrenW += gr.childrenWidth;
      nonEmpty++;
    }
  }
  childrenW += Math.max(0, nonEmpty - 1) * GROUP_GAP;
  unit.width = Math.max(ownW, childrenW);
  return unit.width;
}

class Canvas {
  cards: PlacedCard[] = [];
  edges: Edge[] = [];
  primary = new Map<string, { x: number; y: number }>();
  occurrences = new Map<string, number>();
  private seq = 0;

  card(ref: CardRef, x: number, y: number) {
    const key = `${ref.kind}:${'personId' in ref ? ref.personId : ref.unionId ?? ''}:${this.seq++}`;
    this.cards.push({ key, x, y, ref });
    if (ref.kind === 'person') this.primary.set(ref.personId, { x, y });
    if (ref.kind !== 'ghost') this.occurrences.set(ref.personId, (this.occurrences.get(ref.personId) ?? 0) + 1);
  }

  edge(kind: Edge['kind'], points: Array<[number, number]>, dashed = false) {
    this.edges.push({ key: `e${this.seq++}`, kind, points, dashed });
  }

  finish(): TreeLayout {
    let maxX = 0;
    let maxY = 0;
    for (const c of this.cards) {
      maxX = Math.max(maxX, c.x + CARD_W);
      maxY = Math.max(maxY, c.y + CARD_H);
    }
    return {
      cards: this.cards,
      edges: this.edges,
      width: maxX,
      height: maxY,
      primary: this.primary,
      occurrences: this.occurrences,
    };
  }
}

function placeUnits(units: Unit[]): TreeLayout {
  const canvas = new Canvas();
  let left = 0;
  for (const u of units) {
    measure(u);
    placeUnit(canvas, u, left, 0);
    left += u.width + ROOT_GAP;
  }
  return canvas.finish();
}

/** Places a unit inside [left, left + width] at row y; returns the x centre of its main card. */
function placeUnit(canvas: Canvas, unit: Unit, left: number, y: number): number {
  const withSpouse = unit.groups.filter((gr) => gr.spouse);
  // Second spouse goes to the left of the person, others to the right, so most marriage lines stay short.
  const leftSpouses = withSpouse.filter((_, i) => i % 2 === 1).reverse();
  const rightSpouses = withSpouse.filter((_, i) => i % 2 === 0);
  const row: Array<{ ref: CardRef; group?: Group }> = [
    ...leftSpouses.map((gr) => ({ ref: gr.spouse!, group: gr })),
    { ref: unit.main },
    ...rightSpouses.map((gr) => ({ ref: gr.spouse!, group: gr })),
  ];
  const ownW = row.length * CARD_W + (row.length - 1) * COUPLE_GAP;
  const ownLeft = left + (unit.width - ownW) / 2;
  const xs = row.map((_, i) => ownLeft + i * (CARD_W + COUPLE_GAP));
  row.forEach((r, i) => canvas.card(r.ref, xs[i], y));

  const mainIdx = leftSpouses.length;
  const mainX = xs[mainIdx];
  const midY = y + CARD_H / 2;

  // Where each group's line to the children starts.
  const dropX = new Map<Group, number>();
  row.forEach((r, i) => {
    if (!r.group) return;
    const a = Math.min(i, mainIdx);
    const b = Math.max(i, mainIdx);
    const from = xs[a] + CARD_W;
    const to = xs[b];
    const lineY = midY + (b - a > 1 ? 10 : 0);
    canvas.edge('couple', [
      [from, lineY],
      [to, lineY],
    ], r.group.spouse?.kind === 'ghost');
    dropX.set(r.group, b - a > 1 ? to - COUPLE_GAP / 2 : (from + to) / 2);
  });

  // Children, group by group, in the order their parents' cards appear.
  const orderedGroups = [
    ...row.filter((r) => r.group).map((r) => r.group!),
    ...unit.groups.filter((gr) => !gr.spouse),
  ];
  const nonEmpty = orderedGroups.filter((gr) => gr.children.length);
  const childrenW = nonEmpty.reduce((s, gr) => s + gr.childrenWidth, 0) + Math.max(0, nonEmpty.length - 1) * GROUP_GAP;
  let cx = left + (unit.width - childrenW) / 2;
  const childY = y + ROW_H;
  const busY = y + CARD_H + (ROW_H - CARD_H) / 2;
  for (const gr of nonEmpty) {
    const centres: number[] = [];
    for (const child of gr.children) {
      centres.push(placeUnit(canvas, child, cx, childY));
      cx += child.width + SIBLING_GAP;
    }
    cx += GROUP_GAP - SIBLING_GAP;
    const fromX = dropX.get(gr) ?? mainX + CARD_W / 2;
    const fromY = dropX.has(gr) ? midY : y + CARD_H;
    canvas.edge('child', [
      [fromX, fromY],
      [fromX, busY],
    ]);
    const lo = Math.min(fromX, ...centres);
    const hi = Math.max(fromX, ...centres);
    if (hi - lo > 1) canvas.edge('child', [
      [lo, busY],
      [hi, busY],
    ]);
    for (const c of centres) {
      canvas.edge('child', [
        [c, busY],
        [c, childY],
      ]);
    }
  }
  return mainX + CARD_W / 2;
}

// ---------------------------------------------------------------------------
// Ancestors (pedigree) layout: focus at the bottom, parents above.

interface PedNode {
  ref: CardRef;
  parents: [PedNode, PedNode] | null;
  width: number;
}

function ancestorsLayout(g: FamilyGraph, focusId: string, maxDepth: number): TreeLayout {
  const placed = new Set<string>();
  const build = (ref: CardRef, depth: number): PedNode => {
    if (ref.kind !== 'person') return { ref, parents: null, width: CARD_W };
    if (placed.has(ref.personId)) return { ref: { kind: 'link', personId: ref.personId }, parents: null, width: CARD_W };
    placed.add(ref.personId);
    const u = g.parentUnion(ref.personId);
    if (!u || depth >= maxDepth) return { ref, parents: null, width: CARD_W };
    const [father, mother] = orderParents(g, u);
    const toRef = (id: string | null): CardRef =>
      id ? { kind: 'person', personId: id } : { kind: 'ghost', unionId: u.id, forChild: ref.personId };
    const parents: [PedNode, PedNode] = [build(toRef(father), depth + 1), build(toRef(mother), depth + 1)];
    return { ref, parents, width: Math.max(CARD_W, parents[0].width + COUPLE_GAP + parents[1].width) };
  };
  const root = build({ kind: 'person', personId: focusId }, 0);

  let depth = 0;
  const walk = (n: PedNode, d: number) => {
    depth = Math.max(depth, d);
    n.parents?.forEach((p) => walk(p, d + 1));
  };
  walk(root, 0);

  const canvas = new Canvas();
  const place = (n: PedNode, left: number, d: number): number => {
    const y = (depth - d) * ROW_H;
    const x = left + (n.width - CARD_W) / 2;
    canvas.card(n.ref, x, y);
    if (n.parents) {
      const [f, m] = n.parents;
      const fx = place(f, left, d + 1);
      const mx = place(m, left + f.width + COUPLE_GAP, d + 1);
      const py = y - ROW_H + CARD_H / 2;
      const dashed = f.ref.kind === 'ghost' || m.ref.kind === 'ghost';
      canvas.edge('couple', [
        [fx + CARD_W / 2, py],
        [mx - CARD_W / 2, py],
      ], dashed);
      const midX = (fx + mx) / 2;
      const busY = y - (ROW_H - CARD_H) / 2;
      canvas.edge('child', [
        [midX, py],
        [midX, busY],
        [x + CARD_W / 2, busY],
        [x + CARD_W / 2, y],
      ]);
    }
    return x + CARD_W / 2;
  };
  place(root, 0, 0);
  return canvas.finish();
}
