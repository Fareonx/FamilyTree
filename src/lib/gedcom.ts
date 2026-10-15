import { emptyPerson, type Gender, type Person, type TreeData, type Union, type UnionChild } from './types';
import { isValidPartialDate } from './dates';

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

function gedDate(d: string): string {
  const [y, m, day] = d.split('-');
  return [day ? String(Number(day)) : null, m ? MONTHS[Number(m) - 1] : null, y].filter(Boolean).join(' ');
}

/** Parses GEDCOM dates like "12 MAR 1950", "MAR 1950", "ABT 1950", "1950". Qualifiers are dropped. */
export function parseGedDate(s: string): string | null {
  const tokens = s.toUpperCase().replace(/[()]/g, ' ').split(/\s+/).filter(Boolean);
  const year = [...tokens].reverse().find((t) => /^\d{4}$/.test(t));
  if (!year) return null;
  const yi = tokens.lastIndexOf(year);
  const mi = MONTHS.indexOf(tokens[yi - 1] ?? '');
  if (mi < 0) return year;
  const month = String(mi + 1).padStart(2, '0');
  const dayTok = tokens[yi - 2];
  const day = dayTok && /^\d{1,2}$/.test(dayTok) ? dayTok.padStart(2, '0') : null;
  const out = day ? `${year}-${month}-${day}` : `${year}-${month}`;
  return isValidPartialDate(out) ? out : year;
}

function noteLines(level: number, tag: string, text: string): string[] {
  const [first, ...rest] = text.replace(/\r/g, '').split('\n');
  return [`${level} ${tag} ${first}`, ...rest.map((l) => `${level + 1} CONT ${l}`)];
}

export function toGedcom(data: TreeData, opts: { photoUrl?: (p: Person) => string | null } = {}): string {
  const indiId = new Map<string, string>();
  data.persons.forEach((p, i) => indiId.set(p.id, `@I${i + 1}@`));
  const famId = new Map<string, string>();
  data.unions.forEach((u, i) => famId.set(u.id, `@F${i + 1}@`));

  const out: string[] = [
    '0 HEAD',
    '1 SOUR FamilyTree',
    '2 NAME Family Tree',
    '1 GEDC',
    '2 VERS 5.5.1',
    '2 FORM LINEAGE-LINKED',
    '1 CHAR UTF-8',
    `1 DATE ${gedDate(new Date().toISOString().slice(0, 10))}`,
  ];

  for (const p of data.persons) {
    out.push(`0 ${indiId.get(p.id)} INDI`);
    const first = p.first_name?.trim() ?? '';
    const last = p.last_name?.trim() ?? '';
    out.push(`1 NAME ${first} /${last}/`.replace(/\s+/g, ' ').trim());
    if (first) out.push(`2 GIVN ${first}`);
    if (last) out.push(`2 SURN ${last}`);
    if (p.maiden_name?.trim()) {
      out.push(`1 NAME ${first} /${p.maiden_name.trim()}/`.replace(/\s+/g, ' '));
      out.push('2 TYPE birth');
    }
    out.push(`1 SEX ${p.gender === 'male' ? 'M' : p.gender === 'female' ? 'F' : 'U'}`);
    if (p.birth_date || p.birth_place) {
      out.push('1 BIRT');
      if (p.birth_date) out.push(`2 DATE ${gedDate(p.birth_date)}`);
      if (p.birth_place) out.push(`2 PLAC ${p.birth_place}`);
    }
    if (p.death_date) {
      out.push('1 DEAT');
      out.push(`2 DATE ${gedDate(p.death_date)}`);
    } else if (p.is_deceased) {
      out.push('1 DEAT Y');
    }
    if (p.description?.trim()) out.push(...noteLines(1, 'NOTE', p.description.trim()));
    const url = opts.photoUrl?.(p);
    if (url) {
      out.push('1 OBJE', `2 FILE ${url}`, '3 FORM jpg');
    }
    for (const u of data.unions) {
      if (u.partner1_id === p.id || u.partner2_id === p.id) out.push(`1 FAMS ${famId.get(u.id)}`);
    }
    for (const c of data.children) {
      if (c.child_id === p.id) out.push(`1 FAMC ${famId.get(c.union_id)}`);
    }
  }

  const gender = new Map(data.persons.map((p) => [p.id, p.gender]));
  for (const u of data.unions) {
    out.push(`0 ${famId.get(u.id)} FAM`);
    let husb = u.partner1_id;
    let wife = u.partner2_id;
    if ((husb && gender.get(husb) === 'female') || (wife && gender.get(wife) === 'male')) [husb, wife] = [wife, husb];
    if (husb) out.push(`1 HUSB ${indiId.get(husb)}`);
    if (wife) out.push(`1 WIFE ${indiId.get(wife)}`);
    if (u.kind === 'divorced') out.push('1 DIV Y');
    for (const c of data.children.filter((c) => c.union_id === u.id)) {
      out.push(`1 CHIL ${indiId.get(c.child_id)}`);
      if (c.relation !== 'biological') {
        // MyHeritage reads the pedigree type from the child's FAMC record; keep a hint here too.
        out.push(`2 _FREL ${c.relation === 'adopted' ? 'Adopted' : 'Step'}`, `2 _MREL ${c.relation === 'adopted' ? 'Adopted' : 'Step'}`);
      }
    }
  }
  out.push('0 TRLR');
  return out.join('\r\n') + '\r\n';
}

