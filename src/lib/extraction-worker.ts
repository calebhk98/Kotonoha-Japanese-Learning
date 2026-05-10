/**
 * Worker-thread script for startup batch extraction (fix for #200).
 *
 * The main thread (server.ts) spawns this worker when it detects content items
 * missing from content_words.  All CPU/IO-heavy work (Sudachi tokenisation +
 * dictionary lookups) runs here so the Express event loop stays responsive to
 * user-facing API calls during the warmup period.
 *
 * Message protocol (all messages are plain serialisable objects):
 *
 *   Main → Worker
 *     { type: 'extract', items: Array<{ id: string; text: string }> }
 *
 *   Worker → Main
 *     { type: 'ready' }                          — sent once after init completes
 *     { type: 'result', id, words?, elapsed?, error? }  — one per input item
 *     { type: 'done', processed: number }        — sent after every batch
 *     { type: 'init_error', message: string }    — fatal init failure
 */

import { workerData, parentPort, isMainThread } from 'worker_threads';
import fs from 'fs';
import { createTokenizer, Tokenizer } from './tokenizers.js';
import { DictionaryManager } from './dictionary.js';
import {
  getCachedDictionaryEntries,
  findBestVariant,
  getWordScoreBreakdown,
} from './scoring.js';
import { getMorphemeDefinition } from './morphemeDefinitions.js';
import { PARTICLES, isPunctuation, isSingleKana, isHiraganaWord, isKatakanaWord, looksLikePartialStem } from './extraction-helpers.js';

// ---------------------------------------------------------------------------
// Public types (imported by server.ts for type-safety on the message channel)
// ---------------------------------------------------------------------------

export interface WorkerInitData {
  jmdictPath: string;
  jmdictFile: string | null;
  jmnedictFile: string | null;
  /** Serialised entries from the main thread's JishoCache, to avoid re-fetching
   *  lookups already in the persistent cache. */
  jishoCacheEntries: [string, any][];
}

export type WorkerOutMessage =
  | { type: 'ready' }
  | { type: 'result'; id: string; words?: any[]; elapsed?: number; error?: string }
  | { type: 'done'; processed: number }
  | { type: 'init_error'; message: string };

export type WorkerInMessage =
  | { type: 'extract'; items: Array<{ id: string; text: string }> };

// ---------------------------------------------------------------------------
// Worker-local state (only populated when running in a worker thread)
// ---------------------------------------------------------------------------

let tokenizer: Tokenizer | null = null;
let dictionary: DictionaryManager | null = null;

// In-memory kana lookup cache, seeded from the main thread's persistent cache.
// Avoids redundant Jisho HTTP calls for words already looked up previously.
const kanaCache = new Map<string, any>();

// ---------------------------------------------------------------------------
// Extraction logic (mirrors runBatchExtract in server.ts minus DB writes)
// ---------------------------------------------------------------------------

async function resolveWordMeaning(
  wordStr: string,
  baseForm: string,
  lookupCache: Map<string, any>,
): Promise<{ reading: string; meaning: string; meanings: string[] | undefined }> {
  if (/^[ぁ-んー]+$/.test(wordStr)) {
    const morphemeDef = getMorphemeDefinition(wordStr);
    if (morphemeDef) return { reading: wordStr, meaning: morphemeDef, meanings: undefined };
  }

  let entries = getCachedDictionaryEntries(baseForm);
  if (entries.length === 0 && baseForm !== wordStr) {
    entries = getCachedDictionaryEntries(wordStr);
  }
  const { variant, entry } = findBestVariant(baseForm, entries);

  let reading = wordStr;
  let kanjiMeaning = 'Unknown meaning';
  let kanjiMeanings: string[] | undefined;

  if (entry && variant) {
    reading = variant.pronounced || wordStr;
    kanjiMeaning = entry.meanings[0]?.glosses?.join(', ') || kanjiMeaning;
    const allKanjiMeanings: string[] = [];
    const seen = new Set<string>();
    for (const m of entry.meanings) {
      for (const g of (m.glosses || [])) {
        if (!seen.has(g)) { seen.add(g); allKanjiMeanings.push(g); }
      }
    }
    if (allKanjiMeanings.length > 1) kanjiMeanings = allKanjiMeanings;
  }

  let meaning = kanjiMeaning;
  let meanings = kanjiMeanings;

  if (dictionary) {
    const cacheKey = baseForm !== wordStr ? baseForm : wordStr;
    let dictResult: any = lookupCache.get(cacheKey) ?? null;

    if (dictResult === null) {
      dictResult = await dictionary.lookup(baseForm);
      if (!dictResult && baseForm !== wordStr) {
        dictResult = await dictionary.lookup(wordStr);
      }
      lookupCache.set(cacheKey, dictResult ?? false);
    }

    if (dictResult && dictResult !== false) {
      const jmdictMeaning = dictResult.meaning;
      if (jmdictMeaning && jmdictMeaning !== 'Unknown') {
        if (!reading || reading === wordStr) reading = dictResult.reading || reading;
        meaning = jmdictMeaning;
        meanings = dictResult.meanings;
      }
    }
  }

  if (meaning === 'Unknown meaning' && /^[ぁ-ん]+$/.test(wordStr)) {
    const morphemeFallback = getMorphemeDefinition(wordStr);
    meaning = morphemeFallback || 'Kana particle / expression';
  }

  return { reading, meaning, meanings };
}

