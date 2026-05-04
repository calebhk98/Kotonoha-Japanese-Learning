import fs from 'fs';
import path from 'path';

interface CacheEntry {
  word: string;
  definition: string | null;
  timestamp: number;
}

const CACHE_FILE = path.join(process.cwd(), '.cache', 'dictionary-lookups.json');

/**
 * Persistent dictionary lookup cache to speed up repeated tests.
 * Stores lookups in .cache/dictionary-lookups.json
 */
export class LookupCache {
  private cache: Map<string, string | null> = new Map();
  private dirty = false;

  constructor() {
    this.load();
  }

  private load() {
    try {
      if (fs.existsSync(CACHE_FILE)) {
        const data = fs.readFileSync(CACHE_FILE, 'utf-8');
        const entries: CacheEntry[] = JSON.parse(data);
        for (const entry of entries) {
          this.cache.set(entry.word, entry.definition);
        }
        console.log(`[Cache] Loaded ${this.cache.size} cached lookups`);
      }
    } catch (error) {
      console.warn('[Cache] Failed to load cache:', error);
    }
  }

  save() {
    if (!this.dirty) return;

    try {
      const cacheDir = path.dirname(CACHE_FILE);
      if (!fs.existsSync(cacheDir)) {
        fs.mkdirSync(cacheDir, { recursive: true });
      }

      const entries: CacheEntry[] = Array.from(this.cache.entries()).map(([word, definition]) => ({
        word,
        definition,
        timestamp: Date.now(),
      }));

      fs.writeFileSync(CACHE_FILE, JSON.stringify(entries, null, 2));
      console.log(`[Cache] Saved ${entries.length} lookups to cache`);
    } catch (error) {
      console.warn('[Cache] Failed to save cache:', error);
    }
  }

  get(word: string): string | null | undefined {
    return this.cache.get(word);
  }

  set(word: string, definition: string | null) {
    this.cache.set(word, definition);
    this.dirty = true;
  }

  has(word: string): boolean {
    return this.cache.has(word);
  }

  size(): number {
    return this.cache.size;
  }

  clear() {
    this.cache.clear();
    this.dirty = true;
  }
}
