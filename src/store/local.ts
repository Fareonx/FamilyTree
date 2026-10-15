import { applyChanges, type ChangeSet } from '../lib/ops';
import type { TreeData } from '../lib/types';
import type { Store } from './store';

const KEY = 'family-tree:data';
const PHOTOS = 'family-tree:photos';
const SETTINGS = 'family-tree:settings';

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    throw new Error('Browser storage is full or unavailable', { cause: e });
  }
}

/** Offline mode used when Supabase is not configured: everything lives in this browser only. */
export class LocalStore implements Store {
  readonly kind = 'local' as const;

  async load(): Promise<TreeData> {
    return read<TreeData>(KEY, { persons: [], unions: [], children: [] });
  }

  async save(changes: ChangeSet): Promise<void> {
    write(KEY, applyChanges(await this.load(), changes));
  }

  async replaceAll(data: TreeData): Promise<void> {
    write(KEY, data);
  }

  async uploadPhoto(personId: string, file: Blob): Promise<string> {
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result));
      r.onerror = () => reject(r.error);
      r.readAsDataURL(file);
    });
    const path = `${personId}/${Date.now()}.jpg`;
    write(PHOTOS, { ...read<Record<string, string>>(PHOTOS, {}), [path]: dataUrl });
    return path;
  }

  async deletePhoto(path: string): Promise<void> {
    const all = read<Record<string, string>>(PHOTOS, {});
    delete all[path];
    write(PHOTOS, all);
  }

  async photoUrls(paths: string[]): Promise<Map<string, string>> {
    const all = read<Record<string, string>>(PHOTOS, {});
    return new Map(paths.filter((p) => all[p]).map((p) => [p, all[p]]));
  }

  async getSetting<T>(key: string): Promise<T | null> {
    return (read<Record<string, unknown>>(SETTINGS, {})[key] as T) ?? null;
  }

  async setSetting<T>(key: string, value: T): Promise<void> {
    write(SETTINGS, { ...read<Record<string, unknown>>(SETTINGS, {}), [key]: value });
  }
}