async function processTokens(
  tokens: any[],
  wordStr_baseFormMap: Map<string, string>,
  kanaLookupCache: Map<string, any>,
): Promise<any[]> {
  const baseFormCounts = new Map<string, number>();
  const validWords = new Map<string, string>();
  const morphemes = new Map<string, number>();

  for (const token of tokens) {
    const surface = token.surface;
    if (surface.trim() === '' || isPunctuation(surface)) continue;

    const morphemeDef = getMorphemeDefinition(surface);
    const isKanaMorpheme = morphemeDef && /^[ぁ-んー]+$/.test(surface);
    if (isSingleKana(surface) || isKanaMorpheme) {
      if (morphemeDef) morphemes.set(surface, (morphemes.get(surface) ?? 0) + 1);
    } else {
      const baseForm = wordStr_baseFormMap.get(surface) ?? token.baseForm;
      validWords.set(surface, baseForm);
      baseFormCounts.set(surface, (baseFormCounts.get(surface) ?? 0) + 1);
    }
  }

  const results: any[] = [];

  for (const [wordStr, baseForm] of validWords) {
    const { reading, meaning, meanings } = await resolveWordMeaning(wordStr, baseForm, kanaLookupCache);
    const entries = getCachedDictionaryEntries(baseForm);
    const { variant } = findBestVariant(baseForm, entries);
    const { jlpt, joyo, score, breakdown } = getWordScoreBreakdown(wordStr, variant);
    const frequencyInContent = baseFormCounts.get(wordStr) ?? 1;
    const wordData: any = { word: wordStr, reading, meaning, jlpt, joyo, score, breakdown, frequencyInContent };
    if (meanings) wordData.meanings = meanings;
    results.push(wordData);
  }

  for (const [morpheme, frequency] of morphemes) {
    const meaning = getMorphemeDefinition(morpheme) || 'Grammatical morpheme';
    results.push({
      word: morpheme,
      reading: morpheme,
      meaning,
      jlpt: 0,
      joyo: false,
      score: 0,
      breakdown: {
        jlptScore: 0, joyoPenalty: 0, highestGrade: null,
        freqPenalty: 0, jlptValues: [], gradeValues: [], priorities: [],
      },
      frequencyInContent: frequency,
      isMorpheme: true,
    });
  }

  return results;
}

type BatchItem = { id: string; text: string };
type BatchResult = { id: string; words?: any[]; elapsed?: number; error?: string };

