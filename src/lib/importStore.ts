import fs from 'fs';
import path from 'path';
import { RESOLVED_FORMAT_VERSION } from './contentResolver.js';
import type { Content } from '../data/content.js';

/**
 * Server-side store for user-imported texts (and user edits of disk
 * content): one JSON file per item holding the content AND its resolved
 * document, written once when the text is imported or edited. The reader,
 * the vocab list and inspect-text all read that document, so an imported
 * book is processed once instead of on every visit, and every view shows
 * the same resolution.
 */

/** Ids double as file names: letters, digits, '-' and '_' only. */
export function isValidImportId(id: string): boolean {
  return typeof id === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(id);
}

export interface StoredImport {
  content: Content;
  /** Null when the stored document is from an incompatible format version. */
  resolved: any | null;
}

export class ImportStore {
  constructor(private readonly dir: string) {}

  private file(id: string): string | null {
    return isValidImportId(id) ? path.join(this.dir, `${id}.json`) : null;
  }

  save(content: Content, resolved: any): void {
    const file = this.file(content.id);
    if (!file) throw new Error(`Invalid import id: ${content.id}`);
    fs.mkdirSync(this.dir, { recursive: true });
    // Write-then-rename so a crash mid-write never leaves a torn file.
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ content, resolved, savedAt: new Date().toISOString() }));
    fs.renameSync(tmp, file);
  }

  get(id: string): StoredImport | null {
    const file = this.file(id);
    if (!file || !fs.existsSync(file)) return null;
    try {
      const data = JSON.parse(fs.readFileSync(file, 'utf-8'));
      const resolved = data.resolved?.formatVersion === RESOLVED_FORMAT_VERSION ? data.resolved : null;
      return { content: data.content, resolved };
    } catch {
      return null;
    }
  }

  list(): Content[] {
    if (!fs.existsSync(this.dir)) return [];
    const out: Content[] = [];
    for (const name of fs.readdirSync(this.dir)) {
      if (!name.endsWith('.json')) continue;
      const stored = this.get(name.slice(0, -5));
      if (stored?.content) out.push(stored.content);
    }
    return out;
  }

  remove(id: string): boolean {
    const file = this.file(id);
    if (!file || !fs.existsSync(file)) return false;
    fs.unlinkSync(file);
    return true;
  }
}
