import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { initDatabase, WordsCache, JishoCache, ContentWordsStore, saveDatabase } from './database.js';
import type { WordInfo } from '../types.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

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
        breakdown: { jlptScore: 15, highestGrade: 1, frequencyPenalty: -5 },
        frequencyInContent: 2,
      },
      {
        word: '読む',
        reading: 'よむ',
        meaning: 'to read',
        jlpt: 5,
        joyo: true,
        score: 20,
        breakdown: { jlptScore: 15, highestGrade: 2, frequencyPenalty: 0 },
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
      breakdown: { jlptScore: 15, highestGrade: 1, frequencyPenalty: -5 },
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
      breakdown: { jlptScore: 30, highestGrade: 2, frequencyPenalty: 0 },
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
            breakdown: { jlptScore: 15, highestGrade: 1, frequencyPenalty: 0 },
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
