import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { ChangeSet } from '../lib/ops';
import type { Person, TreeData, Union, UnionChild } from '../lib/types';
import type { Store } from './store';

const URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const supabase: SupabaseClient | null = URL && KEY ? createClient(URL, KEY) : null;

const BUCKET = 'photos';
const PERSON_COLS = 'id,first_name,last_name,maiden_name,gender,birth_date,birth_place,death_date,is_deceased,photo_path,description';

function check<T>(res: { data: T; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message);
  return res.data;
}

async function selectAll<T>(client: SupabaseClient, table: string, cols: string): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const page = check(await client.from(table).select(cols).range(from, from + 999)) as T[];
    out.push(...page);
    if (page.length < 1000) return out;
  }
}

export class SupabaseStore implements Store {
  readonly kind = 'supabase' as const;
  private urlCache = new Map<string, { url: string; expires: number }>();

  constructor(private client: SupabaseClient) {}

  async load(): Promise<TreeData> {
    const [persons, unions, children] = await Promise.all([
      selectAll<Person>(this.client, 'persons', PERSON_COLS),
      selectAll<Union>(this.client, 'unions', 'id,partner1_id,partner2_id,kind,sort_order'),
      selectAll<UnionChild>(this.client, 'union_children', 'union_id,child_id,relation,sort_order'),
    ]);
    return { persons, unions, children };
  }

  /** Order matters for foreign keys: create first, then link, then remove. */
  async save(ch: ChangeSet): Promise<void> {
    const c = this.client;
    if (ch.upsertPersons.length) check(await c.from('persons').upsert(ch.upsertPersons));
    if (ch.upsertUnions.length) check(await c.from('unions').upsert(ch.upsertUnions));
    if (ch.upsertChildren.length) check(await c.from('union_children').upsert(ch.upsertChildren));
    for (const d of ch.deleteChildren) {
      check(await c.from('union_children').delete().eq('union_id', d.union_id).eq('child_id', d.child_id));
    }
    if (ch.deleteUnions.length) check(await c.from('unions').delete().in('id', ch.deleteUnions));
    if (ch.deletePersons.length) check(await c.from('persons').delete().in('id', ch.deletePersons));
  }

  async replaceAll(data: TreeData): Promise<void> {
    const c = this.client;
    check(await c.from('union_children').delete().not('child_id', 'is', null));
    check(await c.from('unions').delete().not('id', 'is', null));
    check(await c.from('persons').delete().not('id', 'is', null));
    for (let i = 0; i < data.persons.length; i += 500) check(await c.from('persons').insert(data.persons.slice(i, i + 500)));
    for (let i = 0; i < data.unions.length; i += 500) check(await c.from('unions').insert(data.unions.slice(i, i + 500)));
    for (let i = 0; i < data.children.length; i += 500) check(await c.from('union_children').insert(data.children.slice(i, i + 500)));
  }

  async uploadPhoto(personId: string, file: Blob): Promise<string> {
    const path = `${personId}/${Date.now()}.jpg`;
    check(await this.client.storage.from(BUCKET).upload(path, file, { contentType: file.type || 'image/jpeg', upsert: false }));
    return path;
  }

  async deletePhoto(path: string): Promise<void> {
    check(await this.client.storage.from(BUCKET).remove([path]));
    this.urlCache.delete(path);
  }

  async photoUrls(paths: string[]): Promise<Map<string, string>> {
    const now = Date.now();
    const out = new Map<string, string>();
    const missing: string[] = [];
    for (const p of paths) {
      const hit = this.urlCache.get(p);
      if (hit && hit.expires > now) out.set(p, hit.url);
      else missing.push(p);
    }
    if (missing.length) {
      const ttl = 60 * 60;
      const res = check(await this.client.storage.from(BUCKET).createSignedUrls(missing, ttl));
      for (const r of res ?? []) {
        if (r.signedUrl && r.path) {
          out.set(r.path, r.signedUrl);
          this.urlCache.set(r.path, { url: r.signedUrl, expires: now + (ttl - 300) * 1000 });
        }
      }
    }
    return out;
  }

  async getSetting<T>(key: string): Promise<T | null> {
    const rows = check(await this.client.from('settings').select('value').eq('key', key)) as Array<{ value: T }>;
    return rows[0]?.value ?? null;
  }

  async setSetting<T>(key: string, value: T): Promise<void> {
    check(await this.client.from('settings').upsert({ key, value }));
  }
}
