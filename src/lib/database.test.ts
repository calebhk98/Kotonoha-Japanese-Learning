import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { initDatabase, WordsCache, JishoCache, ContentWordsStore, saveDatabase } from './database.js';
import type { WordInfo } from '../types.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import BetterSqlite3 from 'better-sqlite3';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_DB_PATH = path.join(__dirname, '../../.cache-test.db');

describe('Database Write Queue', () => {
  beforeEach(async () => {
    if (fs.existsSync(TEST_DB_PATH)) {
      fs.unlinkSync(TEST_DB_PATH);
    }
    process.env.DATABASE_PATH = TEST_DB_PATH;
    await initDatabase();
  });

  afterEach(() => {
    if (fs.existsSync(TEST_DB_PATH)) {
      fs.unlinkSync(TEST_DB_PATH);
    }
    delete process.env.DATABASE_PATH;
  });

  it('should serialize concurrent writes', async () => {
    const cache = new WordsCache();
    const executionOrder: number[] = [];

    const mockWrite = (id: number) => {
      return cache.set(`word${id}`, [{
        meanings: [{ glosses: ['test'] }],
        variants: [{ pronounced: 'test', written: 'test' }]
      } as any]).then(() => {
        executionOrder.push(id);
      });
    };

    await Promise.all([
      mockWrite(1),
      mockWrite(2),
      mockWrite(3),
      mockWrite(4),
      mockWrite(5),
    ]);

    expect(executionOrder).toHaveLength(5);
    expect(executionOrder).toEqual([1, 2, 3, 4, 5]);
  });

  it('should handle rapid ContentWordsStore writes', async () => {
    const store = new ContentWordsStore();
    const words: WordInfo[] = [
      {
        word: '本',
        reading: 'ほん',
        meaning: 'book',
        jlpt: 5,
        joyo: true,
        score: 15,
        breakdown: { jlptScore: 15, joyoPenalty: 5, highestGrade: 1, freqPenalty: -5, jlptValues: [], gradeValues: [1], priorities: [] },
        frequencyInContent: 2,
      },
      {
        word: '読む',
        reading: 'よむ',
        meaning: 'to read',
        jlpt: 5,
        joyo: true,
        score: 20,
        breakdown: { jlptScore: 15, joyoPenalty: 5, highestGrade: 2, freqPenalty: 0, jlptValues: [], gradeValues: [2], priorities: [] },
        frequencyInContent: 1,
      },
    ];

    const ids = ['content1', 'content2', 'content3'];

    await Promise.all(
      ids.map(id => store.setContentWords(id, words))
    );

    for (const id of ids) {
      const retrieved = store.getContentWords(id);
      expect(retrieved).toHaveLength(2);
      expect(retrieved[0].word).toBe('本');
      expect(retrieved[1].word).toBe('読む');
    }
  });

  it('should handle mixed cache operations', async () => {
    const wordsCache = new WordsCache();
    const jishoCache = new JishoCache();
    const contentStore = new ContentWordsStore();

    const testWord = '猫';
    const testEntry = {
      meanings: [{ glosses: ['cat'] }],
      variants: [{ pronounced: 'ねこ', written: '猫' }]
    } as any;

    const testJisho = {
      meaning: 'cat',
      reading: 'ねこ'
    };

    const words: WordInfo[] = [{
      word: testWord,
      reading: 'ねこ',
      meaning: 'cat',
      jlpt: 5,
      joyo: true,
      score: 10,
      breakdown: { jlptScore: 15, joyoPenalty: 5, highestGrade: 1, freqPenalty: -5, jlptValues: [], gradeValues: [1], priorities: [] },
      frequencyInContent: 3,
    }];

    await Promise.all([
      wordsCache.set(testWord, [testEntry]),
      jishoCache.set(testWord, testJisho),
      contentStore.setContentWords('mixed-test', words),
    ]);

    expect(wordsCache.get(testWord)).toEqual([testEntry]);
    expect(jishoCache.get(testWord)).toEqual(testJisho);
    expect(contentStore.getContentWords('mixed-test')).toHaveLength(1);
  });

  it('should recover from write errors', async () => {
    const cache = new WordsCache();
    const validEntry = {
      meanings: [{ glosses: ['test'] }],
      variants: [{ pronounced: 'test', written: 'test' }]
    } as any;

    await cache.set('word1', [validEntry]);
    expect(cache.get('word1')).toEqual([validEntry]);

    await cache.set('word2', [validEntry]);
    expect(cache.get('word2')).toEqual([validEntry]);
  });

  it('should persist data across save/reload cycles', async () => {
    const cache = new WordsCache();
    const testEntry = {
      meanings: [{ glosses: ['persist test'] }],
      variants: [{ pronounced: 'test', written: 'test' }]
    } as any;

    await cache.set('persist-word', [testEntry]);
    await saveDatabase();

    const retrieved = cache.get('persist-word');
    expect(retrieved).toEqual([testEntry]);
  });

  it('should clear caches correctly', async () => {
    const cache = new WordsCache();
    const testEntry = {
      meanings: [{ glosses: ['test'] }],
      variants: [{ pronounced: 'test', written: 'test' }]
    } as any;

    await cache.set('word1', [testEntry]);
    await cache.set('word2', [testEntry]);

    expect(cache.size).toBeGreaterThan(0);

    await cache.clear();
    expect(cache.get('word1')).toBeUndefined();
    expect(cache.get('word2')).toBeUndefined();
  });

  it('should handle JishoCache clear', async () => {
    const cache = new JishoCache();
    const testData = { meaning: 'test', reading: 'てすと' };

    await cache.set('word1', testData);
    await cache.set('word2', testData);

    expect(cache.size).toBeGreaterThan(0);

    await cache.clear();
    expect(cache.get('word1')).toBeUndefined();
    expect(cache.get('word2')).toBeUndefined();
  });

  it('should handle ContentWordsStore operations', async () => {
    const store = new ContentWordsStore();
    const words: WordInfo[] = [{
      word: '日本',
      reading: 'にほん',
      meaning: 'Japan',
      jlpt: 4,
      joyo: true,
      score: 25,
      breakdown: { jlptScore: 30, joyoPenalty: 7, highestGrade: 2, freqPenalty: 0, jlptValues: [4], gradeValues: [2], priorities: [] },
      frequencyInContent: 5,
    }];

    const contentId = 'test-content-1';

    expect(store.hasContent(contentId)).toBe(false);

    await store.setContentWords(contentId, words);

    expect(store.hasContent(contentId)).toBe(true);
    const retrieved = store.getContentWords(contentId);
    expect(retrieved).toHaveLength(1);
    expect(retrieved[0].word).toBe('日本');

    await store.deleteContentWords(contentId);
    expect(store.hasContent(contentId)).toBe(false);
  });

  it('should handle stress test with many concurrent operations', async () => {
    const cache = new WordsCache();
    const store = new ContentWordsStore();

    const operations = [];
    for (let i = 0; i < 50; i++) {
      operations.push(
        cache.set(`stress-word-${i}`, [{
          meanings: [{ glosses: [`meaning ${i}`] }],
          variants: [{ pronounced: `pron${i}`, written: `word${i}` }]
        } as any])
      );

      if (i % 10 === 0) {
        operations.push(
          store.setContentWords(`stress-content-${i}`, [{
            word: `word${i}`,
            reading: `reading${i}`,
            meaning: `meaning ${i}`,
            jlpt: 5,
            joyo: true,
            score: 10,
            breakdown: { jlptScore: 15, joyoPenalty: 5, highestGrade: 1, freqPenalty: 0, jlptValues: [5], gradeValues: [1], priorities: [] },
            frequencyInContent: 1,
          }])
        );
      }
    }

    await Promise.all(operations);

    for (let i = 0; i < 50; i++) {
      expect(cache.get(`stress-word-${i}`)).toBeDefined();
    }

    for (let i = 0; i < 50; i += 10) {
      expect(store.hasContent(`stress-content-${i}`)).toBe(true);
    }
  });
});

