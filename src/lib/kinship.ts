import type { FamilyGraph } from './graph';
import type { Gender } from './types';

/**
 * One way two people are related by blood: through a common ancestor (or ancestral couple).
 * egoPath runs ego → ancestor, targetPath runs ancestor → target.
 */
export interface BloodLink {
  ancestors: string[];
  up: number;
  down: number;
  egoPath: string[];
  targetPath: string[];
  /** Related through only one of the two parents (half-siblings and their lines). */
  half: boolean;
}

export type Relation =
  | { type: 'self' }
  | { type: 'spouse' }
  | { type: 'blood'; link: BloodLink }
  /** target is married to `via`, who is a blood relative of ego */
  | { type: 'spouse-of'; via: string; link: BloodLink }
  /** target is a blood relative of ego's spouse `via` */
  | { type: 'spouse-relative'; via: string; link: BloodLink };

const MAX_GENERATIONS = 14;

/**
 * Every ancestor of `id` (including `id` itself at distance 0) with each distinct path to it.
 * Unknown parents appear as placeholder ids starting with '?'.
 */
function ancestorPaths(g: FamilyGraph, id: string): Map<string, string[][]> {
  const out = new Map<string, string[][]>();
  const walk = (path: string[]) => {
    const cur = path[path.length - 1];
    const list = out.get(cur);
    if (list) list.push(path);
    else out.set(cur, [path]);
    if (path.length > MAX_GENERATIONS) return;
    if (cur.startsWith('?')) return;
    for (const u of g.parentUnions(cur)) {
      // An unknown parent still makes the children siblings: stand in a placeholder for the empty slot.
      const slots = [u.partner1_id ?? `?${u.id}:1`, u.partner2_id ?? `?${u.id}:2`];
      for (const p of slots) {
        if (!path.includes(p)) walk([...path, p]);
      }
    }
  };
  walk([id]);
  return out;
}

export function bloodLinks(g: FamilyGraph, egoId: string, targetId: string): BloodLink[] {
  if (egoId === targetId) return [];
  const egoAnc = ancestorPaths(g, egoId);
  const targetAnc = ancestorPaths(g, targetId);
  const byKey = new Map<string, BloodLink>();

  for (const [anc, egoPaths] of egoAnc) {
    const tPaths = targetAnc.get(anc);
    if (!tPaths) continue;
    for (const ep of egoPaths) {
      for (const tpRev of tPaths) {
        // Only the closest meeting point counts: the two lines must not share anyone below the ancestor.
        const shared = ep.filter((x) => tpRev.includes(x));
        if (shared.length !== 1) continue;
        const tp = [...tpRev].reverse();
        // Both members of the ancestral couple give the same path; merge them into one link.
        const key = `${ep.slice(0, -1).join('>')}|${tp.slice(1).join('>')}`;
        const existing = byKey.get(key);
        if (existing) {
          if (!existing.ancestors.includes(anc)) existing.ancestors.push(anc);
          continue;
        }
        byKey.set(key, {
          ancestors: [anc],
          up: ep.length - 1,
          down: tp.length - 1,
          egoPath: ep,
          targetPath: tp,
          half: false,
        });
      }
    }
  }

  const links = [...byKey.values()];
  for (const l of links) {
    if (l.up === 0 || l.down === 0) continue;
    // Half relation: the two children of the ancestor do not share the same parent couple.
    const a = l.egoPath[l.egoPath.length - 2];
    const b = l.targetPath[1];
    const ua = new Set(g.parentUnions(a).map((u) => u.id));
    const shareCouple = g.parentUnions(b).some((u) => ua.has(u.id));
    l.half = !shareCouple && l.ancestors.length === 1;
  }
  return links.sort((x, y) => x.up + x.down - (y.up + y.down));
}

