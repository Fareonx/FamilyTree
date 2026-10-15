import type { Person } from './types';
import { formatYear } from './dates';

export function displayName(p: Person | undefined | null): string {
  if (!p) return '?';
  const first = p.first_name?.trim();
  const last = p.last_name?.trim();
  if (!first && !last) return '???';
  return [first || '???', last].filter(Boolean).join(' ');
}

export function shortName(p: Person | undefined | null): string {
  if (!p) return '?';
  return p.first_name?.trim() || '???';
}

export function isUnnamed(p: Person): boolean {
  return !p.first_name?.trim() && !p.last_name?.trim();
}

export function lifeSpan(p: Person): string {
  const b = formatYear(p.birth_date);
  const d = formatYear(p.death_date);
  if (b && d) return `${b} – ${d}`;
  if (b && p.is_deceased) return `${b} – ?`;
  if (b) return `${b}`;
  if (d) return `? – ${d}`;
  return '';
}

/** Lowercase, strip diacritics and map Azerbaijani letters so "Elcin" finds "Elçin". */
export function normalizeForSearch(s: string): string {
  return s
    .toLocaleLowerCase('az')
    .replace(/ə/g, 'e')
    .replace(/ı/g, 'i')
    .replace(/ğ/g, 'g')
    .replace(/ş/g, 's')
    .replace(/ç/g, 'c')
    .replace(/ö/g, 'o')
    .replace(/ü/g, 'u')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}
