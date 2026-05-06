import initSqlJs, { Database as SqlDatabase } from 'sql.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { DictionaryEntry } from './scoring.js';

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
    console.log('[Database] Loaded existing database');
  } else {
    db = new SQL.Database();
    createTables();
    console.log('[Database] Created new database');
  }
}

function createTables() {
  if (!db) throw new Error('Database not initialized');

  // Words cache table
  db.run(`
    CREATE TABLE IF NOT EXISTS words_cache (
      word TEXT PRIMARY KEY,
      entries TEXT NOT NULL
    )
  `);

  // Jisho cache table
  db.run(`
    CREATE TABLE IF NOT EXISTS jisho_cache (
      word TEXT PRIMARY KEY,
      result TEXT NOT NULL
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
  set(key: string, value: DictionaryEntry[]) {
    if (!db) throw new Error('Database not initialized');
    db.run(
      'INSERT OR REPLACE INTO words_cache (word, entries) VALUES (?, ?)',
      [key, JSON.stringify(value)]
    );
  }

  get(key: string): DictionaryEntry[] | undefined {
    if (!db) throw new Error('Database not initialized');
    const result = db.exec(
      'SELECT entries FROM words_cache WHERE word = ?',
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
      'SELECT 1 FROM words_cache WHERE word = ?',
      [key]
    );
    return result.length > 0 && result[0].values.length > 0;
  }

  clear() {
    if (!db) throw new Error('Database not initialized');
    db.run('DELETE FROM words_cache');
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
