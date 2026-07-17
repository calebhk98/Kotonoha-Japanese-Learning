import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { DictionaryEntry } from './scoring.js';
import { WordInfo } from '../types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Resolved lazily inside initDatabase() rather than once at module load: this
// module is only ever imported once per process, so a module-level constant
// would freeze in whatever DATABASE_PATH happened to be set (or unset) at
// first import — before tests (or any other caller) get a chance to set it
// in a beforeEach. That used to silently redirect test writes into the real
// .cache.db at the repo root instead of an isolated test path.
function resolveDbPath(): string {
  return process.env.DATABASE_PATH || path.join(__dirname, '../../.cache.db');
}

let db: Database.Database | null = null;

export async function initDatabase() {
  const dbPath = resolveDbPath();
  const existed = fs.existsSync(dbPath);
  db = new Database(dbPath);
  createTables();
  console.log(existed ? '[Database] Loaded existing database' : '[Database] Created new database');
}

function createTables() {
  if (!db) throw new Error('Database not initialized');

  db.exec(`
    CREATE TABLE IF NOT EXISTS words_cache (
      word TEXT PRIMARY KEY,
      entries TEXT NOT NULL
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS jisho_cache (
      word TEXT PRIMARY KEY,
      result TEXT NOT NULL
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS content_words (
      content_id TEXT NOT NULL,
      word TEXT NOT NULL,
      reading TEXT NOT NULL,
      meaning TEXT NOT NULL,
      meanings TEXT,
      jlpt INTEGER NOT NULL DEFAULT 0,
      joyo INTEGER NOT NULL DEFAULT 0,
      score REAL NOT NULL DEFAULT 0,
      breakdown TEXT NOT NULL,
      frequency INTEGER NOT NULL DEFAULT 1,
      is_morpheme INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (content_id, word)
    )
  `);

  console.log('[Database] Tables created');
}

// better-sqlite3 writes each statement through to disk transactionally as it
// runs — there is no in-memory-only database to flush. The old sql.js-backed
// implementation held the whole DB in memory and only wrote out on this call
// (throttled by an isDirty flag), which meant a SIGKILL between writes and
// the next throttled save silently lost data (issue #253). saveDatabase() is
// kept as a no-op export purely so existing call sites in server.ts don't
// need to change.
export async function saveDatabase(): Promise<void> {
  return;
}

export class WordsCache {
  private memoryCache: Map<string, DictionaryEntry[]> = new Map();
  private isPreloaded = false;

  async set(key: string, value: DictionaryEntry[]) {
    if (!db) throw new Error('Database not initialized');
    db.prepare(
      'INSERT OR REPLACE INTO words_cache (word, entries) VALUES (?, ?)'
    ).run(key, JSON.stringify(value));
    this.memoryCache.set(key, value);
  }

  get(key: string): DictionaryEntry[] | undefined {
    if (!db) throw new Error('Database not initialized');
    // Check memory cache first (fast path)
    if (this.memoryCache.has(key)) {
      return this.memoryCache.get(key);
    }

    // Fall back to database
    const row = db.prepare(
      'SELECT entries FROM words_cache WHERE word = ?'
    ).get(key) as { entries: string } | undefined;
    if (!row) {
      return undefined;
    }
    const entries = JSON.parse(row.entries);
    this.memoryCache.set(key, entries);
    return entries;
  }

  has(key: string): boolean {
    if (!db) throw new Error('Database not initialized');
    // Check memory cache first
    if (this.memoryCache.has(key)) {
      return true;
    }

    // Fall back to database
    const row = db.prepare(
      'SELECT 1 FROM words_cache WHERE word = ?'
    ).get(key);
    return row !== undefined;
  }

  async clear() {
    if (!db) throw new Error('Database not initialized');
    db.prepare('DELETE FROM words_cache').run();
    this.memoryCache.clear();
  }

  entries(): [string, DictionaryEntry[]][] {
    if (!db) throw new Error('Database not initialized');
    const rows = db.prepare('SELECT word, entries FROM words_cache').all() as { word: string; entries: string }[];
    return rows.map(({ word, entries }) => [word, JSON.parse(entries)]);
  }

  get size(): number {
    if (!db) throw new Error('Database not initialized');
    const row = db.prepare('SELECT COUNT(*) as count FROM words_cache').get() as { count: number };
    return row.count;
  }

  preload(): void {
    if (!db) throw new Error('Database not initialized');
    if (this.isPreloaded) return;

    const rows = db.prepare('SELECT word, entries FROM words_cache').all() as { word: string; entries: string }[];
    for (const { word, entries } of rows) {
      this.memoryCache.set(word, JSON.parse(entries));
    }
    this.isPreloaded = true;
  }
}