export function relations(g: FamilyGraph, egoId: string, targetId: string): Relation[] {
  if (egoId === targetId) return [{ type: 'self' }];
  const out: Relation[] = [];
  if (g.spousesOf(egoId).includes(targetId)) out.push({ type: 'spouse' });
  for (const link of bloodLinks(g, egoId, targetId)) out.push({ type: 'blood', link });
  for (const s of g.spousesOf(targetId)) {
    if (s === egoId) continue;
    for (const link of bloodLinks(g, egoId, s)) out.push({ type: 'spouse-of', via: s, link });
  }
  for (const s of g.spousesOf(egoId)) {
    if (s === targetId) continue;
    for (const link of bloodLinks(g, s, targetId)) out.push({ type: 'spouse-relative', via: s, link });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Wording

export type Lang = 'ru' | 'az';

export interface LinkWording {
  /** e.g. "троюродный брат мамы" */
  term: string;
  /** "по папе" / "по маме" when the line goes through one parent */
  side: string | null;
}

export function describeLink(g: FamilyGraph, link: BloodLink, lang: Lang): LinkWording {
  const gender = (id: string | undefined): Gender => (id ? g.person(id)?.gender ?? 'unknown' : 'unknown');
  const { up, down, egoPath, targetPath, half } = link;
  const target = targetPath[targetPath.length - 1];
  const tg = gender(target);
  let side: string | null = null;
  if (up >= 1 && !(up === 1 && down === 0) && !(up === 1 && down === 1)) {
    const parent = gender(egoPath[1]);
    if (parent !== 'unknown') side = SIDE[lang][parent];
  }
  const facts: Facts = {
    up,
    down,
    half,
    target: tg,
    // ancestor's child on ego's side and on target's side
    egoAnchor: (k: number) => gender(egoPath[k]),
    targetLine: (k: number) => gender(targetPath[k]),
    ancestorGender: link.ancestors.length === 1 ? gender(link.ancestors[0]) : 'unknown',
  };
  return { term: lang === 'ru' ? ruTerm(facts) : azTerm(facts), side };
}

interface Facts {
  up: number;
  down: number;
  half: boolean;
  target: Gender;
  egoAnchor: (level: number) => Gender;
  targetLine: (depth: number) => Gender;
  ancestorGender: Gender;
}

const SIDE = {
  ru: { male: 'по папе', female: 'по маме' },
  az: { male: 'ata tərəfdən', female: 'ana tərəfdən' },
};

const pick = (g: Gender, m: string, f: string, u: string) => (g === 'male' ? m : g === 'female' ? f : u);

// --- Russian -----------------------------------------------------------------

function ruAncestor(level: number, g: Gender): string {
  if (level === 1) return pick(g, 'отец', 'мать', 'родитель');
  if (level === 2) return pick(g, 'дедушка', 'бабушка', 'дедушка/бабушка');
  return 'пра'.repeat(level - 2) + pick(g, 'дедушка', 'бабушка', 'дедушка/бабушка');
}

function ruAncestorGen(level: number, g: Gender): string {
  if (level === 1) return pick(g, 'папы', 'мамы', 'родителя');
  if (level === 2) return pick(g, 'дедушки', 'бабушки', 'дедушки/бабушки');
  return 'пра'.repeat(level - 2) + pick(g, 'дедушки', 'бабушки', 'дедушки/бабушки');
}

function ruDescendant(depth: number, g: Gender): string {
  if (depth === 1) return pick(g, 'сын', 'дочь', 'ребёнок');
  if (depth === 2) return pick(g, 'внук', 'внучка', 'внук/внучка');
  return 'пра'.repeat(depth - 2) + pick(g, 'внук', 'внучка', 'внук/внучка');
}

const RU_COUSIN_M = ['', '', 'двоюродный', 'троюродный', 'четвероюродный', 'пятиюродный', 'шестиюродный'];

function ruCousinAdj(degree: number, g: Gender, genitive: boolean): string {
  const base = RU_COUSIN_M[degree] ?? `${degree}-юродный`;
  const stem = base.slice(0, -2); // "двоюродн"
  if (g === 'female') return stem + (genitive ? 'ой' : 'ая');
  return stem + (genitive ? 'ого' : 'ый');
}

/** brother/sister of degree m (1 = sibling, 2 = first cousin, ...). */
function ruSibling(m: number, g: Gender, genitive: boolean, half: boolean, ancestor: Gender): string {
  const noun = genitive ? pick(g, 'брата', 'сестры', 'брата/сестры') : pick(g, 'брат', 'сестра', 'брат/сестра');
  if (m === 1) {
    if (!half) return noun;
    const adj =
      ancestor === 'male' ? 'единокровн' : ancestor === 'female' ? 'единоутробн' : 'неполнородн';
    const end = g === 'female' ? (genitive ? 'ой' : 'ая') : genitive ? 'ого' : 'ый';
    return `${adj}${end} ${noun}`;
  }
  return `${ruCousinAdj(m, g, genitive)} ${noun}`;
}

function ruTerm(f: Facts): string {
  const { up, down, target } = f;
  if (down === 0) return ruAncestor(up, target);
  if (up === 0) return ruDescendant(down, target);
  const m = Math.min(up, down);
  const a = up - m; // how far above ego the anchor is
  const d = down - m; // how far below the cousin-level person the target is
  const cGender = f.targetLine(m);
  const anchorGender = f.egoAnchor(a);
  const half = f.half ? ' (по одному из родителей)' : '';

  // Words Russian has for the common cases.
  if (m === 1 && a === 1 && d === 0) return pick(target, 'дядя', 'тётя', 'дядя/тётя') + half;
  if (m === 1 && a === 0 && d === 1) return pick(target, 'племянник', 'племянница', 'племянник/племянница') + half;
  if (m === 1 && a === 2 && d === 0) return pick(target, 'двоюродный дедушка', 'двоюродная бабушка', 'двоюродный дедушка/бабушка') + half;
  if (m === 1 && a === 0 && d === 2) return pick(target, 'внучатый племянник', 'внучатая племянница', 'внучатый племянник/племянница') + half;
  if (m >= 2 && a === 1 && d === 0) return `${ruCousinAdj(m, target, false)} ${pick(target, 'дядя', 'тётя', 'дядя/тётя')}`;
  if (m >= 2 && a === 0 && d === 1) return `${ruCousinAdj(m, target, false)} ${pick(target, 'племянник', 'племянница', 'племянник/племянница')}`;

  const parts: string[] = [];
  if (d > 0) parts.push(ruDescendant(d, target));
  parts.push(ruSibling(m, cGender, d > 0, f.half, f.ancestorGender));
  if (a > 0) parts.push(ruAncestorGen(a, anchorGender));
  return parts.join(' ');
}

// --- Azerbaijani -------------------------------------------------------------

function azUlu(level: number): string {
  return level > 2 ? 'ulu '.repeat(level - 2) : '';
}

function azAncestorMine(level: number, g: Gender, genitive: boolean): string {
  if (level === 1) return genitive ? pick(g, 'atamın', 'anamın', 'valideynimin') : pick(g, 'atam', 'anam', 'valideynim');
  const word = genitive ? pick(g, 'babamın', 'nənəmin', 'babamın/nənəmin') : pick(g, 'babam', 'nənəm', 'babam/nənəm');
  return azUlu(level) + word;
}

function azDescendantMine(depth: number, g: Gender): string {
  if (depth === 1) return pick(g, 'oğlum', 'qızım', 'övladım');
  if (depth === 2) return 'nəvəm';
  if (depth === 3) return 'nəticəm';
  if (depth === 4) return 'kötücəm';
  return `${depth - 1}-ci nəsil nəvəm`;
}

/** Possessed form ("his/her ..."), e.g. "oğlu", "nəvəsi". */
function azDescendantOf(depth: number, g: Gender): string {
  if (depth === 1) return pick(g, 'oğlu', 'qızı', 'övladı');
  if (depth === 2) return 'nəvəsi';
  if (depth === 3) return 'nəticəsi';
  if (depth === 4) return 'kötücəsi';
  return `${depth - 1}-ci nəsil nəvəsi`;
}

function azTerm(f: Facts): string {
  const { up, down, target } = f;
  if (down === 0) return azAncestorMine(up, target, false);
  if (up === 0) return azDescendantMine(down, target);
  const half = !f.half ? '' : f.ancestorGender === 'male' ? ' (ata bir)' : f.ancestorGender === 'female' ? ' (ana bir)' : ' (yarım)';

  if (up === 1 && down === 1) return pick(target, 'qardaşım', 'bacım', 'qardaşım/bacım') + half;
  const parentSide = f.egoAnchor(1); // father or mother of ego
  const auntUncle = (g: Gender) =>
    parentSide === 'female' ? pick(g, 'dayı', 'xala', 'dayı/xala') : parentSide === 'male' ? pick(g, 'əmi', 'bibi', 'əmi/bibi') : pick(g, 'əmi/dayı', 'bibi/xala', 'əmi/bibi/dayı/xala');
  if (up === 2 && down === 1) return auntUncle(target) + half;
  if (up === 1 && down === 2) {
    const sib = f.targetLine(1);
    return `${pick(sib, 'qardaşımın', 'bacımın', 'qardaşımın/bacımın')} ${pick(target, 'oğlu', 'qızı', 'övladı')}` + half;
  }
  if (up === 2 && down === 2) {
    const base = auntUncle(f.targetLine(1));
    return base + pick(target, 'oğlu', 'qızı', ' övladı') + half;
  }

  // General form: "<my ancestor>'s <brother/sister>'s <descendant>",
  // e.g. "babamın bacısının nəvəsi" — grandfather's sister's grandchild.
  const a = up - 1;
  const d = down - 1;
  const sib = f.targetLine(1);
  const parts: string[] = [];
  parts.push(a === 0 ? '' : azAncestorMine(a, f.egoAnchor(a), true));
  if (d === 0) parts.push(pick(sib, 'qardaşı', 'bacısı', 'qardaşı/bacısı'));
  else {
    parts.push(pick(sib, 'qardaşının', 'bacısının', 'qardaşının/bacısının'));
    parts.push(azDescendantOf(d, target));
  }
  return parts.filter(Boolean).join(' ') + half;
}
