import initSqlJs, { Database as SqlDatabase } from 'sql.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { DictionaryEntry } from './scoring.js';
import { WordInfo } from '../types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.join(__dirname, '../../.cache.db');

let db: SqlDatabase | null = null;
let SQL: any = null;

export async function initDatabase() {
  SQL = await initSqlJs();

  // Load existing database or create new one
  if (fs.existsSync(DB_PATH)) {
    const buffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(buffer);
    createTables(); // ensure any new tables added after initial creation exist
    console.log('[Database] Loaded existing database');
  } else {
    db = new SQL.Database();
    console.log('[Database] Created new database');
  }
  // Always run createTables — IF NOT EXISTS makes this safe for existing DBs
  createTables();
}

function createTables() {
  if (!db) throw new Error('Database not initialized');

  db.run(`
    CREATE TABLE IF NOT EXISTS words_cache (
      word TEXT PRIMARY KEY,
      entries TEXT NOT NULL
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS jisho_cache (
      word TEXT PRIMARY KEY,
      result TEXT NOT NULL
    )
  `);

  db.run(`
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

export function saveDatabase() {
  if (!db) return;

  const data = db.export();
  const buffer = Buffer.from(data);
  fs.writeFileSync(DB_PATH, buffer);
  console.log('[Database] Saved to disk');
}

export class WordsCache {
  private memoryCache: Map<string, DictionaryEntry[]> = new Map();
  private isPreloaded = false;

  set(key: string, value: DictionaryEntry[]) {
    if (!db) throw new Error('Database not initialized');
    db.run(
      'INSERT OR REPLACE INTO words_cache (word, entries) VALUES (?, ?)',
      [key, JSON.stringify(value)]
    );
    this.memoryCache.set(key, value);
  }

  get(key: string): DictionaryEntry[] | undefined {
    if (!db) throw new Error('Database not initialized');
    // Check memory cache first (fast path)
    if (this.memoryCache.has(key)) {
      return this.memoryCache.get(key);
    }

    // Fall back to database
    const result = db.exec(
      'SELECT entries FROM words_cache WHERE word = ?',
      [key]
    );
    if (result.length === 0 || result[0].values.length === 0) {
      return undefined;
    }
    const entries = JSON.parse(result[0].values[0][0] as string);
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
    const result = db.exec(
      'SELECT 1 FROM words_cache WHERE word = ?',
      [key]
    );
    return result.length > 0 && result[0].values.length > 0;
  }

  clear() {
    if (!db) throw new Error('Database not initialized');
    db.run('DELETE FROM words_cache');
    this.memoryCache.clear();
  }

  entries(): [string, DictionaryEntry[]][] {
    if (!db) throw new Error('Database not initialized');
    const result = db.exec('SELECT word, entries FROM words_cache');
    if (result.length === 0) return [];
    return result[0].values.map(([word, entries]) => [
      word as string,
      JSON.parse(entries as string)
    ]);
  }

  get size(): number {
    if (!db) throw new Error('Database not initialized');
    const result = db.exec('SELECT COUNT(*) as count FROM words_cache');
    if (result.length === 0) return 0;
    return result[0].values[0][0] as number;
  }

  preload(): void {
    if (!db) throw new Error('Database not initialized');
    if (this.isPreloaded) return;

    const result = db.exec('SELECT word, entries FROM words_cache');
    if (result.length > 0) {
      for (const [word, entries] of result[0].values) {
        this.memoryCache.set(
          word as string,
          JSON.parse(entries as string)
        );
      }
    }
    this.isPreloaded = true;
  }
}

export class JishoCache {
  set(key: string, value: any) {
    if (!db) throw new Error('Database not initialized');
    db.run(
      'INSERT OR REPLACE INTO jisho_cache (word, result) VALUES (?, ?)',
      [key, JSON.stringify(value)]
    );
  }

  get(key: string): any | undefined {
    if (!db) throw new Error('Database not initialized');
    const result = db.exec(
      'SELECT result FROM jisho_cache WHERE word = ?',
      [key]
    );
    if (result.length === 0 || result[0].values.length === 0) {
      return undefined;
    }
    return JSON.parse(result[0].values[0][0] as string);
  }

  has(key: string): boolean {
    if (!db) throw new Error('Database not initialized');
    const result = db.exec(
      'SELECT 1 FROM jisho_cache WHERE word = ?',
      [key]
    );
    return result.length > 0 && result[0].values.length > 0;
  }

  clear() {
    if (!db) throw new Error('Database not initialized');
    db.run('DELETE FROM jisho_cache');
  }

  entries(): [string, any][] {
    if (!db) throw new Error('Database not initialized');
    const result = db.exec('SELECT word, result FROM jisho_cache');
    if (result.length === 0) return [];
    return result[0].values.map(([word, result]) => [
      word as string,
      JSON.parse(result as string)
    ]);
  }

  get size(): number {
    if (!db) throw new Error('Database not initialized');
    const result = db.exec('SELECT COUNT(*) as count FROM jisho_cache');
    if (result.length === 0) return 0;
    return result[0].values[0][0] as number;
  }
}

export class ContentWordsStore {
  setContentWords(contentId: string, words: WordInfo[]): void {
    if (!db) throw new Error('Database not initialized');
    db.run('DELETE FROM content_words WHERE content_id = ?', [contentId]);
    for (const w of words) {
      db.run(
        `INSERT INTO content_words
           (content_id, word, reading, meaning, meanings, jlpt, joyo, score, breakdown, frequency, is_morpheme)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
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
        ]
      );
    }
  }

  getContentWords(contentId: string): WordInfo[] {
    if (!db) throw new Error('Database not initialized');
    const result = db.exec(
      `SELECT word, reading, meaning, meanings, jlpt, joyo, score, breakdown, frequency, is_morpheme
       FROM content_words WHERE content_id = ?
       ORDER BY rowid`,
      [contentId]
    );
    if (result.length === 0) return [];
    return result[0].values.map(([word, reading, meaning, meanings, jlpt, joyo, score, breakdown, frequency, is_morpheme]) => ({
      word: word as string,
      reading: reading as string,
      meaning: meaning as string,
      ...(meanings ? { meanings: JSON.parse(meanings as string) } : {}),
      jlpt: jlpt as number,
      joyo: (joyo as number) === 1,
      score: score as number,
      breakdown: JSON.parse(breakdown as string),
      frequencyInContent: frequency as number,
      ...(is_morpheme ? { isMorpheme: true } : {}),
    }));
  }

  getAllContentWords(): Record<string, WordInfo[]> {
    if (!db) throw new Error('Database not initialized');
    const result = db.exec(
      `SELECT content_id, word, reading, meaning, meanings, jlpt, joyo, score, breakdown, frequency, is_morpheme
       FROM content_words ORDER BY content_id, rowid`
    );
    if (result.length === 0) return {};
    const out: Record<string, WordInfo[]> = {};
    for (const [content_id, word, reading, meaning, meanings, jlpt, joyo, score, breakdown, frequency, is_morpheme] of result[0].values) {
      const id = content_id as string;
      if (!out[id]) out[id] = [];
      out[id].push({
        word: word as string,
        reading: reading as string,
        meaning: meaning as string,
        ...(meanings ? { meanings: JSON.parse(meanings as string) } : {}),
        jlpt: jlpt as number,
        joyo: (joyo as number) === 1,
        score: score as number,
        breakdown: JSON.parse(breakdown as string),
        frequencyInContent: frequency as number,
        ...(is_morpheme ? { isMorpheme: true } : {}),
      });
    }
    return out;
  }

  hasContent(contentId: string): boolean {
    if (!db) throw new Error('Database not initialized');
    const result = db.exec(
      'SELECT 1 FROM content_words WHERE content_id = ? LIMIT 1',
      [contentId]
    );
    return result.length > 0 && result[0].values.length > 0;
  }

  deleteContentWords(contentId: string): void {
    if (!db) throw new Error('Database not initialized');
    db.run('DELETE FROM content_words WHERE content_id = ?', [contentId]);
  }

  clear(): void {
    if (!db) throw new Error('Database not initialized');
    db.run('DELETE FROM content_words');
  }
}
