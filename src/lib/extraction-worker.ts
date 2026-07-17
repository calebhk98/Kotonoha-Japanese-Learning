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
import { WordResolver } from './wordResolver.js';
import { isPunctuation, isSingleKana, isHiraganaWord, isKatakanaWord, looksLikePartialStem, getGrammarDefinition } from './extraction-helpers.js';

// ---------------------------------------------------------------------------
// Public types (imported by server.ts for type-safety on the message channel)
// ---------------------------------------------------------------------------

export interface WorkerInitData {
  jmdictPath: string;
  jmdictFile: string | null;
  jmnedictFile: string | null;
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
let wordResolver: WordResolver | null = null;

// In-memory kana lookup cache, shared across batches processed by this
// worker's lifetime. Avoids re-resolving the same kana word for every chunk.
const kanaCache = new Map<string, any>();

// ---------------------------------------------------------------------------
// Extraction logic (mirrors runBatchExtract in server.ts minus DB writes)
//
// Word resolution goes through the shared WordResolver class — this file used
// to carry its own near-verbatim copy of the pipeline, which meant the vocab
// lists extracted here could silently diverge from what /api/extract and
// /api/word returned (the exact multiple-sources-of-truth failure #188/#197
// were about).
// ---------------------------------------------------------------------------

async function processTokens(
  tokens: any[],
  wordStr_baseFormMap: Map<string, string>,
  kanaLookupCache: Map<string, any>,
): Promise<any[]> {
  const baseFormCounts = new Map<string, number>();
  const validWords = new Map<string, { baseForm: string; pos?: string; reading?: string }>();
  const morphemes = new Map<string, { meaning: string; frequency: number }>();

  for (const token of tokens) {
    const surface = token.surface;
    if (surface.trim() === '' || isPunctuation(surface)) continue;

    // Base-form-aware: catches conjugated auxiliary surfaces (たく→たい,
    // なかっ→ない, でし→です) that used to fall through to homograph lookup.
    const morphemeDef = getGrammarDefinition(surface, token.baseForm);
    if (isSingleKana(surface) || morphemeDef) {
      if (morphemeDef) {
        const prev = morphemes.get(surface);
        morphemes.set(surface, { meaning: morphemeDef, frequency: (prev?.frequency ?? 0) + 1 });
      }
    } else {
      const baseForm = wordStr_baseFormMap.get(surface) ?? token.baseForm;
      validWords.set(surface, { baseForm, pos: token.pos, reading: token.reading });
      baseFormCounts.set(surface, (baseFormCounts.get(surface) ?? 0) + 1);
    }
  }

  const results: any[] = [];

  for (const [wordStr, { baseForm, pos, reading: tokenReading }] of validWords) {
    const { reading, meaning, meanings, jlpt, joyo, score, breakdown } =
      await wordResolver!.resolve(wordStr, baseForm, kanaLookupCache, pos, tokenReading);
    const frequencyInContent = baseFormCounts.get(wordStr) ?? 1;
    const wordData: any = { word: wordStr, reading, meaning, jlpt, joyo, score, breakdown, frequencyInContent, ...(pos ? { pos } : {}) };
    if (meanings) wordData.meanings = meanings;
    results.push(wordData);
  }

  for (const [morpheme, { meaning, frequency }] of morphemes) {
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

  // Step 3: look up kana words, seeding from (and refilling) the warm cache.
  //
  // This used to run through a hand-rolled concurrency-limiting queue whose
  // only purpose was throttling calls to the since-removed Jisho web
  // fallback (#256) — dictionary.lookup() is now entirely local
  // (JMDict/JMnedict/kanji-data), so a plain concurrent lookup is both
  // simpler and correct.
  const kanaLookupCache = new Map<string, any>(
    Array.from(kanaCache.entries()).filter(([k]) => uniqueKanaWords.has(k)),
  );

  if (dictionary && uniqueKanaWords.size > 0) {
    const uncached = Array.from(uniqueKanaWords).filter(w => !kanaLookupCache.has(w));
    await Promise.all(
      uncached.map(async (word) => {
        try {
          const result = await dictionary!.lookup(word);
          kanaLookupCache.set(word, result ?? false);
          if (result) kanaCache.set(word, result);
        } catch {
          kanaLookupCache.set(word, false);
        }
      }),
    );
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
  tokenizer = await createTokenizer();

  dictionary = new DictionaryManager();
  if (data.jmdictFile && fs.existsSync(data.jmdictFile)) {
    await dictionary.initialize(
      'jmdict',
      data.jmdictPath,
      data.jmdictFile,
      data.jmnedictFile ?? undefined,
    );
  } else {
    await dictionary.initialize(
      'kanjidata',
      undefined,
      undefined,
      data.jmnedictFile ?? undefined,
    );
  }

  wordResolver = new WordResolver(dictionary);

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
