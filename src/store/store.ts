import type { ChangeSet } from '../lib/ops';
import type { TreeData } from '../lib/types';

export interface Store {
  readonly kind: 'supabase' | 'local';
  load(): Promise<TreeData>;
  save(changes: ChangeSet): Promise<void>;
  /** Replaces everything (JSON backup restore / GEDCOM import as a fresh tree). */
  replaceAll(data: TreeData): Promise<void>;
  uploadPhoto(personId: string, file: Blob): Promise<string>;
  deletePhoto(path: string): Promise<void>;
  photoUrls(paths: string[]): Promise<Map<string, string>>;
  getSetting<T>(key: string): Promise<T | null>;
  setSetting<T>(key: string, value: T): Promise<void>;
}