export class JishoCache {
  async set(key: string, value: any) {
    if (!db) throw new Error('Database not initialized');
    db.prepare(
      'INSERT OR REPLACE INTO jisho_cache (word, result) VALUES (?, ?)'
    ).run(key, JSON.stringify(value));
  }

  get(key: string): any | undefined {
    if (!db) throw new Error('Database not initialized');
    const row = db.prepare(
      'SELECT result FROM jisho_cache WHERE word = ?'
    ).get(key) as { result: string } | undefined;
    if (!row) {
      return undefined;
    }
    return JSON.parse(row.result);
  }

  has(key: string): boolean {
    if (!db) throw new Error('Database not initialized');
    const row = db.prepare(
      'SELECT 1 FROM jisho_cache WHERE word = ?'
    ).get(key);
    return row !== undefined;
  }

  async clear() {
    if (!db) throw new Error('Database not initialized');
    db.prepare('DELETE FROM jisho_cache').run();
  }

  entries(): [string, any][] {
    if (!db) throw new Error('Database not initialized');
    const rows = db.prepare('SELECT word, result FROM jisho_cache').all() as { word: string; result: string }[];
    return rows.map(({ word, result }) => [word, JSON.parse(result)]);
  }

  get size(): number {
    if (!db) throw new Error('Database not initialized');
    const row = db.prepare('SELECT COUNT(*) as count FROM jisho_cache').get() as { count: number };
    return row.count;
  }
}

export class ContentWordsStore {
  async setContentWords(contentId: string, words: WordInfo[]): Promise<void> {
    if (!db) throw new Error('Database not initialized');
    const deleteExisting = db.prepare('DELETE FROM content_words WHERE content_id = ?');
    const insert = db.prepare(
      `INSERT INTO content_words
         (content_id, word, reading, meaning, meanings, jlpt, joyo, score, breakdown, frequency, is_morpheme)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    const runInTransaction = db.transaction((items: WordInfo[]) => {
      deleteExisting.run(contentId);
      for (const w of items) {
        insert.run(
          contentId,
          w.word,
          w.reading,
          w.meaning,
          w.meanings ? JSON.stringify(w.meanings) : null,
          w.jlpt,
          w.joyo ? 1 : 0,
          w.score,
          JSON.stringify(w.breakdown ?? {}),
          w.frequencyInContent ?? 1,
          w.isMorpheme ? 1 : 0,
        );
      }
    });
    runInTransaction(words);
  }

  getContentWords(contentId: string): WordInfo[] {
    if (!db) throw new Error('Database not initialized');
    const rows = db.prepare(
      `SELECT word, reading, meaning, meanings, jlpt, joyo, score, breakdown, frequency, is_morpheme
       FROM content_words WHERE content_id = ?
       ORDER BY rowid`
    ).all(contentId) as ContentWordRow[];
    return rows.map(rowToWordInfo);
  }

  getAllContentWords(): Record<string, WordInfo[]> {
    if (!db) throw new Error('Database not initialized');
    const rows = db.prepare(
      `SELECT content_id, word, reading, meaning, meanings, jlpt, joyo, score, breakdown, frequency, is_morpheme
       FROM content_words ORDER BY content_id, rowid`
    ).all() as (ContentWordRow & { content_id: string })[];
    const out: Record<string, WordInfo[]> = {};
    for (const row of rows) {
      if (!out[row.content_id]) out[row.content_id] = [];
      out[row.content_id].push(rowToWordInfo(row));
    }
    return out;
  }

  hasContent(contentId: string): boolean {
    if (!db) throw new Error('Database not initialized');
    const row = db.prepare(
      'SELECT 1 FROM content_words WHERE content_id = ? LIMIT 1'
    ).get(contentId);
    return row !== undefined;
  }

  async deleteContentWords(contentId: string): Promise<void> {
    if (!db) throw new Error('Database not initialized');
    db.prepare('DELETE FROM content_words WHERE content_id = ?').run(contentId);
  }

  async clear(): Promise<void> {
    if (!db) throw new Error('Database not initialized');
    db.prepare('DELETE FROM content_words').run();
  }
}

interface ContentWordRow {
  word: string;
  reading: string;
  meaning: string;
  meanings: string | null;
  jlpt: number;
  joyo: number;
  score: number;
  breakdown: string;
  frequency: number;
  is_morpheme: number;
}

function rowToWordInfo(row: ContentWordRow): WordInfo {
  return {
    word: row.word,
    reading: row.reading,
    meaning: row.meaning,
    ...(row.meanings ? { meanings: JSON.parse(row.meanings) } : {}),
    jlpt: row.jlpt,
    joyo: row.joyo === 1,
    score: row.score,
    breakdown: JSON.parse(row.breakdown),
    frequencyInContent: row.frequency,
    ...(row.is_morpheme ? { isMorpheme: true } : {}),
  };
}