async function extractBatch(items: BatchItem[]): Promise<BatchResult[]> {
  if (!tokenizer) throw new Error('Tokenizer not initialised');

  const sorted = [...items].sort((a, b) => (a.text?.length ?? 0) - (b.text?.length ?? 0));

  // Step 1: tokenise all items concurrently
  const tokenizedBatch = await Promise.all(
    sorted.map(async (item) => {
      if (!item.text || typeof item.text !== 'string') return { ...item, tokens: null };
      try {
        return { ...item, tokens: await tokenizer!.segment(item.text) };
      } catch {
        return { ...item, tokens: null };
      }
    }),
  );

  // Step 2: collect unique kana words across the whole batch
  const uniqueKanaWords = new Set<string>();
  for (const item of tokenizedBatch) {
    if (!item.tokens) continue;
    for (const token of item.tokens) {
      const s = token.surface;
      if (s.trim() === '' || isPunctuation(s) || isSingleKana(s)) continue;
      if ((isHiraganaWord(s) || isKatakanaWord(s)) && !looksLikePartialStem(s)) uniqueKanaWords.add(s);
    }
  }

  // Step 3: look up kana words with a concurrency cap; seed from warm cache
  const kanaLookupCache = new Map<string, any>(
    Array.from(kanaCache.entries()).filter(([k]) => uniqueKanaWords.has(k)),
  );

  if (dictionary && uniqueKanaWords.size > 0) {
    const uncached = Array.from(uniqueKanaWords).filter(w => !kanaLookupCache.has(w));
    const CONCURRENCY = 5;
    let active = 0;
    let idx = 0;

    await new Promise<void>((resolve, reject) => {
      const next = async () => {
        try {
          if (idx >= uncached.length && active === 0) { resolve(); return; }
          while (active < CONCURRENCY && idx < uncached.length) {
            const word = uncached[idx++];
            active++;
            dictionary!.lookup(word)
              .then(result => {
                const val = result ?? false;
                kanaLookupCache.set(word, val);
                if (result) kanaCache.set(word, result);
              })
              .catch(() => { kanaLookupCache.set(word, false); })
              .finally(() => { active--; next().catch(reject); });
          }
          if (idx >= uncached.length && active === 0) resolve();
        } catch (err) { reject(err); }
      };
      next().catch(reject);
    });
  }

  // Step 3.5: pre-populate kanji words from kanji-data (synchronous, fast)
  const surfaceToBase = new Map<string, string>();
  for (const item of tokenizedBatch) {
    if (!item.tokens) continue;
    for (const token of item.tokens) {
      const s = token.surface;
      if (s.trim() === '' || isPunctuation(s) || isSingleKana(s)) continue;
      if (!isHiraganaWord(s) && !isKatakanaWord(s)) surfaceToBase.set(s, token.baseForm);
    }
  }

  // Step 4: process each item using the pre-built lookup caches
  const results: BatchResult[] = await Promise.all(
    tokenizedBatch.map(async (item) => {
      if (!item.text || !item.tokens) {
        return { id: item.id, error: !item.text ? 'No text' : 'Tokenization failed' };
      }
      const start = Date.now();
      try {
        const words = await processTokens(item.tokens, surfaceToBase, kanaLookupCache);
        return { id: item.id, words, elapsed: Date.now() - start };
      } catch (e: any) {
        return { id: item.id, error: e instanceof Error ? e.message : String(e) };
      }
    }),
  );

  return results;
}

// ---------------------------------------------------------------------------
// Worker initialisation and message loop
// Only runs when this module is loaded inside a worker_threads Worker, not
// when it is imported for its type exports in tests or other modules.
// ---------------------------------------------------------------------------

async function runWorker(data: WorkerInitData) {
  // Seed the kana cache from entries the main thread already has persisted.
  for (const [word, result] of data.jishoCacheEntries) {
    kanaCache.set(word, result);
  }

  tokenizer = await createTokenizer();

  const onJishoCacheUpdate = (cache: Map<string, any>) => {
    for (const [k, v] of cache) kanaCache.set(k, v);
  };

  dictionary = new DictionaryManager();
  if (data.jmdictFile && fs.existsSync(data.jmdictFile)) {
    await dictionary.initialize(
      'jmdict',
      data.jmdictPath,
      data.jmdictFile,
      data.jmnedictFile ?? undefined,
      kanaCache as any,
      onJishoCacheUpdate,
    );
  } else {
    await dictionary.initialize(
      'jisho',
      undefined,
      undefined,
      data.jmnedictFile ?? undefined,
      kanaCache as any,
      onJishoCacheUpdate,
    );
  }

  parentPort!.postMessage({ type: 'ready' } satisfies WorkerOutMessage);

  parentPort!.on('message', async (msg: WorkerInMessage) => {
    if (msg.type !== 'extract') return;
    let processed = 0;
    try {
      const results = await extractBatch(msg.items);
      for (const result of results) {
        parentPort!.postMessage({ type: 'result', ...result } satisfies WorkerOutMessage);
        processed++;
      }
    } catch (e: any) {
      parentPort!.postMessage({
        type: 'init_error',
        message: e instanceof Error ? e.message : String(e),
      } satisfies WorkerOutMessage);
    }
    parentPort!.postMessage({ type: 'done', processed } satisfies WorkerOutMessage);
  });
}

// Guard: only activate worker logic when actually running inside a Worker whose
// workerData was supplied by our own spawn call (identified by the jmdictPath key).
if (!isMainThread && workerData != null && typeof (workerData as any).jmdictPath === 'string') {
  runWorker(workerData as WorkerInitData).catch(e => {
    parentPort?.postMessage({
      type: 'init_error',
      message: e instanceof Error ? e.message : String(e),
    } satisfies WorkerOutMessage);
  });
}