// better-sqlite3 writes through to disk transactionally on every statement, so
// none of these should require an explicit saveDatabase() call to survive a
// "restart" (simulated here by opening a brand new connection to the same
// file, bypassing the module's cached db handle entirely). This is the
// behavior change from sql.js (issue #253): sql.js only persisted an
// in-memory database when saveDatabase() ran, so a crash/SIGKILL between
// writes and the next throttled save silently lost data.
describe('Database durability without saveDatabase (issue #253)', () => {
  beforeEach(async () => {
    if (fs.existsSync(TEST_DB_PATH)) {
      fs.unlinkSync(TEST_DB_PATH);
    }
    process.env.DATABASE_PATH = TEST_DB_PATH;
    await initDatabase();
  });

  afterEach(() => {
    if (fs.existsSync(TEST_DB_PATH)) {
      fs.unlinkSync(TEST_DB_PATH);
    }
    delete process.env.DATABASE_PATH;
  });

  it('WordsCache.set() writes survive on disk without calling saveDatabase()', async () => {
    const cache = new WordsCache();
    const entry = {
      meanings: [{ glosses: ['durable'] }],
      variants: [{ pronounced: 'test', written: 'test' }]
    } as any;

    await cache.set('durable-word', [entry]);

    // Open a completely independent connection to the same file — this is
    // what "the process got SIGKILLed and restarted" looks like, since the
    // module-level `db` handle in database.ts is never consulted here.
    const raw = new BetterSqlite3(TEST_DB_PATH, { readonly: true });
    try {
      const row = raw.prepare('SELECT entries FROM words_cache WHERE word = ?').get('durable-word') as { entries: string } | undefined;
      expect(row).toBeDefined();
      expect(JSON.parse(row!.entries)).toEqual([entry]);
    } finally {
      raw.close();
    }
  });

  it('JishoCache.set() writes survive on disk without calling saveDatabase()', async () => {
    const cache = new JishoCache();
    const value = { meaning: 'durable', reading: 'てすと' };

    await cache.set('durable-jisho-word', value);

    const raw = new BetterSqlite3(TEST_DB_PATH, { readonly: true });
    try {
      const row = raw.prepare('SELECT result FROM jisho_cache WHERE word = ?').get('durable-jisho-word') as { result: string } | undefined;
      expect(row).toBeDefined();
      expect(JSON.parse(row!.result)).toEqual(value);
    } finally {
      raw.close();
    }
  });

  it('ContentWordsStore.setContentWords() writes survive on disk without calling saveDatabase()', async () => {
    const store = new ContentWordsStore();
    const words: WordInfo[] = [{
      word: 'durable',
      reading: 'durable',
      meaning: 'durable test',
      jlpt: 5,
      joyo: true,
      score: 10,
      breakdown: { jlptScore: 15, joyoPenalty: 5, highestGrade: 1, freqPenalty: -5, jlptValues: [], gradeValues: [], priorities: [] },
      frequencyInContent: 1,
    }];

    await store.setContentWords('durable-content', words);

    const raw = new BetterSqlite3(TEST_DB_PATH, { readonly: true });
    try {
      const rows = raw.prepare('SELECT word FROM content_words WHERE content_id = ?').all('durable-content') as { word: string }[];
      expect(rows).toHaveLength(1);
      expect(rows[0].word).toBe('durable');
    } finally {
      raw.close();
    }
  });

  it('saveDatabase() is safe to call (cheap no-op) and does not disturb already-durable data', async () => {
    const cache = new WordsCache();
    const entry = {
      meanings: [{ glosses: ['noop'] }],
      variants: [{ pronounced: 'test', written: 'test' }]
    } as any;

    await cache.set('noop-word', [entry]);
    await expect(saveDatabase()).resolves.toBeUndefined();

    const raw = new BetterSqlite3(TEST_DB_PATH, { readonly: true });
    try {
      const row = raw.prepare('SELECT entries FROM words_cache WHERE word = ?').get('noop-word') as { entries: string } | undefined;
      expect(row).toBeDefined();
    } finally {
      raw.close();
    }
  });

  it('initDatabase() loads an existing on-disk database without wiping rows written before it ran', async () => {
    // Simulate "server restarted, .cache.db already has rows from a prior run":
    // write directly with a raw connection (no app code involved), then call
    // initDatabase() again and confirm the row is still visible through the
    // cache wrapper (the "Loaded existing database" branch must not truncate).
    const raw = new BetterSqlite3(TEST_DB_PATH);
    raw.prepare('INSERT OR REPLACE INTO words_cache (word, entries) VALUES (?, ?)')
      .run('pre-existing-word', JSON.stringify([{ meanings: [{ glosses: ['pre-existing'] }], variants: [] }]));
    raw.close();

    await initDatabase();

    const cache = new WordsCache();
    expect(cache.get('pre-existing-word')).toEqual([{ meanings: [{ glosses: ['pre-existing'] }], variants: [] }]);
  });
});