interface GedNode {
  level: number;
  xref: string | null;
  tag: string;
  value: string;
  children: GedNode[];
}

function parseTree(text: string): GedNode[] {
  const roots: GedNode[] = [];
  const stack: GedNode[] = [];
  for (const raw of text.replace(/^﻿/, '').split(/\r?\n|\r/)) {
    const m = raw.match(/^\s*(\d+)\s+(@[^@]+@\s+)?(\S+)\s?(.*)$/);
    if (!m) continue;
    const node: GedNode = { level: Number(m[1]), xref: m[2]?.trim() ?? null, tag: m[3].toUpperCase(), value: m[4] ?? '', children: [] };
    while (stack.length && stack[stack.length - 1].level >= node.level) stack.pop();
    if (stack.length) stack[stack.length - 1].children.push(node);
    else roots.push(node);
    stack.push(node);
  }
  return roots;
}

const child = (n: GedNode, tag: string) => n.children.find((c) => c.tag === tag);
const children = (n: GedNode, tag: string) => n.children.filter((c) => c.tag === tag);

function fullText(n: GedNode): string {
  let s = n.value;
  for (const c of n.children) {
    if (c.tag === 'CONT') s += '\n' + c.value;
    else if (c.tag === 'CONC') s += c.value;
  }
  return s;
}

export interface GedcomImport {
  data: TreeData;
  /** GEDCOM xref → new person id */
  idMap: Map<string, string>;
}

export function fromGedcom(text: string, newId: () => string = () => crypto.randomUUID()): GedcomImport {
  const roots = parseTree(text);
  const idMap = new Map<string, string>();
  const persons: Person[] = [];
  const unions: Union[] = [];
  const kids: UnionChild[] = [];

  for (const n of roots.filter((r) => r.tag === 'INDI' && r.xref)) {
    const id = newId();
    idMap.set(n.xref!, id);
    const names = children(n, 'NAME');
    const main = names.find((x) => child(x, 'TYPE')?.value.toLowerCase() !== 'birth') ?? names[0];
    const maiden = names.find((x) => child(x, 'TYPE')?.value.toLowerCase() === 'birth' || child(x, 'TYPE')?.value.toLowerCase() === 'maiden');
    const split = (v: string | undefined) => {
      const m = (v ?? '').match(/^([^/]*)\/?([^/]*)\/?(.*)$/);
      return { given: (m?.[1] ?? '').trim(), surname: (m?.[2] ?? '').trim() };
    };
    const nm = split(main?.value);
    const given = child(main ?? n, 'GIVN')?.value.trim() || nm.given;
    const surname = child(main ?? n, 'SURN')?.value.trim() || nm.surname;
    const sex = child(n, 'SEX')?.value.trim().toUpperCase();
    const gender: Gender = sex === 'M' ? 'male' : sex === 'F' ? 'female' : 'unknown';
    const birt = child(n, 'BIRT');
    const deat = child(n, 'DEAT');
    const notes = children(n, 'NOTE').map(fullText).filter((s) => s && !s.startsWith('@'));
    persons.push(
      emptyPerson(id, {
        first_name: given && given !== '???' ? given : null,
        last_name: surname || null,
        maiden_name: maiden ? split(maiden.value).surname || null : null,
        gender,
        birth_date: birt && child(birt, 'DATE') ? parseGedDate(child(birt, 'DATE')!.value) : null,
        birth_place: (birt && child(birt, 'PLAC')?.value.trim()) || null,
        death_date: deat && child(deat, 'DATE') ? parseGedDate(child(deat, 'DATE')!.value) : null,
        is_deceased: !!deat,
        description: notes.length ? notes.join('\n\n') : null,
      }),
    );
  }

  roots
    .filter((r) => r.tag === 'FAM')
    .forEach((n, i) => {
      const id = newId();
      const husb = child(n, 'HUSB')?.value.trim();
      const wife = child(n, 'WIFE')?.value.trim();
      unions.push({
        id,
        partner1_id: (husb && idMap.get(husb)) || null,
        partner2_id: (wife && idMap.get(wife)) || null,
        kind: child(n, 'DIV') ? 'divorced' : child(n, 'MARR') ? 'married' : 'married',
        sort_order: i,
      });
      children(n, 'CHIL').forEach((c, j) => {
        const pid = idMap.get(c.value.trim());
        if (!pid) return;
        const rel = (child(c, '_FREL')?.value ?? child(c, '_MREL')?.value ?? '').toLowerCase();
        kids.push({
          union_id: id,
          child_id: pid,
          relation: rel.startsWith('adopt') ? 'adopted' : rel.startsWith('step') ? 'step' : rel.startsWith('foster') ? 'foster' : 'biological',
          sort_order: j,
        });
      });
    });

  return { data: { persons, unions, children: kids }, idMap };
}
