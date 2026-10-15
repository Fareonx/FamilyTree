import type { PartialDate } from './types';

const PARTIAL_DATE = /^\d{4}(-\d{2}(-\d{2})?)?$/;

export function isValidPartialDate(s: string): boolean {
  if (!PARTIAL_DATE.test(s)) return false;
  const [, m, d] = s.split('-').map(Number);
  if (m !== undefined && (m < 1 || m > 12)) return false;
  if (d !== undefined && (d < 1 || d > 31)) return false;
  return true;
}

export function formatYear(d: PartialDate | null): string {
  return d ? d.slice(0, 4) : '';
}

/** 'YYYY-MM-DD' → 'DD.MM.YYYY', 'YYYY-MM' → 'MM.YYYY', 'YYYY' → 'YYYY'. */
export function formatDate(d: PartialDate | null): string {
  if (!d) return '';
  return d.split('-').reverse().join('.');
}

/** Accepts 'DD.MM.YYYY', 'MM.YYYY', 'YYYY' (also with '/' or '-') and returns a partial date or null. */
export function parseDateInput(input: string): PartialDate | null | 'invalid' {
  const s = input.trim();
  if (!s) return null;
  if (PARTIAL_DATE.test(s)) return isValidPartialDate(s) ? s : 'invalid';
  const parts = s.split(/[./\-\s]+/).filter(Boolean);
  if (parts.length < 1 || parts.length > 3) return 'invalid';
  const year = parts[parts.length - 1];
  if (!/^\d{4}$/.test(year)) return 'invalid';
  const rest = parts.slice(0, -1).reverse().map((x) => x.padStart(2, '0'));
  const out = [year, ...rest].join('-');
  return isValidPartialDate(out) ? out : 'invalid';
}

export function ageAt(birth: PartialDate | null, at: PartialDate | null = null): number | null {
  if (!birth) return null;
  const end = at ?? new Date().toISOString().slice(0, 10);
  const by = Number(birth.slice(0, 4));
  const ey = Number(end.slice(0, 4));
  let age = ey - by;
  if (birth.length >= 7 && end.length >= 7 && end.slice(5) < birth.slice(5)) age -= 1;
  return age >= 0 ? age : null;
}
