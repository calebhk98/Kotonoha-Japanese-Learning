import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import { spawn, spawnSync } from "child_process";
import * as tar from "tar";
import zlib from "zlib";
import {
  getCachedDictionaryEntries,
} from "./src/lib/scoring.js";
import { WordResolver } from "./src/lib/wordResolver.js";
import { DictionaryManager } from "./src/lib/dictionary.js";
import { createTokenizer, Tokenizer } from "./src/lib/tokenizers.js";
import { ensureJmnedictPrepared } from "./src/lib/jmnedict-utils.js";
import { loadStoriesFromDisk, loadMusicFromDisk, loadVideosFromDisk } from "./src/lib/storyLoader.js";
import { initDatabase, WordsCache, JishoCache, ContentWordsStore, saveDatabase } from "./src/lib/database.js";
import { isPunctuation, isSingleKana, looksLikePartialStem, getGrammarDefinition } from "./src/lib/extraction-helpers.js";
import type { WorkerInitData, WorkerOutMessage } from "./src/lib/extraction-worker.js";
import type { WordInfo } from "./src/types.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let wordsCache: WordsCache;
let jishoCache: JishoCache;
let contentWordsStore: ContentWordsStore;

// Extract jmdict if needed
async function ensureJmdictExtracted() {
  const jmdictFile = path.join(__dirname, 'jmdict-all-3.6.2.json');
  const jmdictTgz = path.join(__dirname, 'jmdict-all-3.6.2.json.tgz');

  if (fs.existsSync(jmdictFile)) {
    console.log('[JMDict] Found extracted dictionary file');
    return;
  }

  if (!fs.existsSync(jmdictTgz)) {
    console.warn('[JMDict] Neither extracted file nor compressed file found');
    return;
  }

  try {
    console.log('[JMDict] Extracting compressed dictionary...');
    await tar.extract({
      file: jmdictTgz,
      cwd: __dirname,
    });
    console.log('[JMDict] Successfully extracted dictionary');
  } catch (e: any) {
    console.error('[JMDict] Failed to extract:', e.message);
    throw e;
  }
}


// Database is saved periodically and on shutdown

let tokenizer: Tokenizer | null = null;
let dictionary: DictionaryManager | null = null;
let wordResolver: WordResolver | null = null;

const tokenizerReady = (async () => {
  try {
    tokenizer = await createTokenizer();
    console.log(`[Server] Tokenizer ready: ${tokenizer.name}`);
  } catch (e: any) {
    console.error(`[Server] Failed to initialize tokenizer: ${e.message}`);
    throw e;
  }
})();

const jmdictReady = (async () => {
  try {
    await ensureJmdictExtracted();
    console.log(`[JMDict] Dictionary file extracted and ready`);
  } catch (e: any) {
    console.warn(`[JMDict] Failed to extract dictionary:`, e.message);
  }
})();

let jmnedictFile: string | null = null;

const jmnedictReady = (async () => {
  try {
    const result = await ensureJmnedictPrepared();
    if (result) {
      jmnedictFile = result;
      console.log(`[JMnedict] Dictionary file prepared and ready`);
    } else {
      console.log(`[JMnedict] Dictionary file not available, will skip JMnedict`);
    }
  } catch (e: any) {
    console.warn(`[JMnedict] Failed to prepare dictionary:`, e.message);
  }
})();

const dictionaryReady = (async () => {
  // Ensure jmdict and jmnedict preparation is complete before checking for files
  await jmdictReady;

  // Initialize database
  await initDatabase();
  wordsCache = new WordsCache();
  jishoCache = new JishoCache();
  contentWordsStore = new ContentWordsStore();

  dictionary = new DictionaryManager();
  const jmdictPath = path.join(__dirname, 'jmdict-db');
  const jmdictFile = path.join(__dirname, 'jmdict-all-3.6.2.json');
  const jmdictExists = fs.existsSync(jmdictFile);

  const onJishoCacheUpdate = (cache: Map<string, any>) => {
    // Sync updated cache entries from dictionary (fire-and-forget during initialization)
    for (const [key, value] of cache.entries()) {
      if (!jishoCache.has(key)) {
        jishoCache.set(key, value).catch(e =>
          console.error('[Cache] Error updating Jisho cache:', e.message)
        );
      }
    }
  };

  if (jmdictExists) {
    console.log('[Dictionary] jmdict file found, attempting to initialize');
    await dictionary.initialize('jmdict', jmdictPath, jmdictFile, jmnedictFile as string | undefined, jishoCache as any, onJishoCacheUpdate);
  } else {
    console.log('[Dictionary] jmdict file not found, using Jisho API');
    await dictionary.initialize('jisho', undefined, undefined, jmnedictFile as string | undefined, jishoCache as any, onJishoCacheUpdate);
  }
  console.log('[Dictionary] Initialization complete');
  wordResolver = new WordResolver(dictionary);

  // Pre-load all cached words from database into memory for fast lookups
  const preloadStart = Date.now();
  wordsCache.preload();
  const preloadTime = Date.now() - preloadStart;
  console.log(`[Server] Pre-loaded ${wordsCache.size} words and ${jishoCache.size} Jisho entries from database (${preloadTime}ms)`);

  // Load decompressed cache files in the background (don't block server startup)
  const loadCachesInBackground = async () => {
    const wordCacheFile = path.join(__dirname, '.word-cache.json');
    const jishoCacheFile = path.join(__dirname, '.jisho-cache.json');

    if (fs.existsSync(jishoCacheFile)) {
      try {
        const cacheStart = Date.now();
        const data = JSON.parse(fs.readFileSync(jishoCacheFile, 'utf-8'));
        for (const [word, result] of Object.entries(data)) {
          if (!jishoCache.has(word)) {
            jishoCache.set(word, result).catch(e =>
              console.error('[Cache] Error loading Jisho cache entry:', e.message)
            );
          }
        }
        const elapsed = Date.now() - cacheStart;
        console.log(`[Cache] Jisho cache: loaded ${Object.keys(data).length} entries in ${elapsed}ms`);
      } catch (e: any) {
        console.warn('[Cache] Failed to load Jisho cache:', e.message);
      }
    }

    // Compressed cache loading disabled - database provides words via lazy load
    const wordCacheGzFile = path.join(__dirname, '.word-cache.json.gz');
    if (fs.existsSync(wordCacheGzFile)) {
      console.log('[Cache] Word cache file exists but skipped (using database instead)');
    }
  };

  // Load caches in background so server isn't blocked
  loadCachesInBackground().catch(e => console.error('[Cache] Background loading error:', e));
})();



// ---------------------------------------------------------------------------
// Background re-lookup for "Unknown meaning" cache entries
//
// Words extracted before the dictionary was fully initialised (or before the
// JMnedict fallback fix) land in content_words with meaning="Unknown meaning".
// On the next request that serves those words we fire a background re-resolution
// so subsequent requests return real definitions without blocking the first one.
// ---------------------------------------------------------------------------

const refreshingContent = new Set<string>();
const lastRefreshTime = new Map<string, number>();
const REFRESH_COOLDOWN_MS = 30 * 60 * 1000; // 30 minutes per content ID

async function refreshUnknownMeanings(contentId: string, words: WordInfo[]): Promise<void> {
  if (!wordResolver) return;

  const unknownWords = words.filter(
    w => w.meaning === 'Unknown meaning' && !isPunctuation(w.word)
  );
  if (unknownWords.length === 0) return;

  console.log(`[Cache] Refreshing ${unknownWords.length} unknown-meaning words for ${contentId}`);
  const wordMap = new Map(words.map(w => [w.word, { ...w }]));
  let updated = false;

  for (const w of unknownWords) {
    try {
      // Same base-form derivation as /api/word: conjugated surfaces need the
      // Sudachi normalized form or the JMDict lookup misses again.
      let baseForm = w.word;
      let pos: string | undefined;
      let tokenReading: string | undefined;
      if (tokenizer) {
        try {
          const toks = await tokenizer.segment(w.word);
          if (toks.length === 1 && toks[0].baseForm) {
            baseForm = toks[0].baseForm;
            pos = toks[0].pos;
            tokenReading = toks[0].reading;
          }
        } catch { /* fall back to the raw word */ }
      }
      const resolution = await wordResolver.resolve(w.word, baseForm, undefined, pos, tokenReading);
      if (resolution.meaning !== 'Unknown meaning') {
        wordMap.set(w.word, {
          ...wordMap.get(w.word)!,
          reading: resolution.reading,
          meaning: resolution.meaning,
          ...(resolution.meanings ? { meanings: resolution.meanings } : {}),
          jlpt: resolution.jlpt,
          joyo: resolution.joyo,
          score: resolution.score,
          breakdown: resolution.breakdown,
        });
        updated = true;
      }
    } catch (e: any) {
      console.error(`[Cache] Refresh failed for "${w.word}":`, e.message);
    }
  }

  if (updated) {
    await contentWordsStore.setContentWords(contentId, [...wordMap.values()]);
    await saveDatabase();
    console.log(`[Cache] Updated unknown-meaning entries for ${contentId}`);
  }
}

function scheduleRefreshIfNeeded(contentId: string, words: WordInfo[]): void {
  if (refreshingContent.has(contentId)) return;
  const now = Date.now();
  if (now - (lastRefreshTime.get(contentId) ?? 0) < REFRESH_COOLDOWN_MS) return;
  if (!words.some(w => w.meaning === 'Unknown meaning' && !isPunctuation(w.word))) return;

  refreshingContent.add(contentId);
  lastRefreshTime.set(contentId, now);
  refreshUnknownMeanings(contentId, words).finally(() => {
    refreshingContent.delete(contentId);
  });
}

async function processText(text: string, kanaLookupCache?: Map<string, any>) {
  if (!tokenizer) throw new Error("Tokenizer not ready");
  const tokens = await tokenizer.segment(text);

  // Count how many times each word appears (for frequencyInContent)
  const baseFormCounts = new Map<string, number>();
  const validWords = new Map<string, { baseForm: string; pos?: string; reading?: string }>();
  const morphemes = new Map<string, { meaning: string; frequency: number }>(); // Track morpheme frequencies

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
      validWords.set(surface, { baseForm: token.baseForm, pos: token.pos, reading: token.reading });
      baseFormCounts.set(surface, (baseFormCounts.get(surface) ?? 0) + 1);
    }
  }

  let cacheHits = 0;
  let cacheMisses = 0;
  const hitWords: string[] = [];
  const missWords: string[] = [];
  const results = [];
  const processedWords: string[] = [];
  for (const [wordStr, { baseForm, pos, reading: tokenReading }] of validWords) {
    processedWords.push(wordStr);
    const start = Date.now();
    const cacheHit = wordsCache.has(baseForm) || wordsCache.has(wordStr);

    const { reading, meaning, meanings, jlpt, joyo, score, breakdown } =
      await wordResolver!.resolve(wordStr, baseForm, kanaLookupCache, pos, tokenReading);

    const lookupTime = Date.now() - start;
    if (cacheHit) {
      cacheHits++;
      hitWords.push(wordStr);
    } else {
      cacheMisses++;
      missWords.push(wordStr);
    }
    if (lookupTime > 250) {
      console.log(`[API] Slow lookup: "${wordStr}" took ${lookupTime}ms`);
    }

    const frequencyInContent = baseFormCounts.get(wordStr) ?? 1;
    const wordData: any = { word: wordStr, reading, meaning, jlpt, joyo, score, breakdown, frequencyInContent, ...(pos ? { pos } : {}) };
    if (meanings) wordData.meanings = meanings;
    results.push(wordData);
  }

  // Add morpheme definitions
  for (const [morpheme, { meaning, frequency }] of morphemes) {
    const morphemeData: any = {
      word: morpheme,
      reading: morpheme,
      meaning,
      jlpt: 0,
      joyo: false,
      score: 0,
      breakdown: { jlptScore: 0, joyoPenalty: 0, highestGrade: null, freqPenalty: 0, jlptValues: [], gradeValues: [], priorities: [] },
      frequencyInContent: frequency,
      isMorpheme: true
    };
    results.push(morphemeData);
  }

  return results;
}

async function processTextWithTokens(text: string, tokens: any[], kanaLookupCache: Map<string, any>, batchResolutionCache?: Map<string, any>) {

  // Count how many times each word appears (for frequencyInContent)
  const baseFormCounts = new Map<string, number>();
  const validWords = new Map<string, { baseForm: string; pos?: string; reading?: string }>();
  const morphemes = new Map<string, { meaning: string; frequency: number }>(); // Track morpheme frequencies

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
      validWords.set(surface, { baseForm: token.baseForm, pos: token.pos, reading: token.reading });
      baseFormCounts.set(surface, (baseFormCounts.get(surface) ?? 0) + 1);
    }
  }

  const results = [];
  for (const [wordStr, { baseForm, pos, reading: tokenReading }] of validWords) {
    const start = Date.now();

    // Check batch-level resolution cache first to avoid re-resolving the same word
    const cacheKey = `${wordStr}|${baseForm}|${pos ?? ''}|${tokenReading ?? ''}`;
    let resolution;
    if (batchResolutionCache?.has(cacheKey)) {
      resolution = batchResolutionCache.get(cacheKey);
    } else {
      resolution = await wordResolver!.resolve(wordStr, baseForm, kanaLookupCache, pos, tokenReading);
      batchResolutionCache?.set(cacheKey, resolution);
    }

    const { reading, meaning, meanings, jlpt, joyo, score, breakdown } = resolution;

    const lookupTime = Date.now() - start;
    if (lookupTime > 250) {
      console.log(`[API] Slow lookup: "${wordStr}" took ${lookupTime}ms`);
    }

    const frequencyInContent = baseFormCounts.get(wordStr) ?? 1;
    const wordData: any = { word: wordStr, reading, meaning, jlpt, joyo, score, breakdown, frequencyInContent, ...(pos ? { pos } : {}) };
    if (meanings) wordData.meanings = meanings;
    results.push(wordData);
  }

  // Add morpheme definitions
  for (const [morpheme, { meaning, frequency }] of morphemes) {
    const morphemeData: any = {
      word: morpheme,
      reading: morpheme,
      meaning,
      jlpt: 0,
      joyo: false,
      score: 0,
      breakdown: { jlptScore: 0, joyoPenalty: 0, highestGrade: null, freqPenalty: 0, jlptValues: [], gradeValues: [], priorities: [] },
      frequencyInContent: frequency,
      isMorpheme: true
    };
    results.push(morphemeData);
  }

  return results;
}

async function processStoryText(text: string) {
  if (!tokenizer) throw new Error("Tokenizer not ready");
  const tokenInfos = await tokenizer.segment(text);

  // Find positions of each segment in the original text
  const tokens: any[] = [];
  let searchStart = 0;

  for (const tokenInfo of tokenInfos) {
    const surface = tokenInfo.surface;
    const segmentIndex = text.indexOf(surface, searchStart);
    if (segmentIndex === -1) {
      console.warn(`[API] Could not find segment "${surface}" in text starting from position ${searchStart}`);
      continue;
    }

    // Every Japanese token gets a meaning in the reader — readers hovering
    // over は or ました must see what it does, not dead text. Three classes:
    //   - grammar morphemes (particle / auxiliary, incl. conjugated surfaces
    //     like でし・たく via the base form) → morpheme-table definition
    //   - everything else Japanese → full dictionary resolution
    //   - single kana with no table entry → generic fallback (never JMDict:
    //     homograph lookup on ね/よ returns nonsense like 根 "root")
    const isJapanese = surface.trim() !== '' && !isPunctuation(surface);
    const isMorpheme = isJapanese && getGrammarDefinition(surface, tokenInfo.baseForm) !== undefined;
    const isVocabWord = isJapanese && !isMorpheme && !isSingleKana(surface);

    tokens.push({
      surface: surface,
      baseForm: tokenInfo.baseForm,
      pos: tokenInfo.pos,
      reading: tokenInfo.reading,
      startIndex: segmentIndex,
      endIndex: segmentIndex + surface.length,
      isVocabWord,
      isMorpheme,
      isJapanese,
    });

    searchStart = segmentIndex + surface.length;
  }

  // Look up vocab words
  const vocabTokens = tokens.filter(t => t.isVocabWord);
  const tokenMap = new Map<string, any>();

  for (const token of vocabTokens) {
    if (tokenMap.has(token.surface)) continue;

    const { reading, meaning, meanings, jlpt, joyo, score, breakdown } =
      await wordResolver!.resolve(token.surface, token.baseForm, undefined, token.pos, token.reading);

    tokenMap.set(token.surface, { word: token.surface, reading, meaning, jlpt, joyo, score, breakdown, meanings, ...(token.pos ? { pos: token.pos } : {}) });
  }

  // Add morpheme definitions to tokenMap
  const emptyBreakdown = { jlptScore: 0, joyoPenalty: 0, highestGrade: null, freqPenalty: 0, jlptValues: [], gradeValues: [], priorities: [] };
  for (const token of tokens) {
    if (tokenMap.has(token.surface)) continue;
    if (token.isMorpheme) {
      tokenMap.set(token.surface, {
        word: token.surface,
        reading: token.surface,
        meaning: getGrammarDefinition(token.surface, token.baseForm) || "Grammatical morpheme",
        jlpt: 0,
        joyo: false,
        score: 0,
        breakdown: emptyBreakdown,
        isMorpheme: true
      });
    } else if (token.isJapanese && !token.isVocabWord) {
      // Single kana with no morpheme-table entry — still hoverable.
      tokenMap.set(token.surface, {
        word: token.surface,
        reading: token.surface,
        meaning: "Kana particle / expression",
        jlpt: 0,
        joyo: false,
        score: 0,
        breakdown: emptyBreakdown,
        isMorpheme: true
      });
    }
  }

  // Enrich tokens with word info. isVocabWord doubles as the client's
  // "hoverable" flag (ContentReader shows the tooltip when isVocabWord &&
  // wordInfo), so every Japanese token that got an entry above is marked.
  const enrichedTokens = tokens.map(({ isJapanese, ...token }) => {
    if (isJapanese && tokenMap.has(token.surface)) {
      return {
        ...token,
        isVocabWord: true,
        wordInfo: tokenMap.get(token.surface),
      };
    }
    return token;
  });

  return enrichedTokens;
}

type BatchResult = { id: string; words?: any[]; elapsed?: number; error?: string };

async function runBatchExtract(texts: { id: string; text: string }[]): Promise<BatchResult[]> {
  const batchStart = Date.now();
  console.log(`[API] /api/batch-extract: Processing ${texts.length} items (cache: ${wordsCache.size} words)`);

  // Sort by text length (shorter first) for faster initial cache warmup
  const sortedTexts = [...texts].sort((a, b) => (a.text?.length ?? 0) - (b.text?.length ?? 0));

  // Step 1: Tokenize all texts concurrently
  const tokenStart = Date.now();
  const tokenizedBatch = await Promise.all(
    sortedTexts.map(async (item) => {
      if (!item.text || typeof item.text !== "string") return { ...item, tokens: null };
      try {
        const tokens = await tokenizer!.segment(item.text);
        return { ...item, tokens };
      } catch (e) {
        console.error(`[API] Tokenization error for item ${item.id}:`, e instanceof Error ? e.message : String(e));
        return { ...item, tokens: null };
      }
    })
  );
  console.log(`[API] /api/batch-extract: Step 1 - Tokenization completed in ${Date.now() - tokenStart}ms`);

  // Collect unique kana-only words from all texts
  const collectStart = Date.now();
  const uniqueKanaWords = new Set<string>();
  for (const item of tokenizedBatch) {
    if (!item.tokens) continue;
    for (const token of item.tokens) {
      const surface = token.surface;
      if (surface.trim() === '' || isPunctuation(surface) || isSingleKana(surface)) continue;
      if (/^[ぁ-ん]+$/.test(surface) || /^[ァ-ヴー]+$/.test(surface)) {
        if (!looksLikePartialStem(surface)) uniqueKanaWords.add(surface);
      }
    }
  }
  console.log(`[API] /api/batch-extract: Step 2 - Found ${uniqueKanaWords.size} unique kana words in ${Date.now() - collectStart}ms`);

  // Step 3: Look up kana words with concurrency limit
  const lookupStart = Date.now();
  const kanaLookupCache = new Map<string, any>();
  if (dictionary && uniqueKanaWords.size > 0) {
    const words = Array.from(uniqueKanaWords);
    const concurrencyLimit = 5;
    const kanaResults: { word: string; result: any }[] = [];
    let activeCount = 0;
    let index = 0;

    await new Promise<void>((resolve, reject) => {
      const processNext = async () => {
        try {
          if (index >= words.length && activeCount === 0) { resolve(); return; }
          if (activeCount < concurrencyLimit && index < words.length) {
            const word = words[index++];
            activeCount++;
            try {
              const result = await dictionary!.lookup(word);
              kanaResults.push({ word, result });
            } catch (e) {
              console.error(`[API] Kana lookup error for "${word}":`, e instanceof Error ? e.message : String(e));
              kanaResults.push({ word, result: null });
            } finally {
              activeCount--;
              await processNext();
            }
          } else if (index < words.length) {
            setTimeout(() => processNext().catch(reject), 10);
          }
        } catch (err) { reject(err); }
      };
      for (let i = 0; i < concurrencyLimit; i++) processNext().catch(reject);
    });

    for (const { word, result } of kanaResults) {
      kanaLookupCache.set(word, result);
      if (result) {
        await wordsCache.set(word, [{
          meanings: [{ glosses: [result.meaning || 'Unknown'] }],
          variants: [{ pronounced: result.reading || word, written: word }]
        } as any]);
      }
    }
  }
  const foundCount = Array.from(kanaLookupCache.values()).filter(v => v !== null).length;
  console.log(`[API] /api/batch-extract: Step 3 - Kana lookup completed in ${Date.now() - lookupStart}ms (${foundCount}/${uniqueKanaWords.size} found)`);

  // Step 3.5: Pre-populate wordsCache with kanji/mixed words, deduplicated across all items
  const kanjiPreloadStart = Date.now();
  const uniqueKanjiWords = new Map<string, string>(); // surface -> baseForm
  for (const item of tokenizedBatch) {
    if (!item.tokens) continue;
    for (const token of item.tokens) {
      const surface = token.surface;
      if (surface.trim() === '' || isPunctuation(surface) || isSingleKana(surface)) continue;
      if (!/^[ぁ-ん]+$/.test(surface) && !/^[ァ-ヴー]+$/.test(surface) && !uniqueKanjiWords.has(surface)) {
        uniqueKanjiWords.set(surface, token.baseForm);
      }
    }
  }
  let kanjiPreloaded = 0;
  for (const [surface, baseForm] of uniqueKanjiWords) {
    if (!wordsCache.has(baseForm)) {
      const entries = getCachedDictionaryEntries(baseForm);
      if (entries.length > 0) { await wordsCache.set(baseForm, entries); kanjiPreloaded++; }
    }
    if (surface !== baseForm && !wordsCache.has(surface)) {
      const entries = getCachedDictionaryEntries(surface);
      if (entries.length > 0) await wordsCache.set(surface, entries);
    }
  }
  console.log(`[API] /api/batch-extract: Step 3.5 - Pre-loaded ${kanjiPreloaded}/${uniqueKanjiWords.size} kanji words in ${Date.now() - kanjiPreloadStart}ms`);

  // Step 4: Process each text using the pre-built caches
  // Create a batch-level resolution cache to avoid resolving the same word multiple times
  const batchResolutionCache = new Map<string, any>();
  const processStart = Date.now();
  const results: BatchResult[] = await Promise.all(
    tokenizedBatch.map(async (item) => {
      const { id, text, tokens } = item;
      if (!text || typeof text !== "string") return { id, error: "No text" };
      if (!tokens) return { id, error: "Tokenization failed" };
      const start = Date.now();
      try {
        const words = await processTextWithTokens(text, tokens, kanaLookupCache, batchResolutionCache);
        const elapsed = Date.now() - start;
        console.log(`[API] batch-extract[${id}]: ${words.length} words in ${elapsed}ms`);
        return { id, words, elapsed };
      } catch (e: any) {
        console.error(`[API] batch-extract[${id}]: Error:`, e instanceof Error ? e.message : String(e));
        return { id, error: e instanceof Error ? e.message : String(e) };
      }
    })
  );
  console.log(`[API] /api/batch-extract: Step 4 - Text processing completed in ${Date.now() - processStart}ms`);

  // Persist content-word associations
  for (const result of results) {
    if (result.words && Array.isArray(result.words)) {
      await contentWordsStore.setContentWords(result.id, result.words);
    }
  }
  await saveDatabase();

  console.log(`[API] /api/batch-extract: Complete - cache now has ${wordsCache.size} words (total: ${Date.now() - batchStart}ms)`);
  return results;
}

/**
 * Background loader for music lyrics from uta-net.com.
 * Detects placeholder transcripts and auto-fetches actual lyrics on startup.
 * Runs non-blocking after server is bound to port.
 */
async function loadMusicTranscriptsInBackground() {
  try {
    const musicDir = path.join(process.cwd(), 'src', 'music');
    if (!fs.existsSync(musicDir)) {
      return; // No music directory
    }

    const musicFolders = fs.readdirSync(musicDir);
    const toFetch: Array<{ id: string; title: string; sourceUrl: string; transcriptPath: string }> = [];

    // Identify placeholders
    for (const folder of musicFolders) {
      const metadataPath = path.join(musicDir, folder, 'metadata.json');
      const transcriptPath = path.join(musicDir, folder, 'transcript.md');

      if (!fs.existsSync(metadataPath) || !fs.existsSync(transcriptPath)) continue;

      try {
        const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf-8'));
        const transcript = fs.readFileSync(transcriptPath, 'utf-8');

        // Check if it's a placeholder (contains "to be fetched" or "Placeholder" or is just the header)
        const isPlaceholder =
          transcript.includes('to be fetched') ||
          transcript.includes('Placeholder') ||
          transcript.includes('fetch') ||
          transcript.trim().split('\n').length < 5; // Very short = likely placeholder

        if (
          isPlaceholder &&
          metadata.sourceUrl &&
          metadata.sourceUrl.includes('uta-net.com')
        ) {
          toFetch.push({
            id: metadata.id,
            title: metadata.title,
            sourceUrl: metadata.sourceUrl,
            transcriptPath,
          });
        }
      } catch (e) {
        // Skip errors per-folder
      }
    }

    if (toFetch.length === 0) {
      console.log('[Lyrics] All music transcripts already populated — skipping');
      return;
    }

    console.log(
      `[Lyrics] Background loader: ${toFetch.length} placeholder transcripts detected`
    );

    // Batch-fetch with rate limiting (delay between fetches to avoid hammering uta-net)
    const DELAY_MS = 1000; // 1 second between requests
    for (let i = 0; i < toFetch.length; i++) {
      const item = toFetch[i];

      // Delay before fetch (except the first one)
      if (i > 0) {
        await new Promise(resolve => setTimeout(resolve, DELAY_MS));
      }

      try {
        console.log(`[Lyrics] Fetching ${item.id} (${i + 1}/${toFetch.length})...`);

        const response = await fetch(item.sourceUrl);
        if (!response.ok) {
          console.warn(`[Lyrics] Failed to fetch ${item.id}: HTTP ${response.status}`);
          continue;
        }

        const html = await response.text();

        // Parse uta-net HTML: lyrics are in <div id="kashi_area">
        const match = html.match(
          /<div id="kashi_area">[\s\S]*?<\/div>/i
        );
        if (!match) {
          console.warn(`[Lyrics] No #kashi_area found in ${item.sourceUrl}`);
          continue;
        }

        let lyricsHtml = match[0];

        // Convert <br> to newlines
        lyricsHtml = lyricsHtml.replace(/<br\s*\/?>/gi, '\n');

        // Remove all HTML tags
        lyricsHtml = lyricsHtml.replace(/<[^>]+>/g, '');

        // Decode HTML entities
        lyricsHtml = lyricsHtml
          .replace(/&nbsp;/g, ' ')
          .replace(/&amp;/g, '&')
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/&quot;/g, '"')
          .replace(/&#39;/g, "'");

        // Clean up whitespace
        const lyrics = lyricsHtml
          .split('\n')
          .map((line) => line.trim())
          .filter((line) => line.length > 0)
          .join('\n');

        if (!lyrics) {
          console.warn(
            `[Lyrics] Extracted empty lyrics for ${item.id}`
          );
          continue;
        }

        // Write to transcript.md
        fs.writeFileSync(item.transcriptPath, lyrics + '\n', 'utf-8');
        console.log(
          `[Lyrics] ✓ ${item.id} — ${lyrics.split('\n').length} lines`
        );
      } catch (e) {
        console.error(
          `[Lyrics] Error fetching ${item.id}:`,
          e instanceof Error ? e.message : String(e)
        );
      }
    }

    console.log('[Lyrics] Background loading complete');
  } catch (e) {
    console.error(
      '[Lyrics] Background loader error:',
      e instanceof Error ? e.message : String(e)
    );
  }
}

async function startServer() {
  // Startup takes ~30 seconds: dictionary decompression and tokenizer (Sudachi WASM)
  // both load here before the server binds. Wait for "Server running on http://localhost:3000"
  // before sending requests — the port is not open until this function reaches app.listen().
  console.log('[Server] Starting up — please wait ~30s for dictionaries and tokenizer to load before sending requests...');
  await tokenizerReady;
  await dictionaryReady;

  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: '50mb' }));

  // Log only non-asset requests to reduce noise
  app.use((req, _res, next) => {
    if (!req.path.match(/\.(js|css|map|json|woff|woff2|ttf|svg)$/)) {
      console.log(`[Server] ${req.method} ${req.path}`);
    }
    next();
  });

  const MAX_TEXT_LENGTH = 50000;
  const JAPANESE_SCRIPT = /[぀-ゟ゠-ヿ一-鿿]/;

  app.post("/api/extract", async (req, res) => {
    const start = Date.now();
    try {
      const { text } = req.body;
      if (!text) {
        return res.status(400).json({ error: "No text provided" });
      }
      if (typeof text !== "string" || text.length > MAX_TEXT_LENGTH) {
        return res.status(400).json({ error: `Text exceeds the ${MAX_TEXT_LENGTH} character limit` });
      }
      if (!JAPANESE_SCRIPT.test(text)) {
        return res.status(400).json({ error: "Text must contain Japanese characters" });
      }

      const cacheSizeBefore = wordsCache.size;
      console.log(`[API] /api/extract: START - cache has ${cacheSizeBefore} words`);
      const words = await processText(text);
      const cacheSizeAfter = wordsCache.size;
      const elapsed = Date.now() - start;
      console.log(`[API] /api/extract: DONE - added ${cacheSizeAfter - cacheSizeBefore} words to cache (total: ${cacheSizeAfter}) in ${elapsed}ms`);
      res.json(words);
    } catch (e: any) {
      console.error(`[API Error] /api/extract failed after ${Date.now() - start}ms:`, e.message);
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/batch-extract", async (req, res) => {
    try {
      const { texts } = req.body;
      if (!Array.isArray(texts)) {
        return res.status(400).json({ error: "texts must be an array" });
      }
      const results = await runBatchExtract(texts);
      res.json(results);
    } catch (err: any) {
      console.error(`[API] batch-extract failed:`, err instanceof Error ? err.message : String(err));
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.post("/api/process-story", async (req, res) => {
    const start = Date.now();
    try {
      const { text } = req.body;
      if (!text) {
        return res.status(400).json({ error: "No text provided" });
      }
      if (typeof text !== "string" || text.length > MAX_TEXT_LENGTH) {
        return res.status(400).json({ error: `Text exceeds the ${MAX_TEXT_LENGTH} character limit` });
      }
      if (!JAPANESE_SCRIPT.test(text)) {
        return res.status(400).json({ error: "Text must contain Japanese characters" });
      }

      const tokens = await processStoryText(text);
      const elapsed = Date.now() - start;
      console.log(`[API] /api/process-story: ${tokens.length} tokens in ${elapsed}ms`);
      res.json({ tokens });
    } catch (e: any) {
      console.error(`[API Error] /api/process-story failed after ${Date.now() - start}ms:`, e.message);
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/update-words", async (req, res) => {
    const start = Date.now();
    try {
      const { words } = req.body;
      if (!Array.isArray(words)) {
        return res.status(400).json({ error: "Invalid words array" });
      }

      console.log(`[API] /api/update-words: scoring ${words.length} words`);
      const results = await Promise.all(words.map(async (w: Record<string, unknown>) => {
        const wordStr = w.word as string | undefined;
        if (!wordStr) return w;

        const { jlpt, joyo, score, breakdown } = await wordResolver!.resolve(wordStr, wordStr);

        return {
          ...w,
          score: w.score ?? score,
          breakdown: w.breakdown ?? breakdown,
          jlpt: w.jlpt ?? jlpt,
          joyo: w.joyo ?? joyo,
        };
      }));

      console.log(`[API] /api/update-words: completed in ${Date.now() - start}ms`);
      res.json(results);
    } catch (e: any) {
      console.error(`[API Error] /api/update-words failed after ${Date.now() - start}ms:`, e.message);
      res.status(500).json({ error: e.message });
    }
  });

  const WK_HEADERS = (token: string) => ({
    'Authorization': `Bearer ${token}`,
    'Wanikani-Revision': '20170710',
    'Content-Type': 'application/json',
  });

  app.post("/api/clear-cache", async (req, res) => {
    try {
      const wordCacheSize = wordsCache.size;
      const jishoCacheSize = jishoCache.size;

      await wordsCache.clear();
      await jishoCache.clear();
      await contentWordsStore.clear();
      await saveDatabase();

      console.log(`[API] /api/clear-cache: Cleared ${wordCacheSize} words and ${jishoCacheSize} Jisho entries`);

      res.json({
        cleared: true,
        message: `Cleared ${wordCacheSize} words and ${jishoCacheSize} Jisho entries`
      });
    } catch (e: any) {
      console.error('[API] /api/clear-cache failed:', e.message);
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/content/words", (req, res) => {
    try {
      const allWords = contentWordsStore.getAllContentWords();
      res.json(allWords);

      // Schedule background refresh for content IDs with unknown-meaning words,
      // limited to 3 at a time so we don't flood the event loop on the bulk call.
      let scheduled = 0;
      for (const [contentId, words] of Object.entries(allWords)) {
        if (scheduled >= 3) break;
        if (!refreshingContent.has(contentId)) {
          scheduleRefreshIfNeeded(contentId, words);
          if (refreshingContent.has(contentId)) scheduled++;
        }
      }
    } catch (e: any) {
      console.error('[API Error] /api/content/words failed:', e.message);
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/content/:contentId/words", (req, res) => {
    try {
      const { contentId } = req.params;
      const words = contentWordsStore.getContentWords(contentId);
      res.json(words);
      scheduleRefreshIfNeeded(contentId, words);
    } catch (e: any) {
      console.error(`[API Error] /api/content/${req.params.contentId}/words failed:`, e.message);
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/wanikani/validate", async (req, res) => {
    try {
      const { token } = req.body;
      if (!token || typeof token !== 'string') {
        return res.status(400).json({ valid: false, error: 'No token provided' });
      }
      const r = await fetch('https://api.wanikani.com/v2/user', { headers: WK_HEADERS(token) });
      if (!r.ok) return res.json({ valid: false });
      const data = await r.json() as { data: { username: string; level: number } };
      res.json({ valid: true, username: data.data.username, level: data.data.level });
    } catch (e: any) {
      console.error('[WaniKani] validate error:', e.message);
      res.status(500).json({ valid: false, error: e.message });
    }
  });

  app.get("/api/word/:word", async (req, res) => {
    const start = Date.now();
    try {
      const { word } = req.params;
      if (!word || typeof word !== 'string') {
        return res.status(400).json({ error: 'No word provided' });
      }

      // Derive the dictionary base form the same way the extraction paths do
      // (Sudachi normalized form), so the detail page shows the same meaning
      // as the vocab list and reader. Without this, conjugated surfaces like
      // 読みました missed JMDict entirely (no entry keys on the surface form).
      let baseForm = word;
      let pos: string | undefined;
      let tokenReading: string | undefined;
      if (tokenizer) {
        try {
          const toks = await tokenizer.segment(word);
          if (toks.length === 1 && toks[0].baseForm) {
            baseForm = toks[0].baseForm;
            pos = toks[0].pos;
            tokenReading = toks[0].reading;
          }
        } catch { /* fall back to the raw word */ }
      }

      // An explicit ?reading= from the client (the in-context reading of the
      // token the user clicked) beats the standalone segmentation: 人 clicked
      // inside 六人 reads にん and must show the counter, not ひと "person".
      const queryReading = req.query.reading;
      if (typeof queryReading === 'string' && /^[ぁ-んーァ-ヴ]+$/.test(queryReading)) {
        tokenReading = queryReading;
      }
      const queryPos = req.query.pos;
      if (typeof queryPos === 'string' && /^[぀-ヿ一-鿿]{1,8}$/.test(queryPos)) {
        pos = queryPos;
      }

      const { reading, meaning, meanings, variant, entry, jlpt, joyo, score, breakdown } =
        await wordResolver!.resolve(word, baseForm, undefined, pos, tokenReading);

      const wordData: any = { word, reading, meaning, jlpt, joyo, score, breakdown, entry };
      if (meanings) wordData.meanings = meanings;

      const elapsed = Date.now() - start;
      console.log(`[API] /api/word/${word}: completed in ${elapsed}ms`);
      res.json(wordData);
    } catch (e: any) {
      console.error(`[API Error] /api/word failed:`, e.message);
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/wanikani/sync", async (req, res) => {
    const start = Date.now();
    try {
      const { token } = req.body;
      if (!token || typeof token !== 'string') {
        return res.status(400).json({ error: 'No token provided' });
      }

      // Fetch all started kanji assignments (paginated)
      const assignments = new Map<number, number>(); // subject_id -> srs_stage
      let assignmentsUrl: string | null = 'https://api.wanikani.com/v2/assignments?subject_types=kanji&started=true';
      while (assignmentsUrl) {
        const r = await fetch(assignmentsUrl, { headers: WK_HEADERS(token) });
        if (!r.ok) return res.status(401).json({ error: 'WaniKani API error' });
        const body = await r.json() as {
          data: Array<{ data: { subject_id: number; srs_stage: number } }>;
          pages: { next_url: string | null };
        };
        for (const item of body.data) {
          assignments.set(item.data.subject_id, item.data.srs_stage);
        }
        assignmentsUrl = body.pages?.next_url ?? null;
      }

      console.log(`[WaniKani] Fetched ${assignments.size} kanji assignments in ${Date.now() - start}ms`);

      // Fetch subjects for those IDs to get characters (batch by 500)
      const subjectIds = Array.from(assignments.keys());
      const characters = new Map<number, string>(); // id -> kanji character
      for (let i = 0; i < subjectIds.length; i += 500) {
        const batch = subjectIds.slice(i, i + 500).join(',');
        let subjectsUrl: string | null = `https://api.wanikani.com/v2/subjects?ids=${batch}`;
        while (subjectsUrl) {
          const r = await fetch(subjectsUrl, { headers: WK_HEADERS(token) });
          if (!r.ok) break;
          const body = await r.json() as {
            data: Array<{ id: number; data: { characters: string } }>;
            pages: { next_url: string | null };
          };
          for (const item of body.data) {
            if (item.data.characters) characters.set(item.id, item.data.characters);
          }
          subjectsUrl = body.pages?.next_url ?? null;
        }
      }

      // Build character -> srs_stage map
      const result: Record<string, number> = {};
      for (const [subjectId, srsStage] of assignments) {
        const char = characters.get(subjectId);
        if (char) result[char] = srsStage;
      }

      console.log(`[WaniKani] Sync complete: ${Object.keys(result).length} kanji mapped in ${Date.now() - start}ms`);
      res.json({ data: result, kanjiCount: Object.keys(result).length });
    } catch (e: any) {
      console.error('[WaniKani] sync error:', e.message);
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/content", (req, res) => {
    try {
      const stories = loadStoriesFromDisk();
      const music = loadMusicFromDisk();
      const videos = loadVideosFromDisk();
      const allContent = [...stories, ...music, ...videos];
      res.json(allContent);
    } catch (e: any) {
      console.error('[API Error] /api/content failed:', e.message);
      res.status(500).json({ error: e.message });
    }
  });

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  const server = app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });

  // Kick off background extraction for any content not yet in content_words.
  // Runs in a worker_threads Worker so the Express event loop stays responsive
  // to user-facing API requests during the potentially minutes-long warmup.
  // Fix for #200: previously this ran inline and blocked the event loop.
  (async () => {
    try {
      const allContent = [
        ...loadStoriesFromDisk(),
        ...loadMusicFromDisk(),
        ...loadVideosFromDisk(),
      ];
      const missing = allContent.filter(c => !contentWordsStore.hasContent(c.id));
      if (missing.length === 0) {
        console.log('[Server] All content already extracted — skipping startup extraction');
        return;
      }
      console.log(`[Server] Starting background extraction for ${missing.length}/${allContent.length} content items (worker thread)`);

      const { Worker } = await import('worker_threads');

      // Build chunks upfront; we send one chunk at a time (wait for 'done' before
      // sending the next) so the worker's event loop isn't flooded.
      const CHUNK_SIZE = 20;
      const chunks: Array<{ id: string; text: string }[]> = [];
      for (let i = 0; i < missing.length; i += CHUNK_SIZE) {
        chunks.push(missing.slice(i, i + CHUNK_SIZE).map(c => ({ id: c.id, text: c.text })));
      }

      const workerData: WorkerInitData = {
        jmdictPath: path.join(__dirname, 'jmdict-db'),
        // Do not pass jmdictFile to the worker. jmdict-wrapper uses LevelDB
        // (classic-level) which holds an exclusive lock on the jmdict-db directory.
        // The main thread already holds that lock; a second open from the worker
        // thread fails with "Database is not open". The worker falls back to
        // Jisho API which is correct for background extraction.
        jmdictFile: null,
        jmnedictFile,
        // Seed the worker's kana cache with everything already persisted in this
        // process so the worker avoids redundant Jisho API round-trips.
        jishoCacheEntries: jishoCache.entries(),
      };

      // Use the plain-JS shim as the worker entry point.
      // The shim calls register() with the tsx ESM loader so that .ts imports
      // work inside the worker thread before bootstrapping extraction-worker.ts.
      // Pointing at the .ts file directly and passing execArgv=['--import','tsx/esm']
      // does not work: tsx skips hook registration when isMainThread is false.
      const workerUrl = new URL('./src/lib/extraction-worker-shim.mjs', import.meta.url);
      const worker = new Worker(workerUrl, { workerData });

      let currentChunk = 0;

      const sendNextChunk = () => {
        if (currentChunk < chunks.length) {
          worker.postMessage({ type: 'extract', items: chunks[currentChunk] });
        } else {
          console.log('[Server] Startup extraction complete');
          worker.terminate();
        }
      };

      worker.on('message', async (msg: WorkerOutMessage) => {
        switch (msg.type) {
          case 'ready':
            console.log('[Server] Extraction worker ready');
            sendNextChunk();
            break;
          case 'result':
            if (msg.words && Array.isArray(msg.words)) {
              await contentWordsStore.setContentWords(msg.id, msg.words);
            }
            break;
          case 'done':
            await saveDatabase();
            currentChunk++;
            console.log(`[Server] Extraction progress: ${currentChunk}/${chunks.length} chunks`);
            sendNextChunk();
            break;
          case 'init_error':
            console.error('[Server] Extraction worker error:', msg.message);
            break;
        }
      });

      worker.on('error', e =>
        console.error('[Server] Extraction worker thread error:', e instanceof Error ? e.message : String(e)),
      );
    } catch (e) {
      console.error('[Server] Failed to start extraction worker:', e instanceof Error ? e.message : String(e));
    }
  })();

  // Transcribe any music/video entries that have a playable URL but no transcript
  runStartupTranscription();

  // Scrape captions for any video entries that have placeholder transcripts
  runStartupCaptionScraper();

  // Load music lyrics in background from uta-net.com for placeholder transcripts
  loadMusicTranscriptsInBackground().catch((e) =>
    console.error('[Lyrics] Background loading error:', e instanceof Error ? e.message : String(e)),
  );

  // Save database on shutdown
  process.on('SIGINT', () => {
    console.log('\n[Server] Shutting down, saving database...');
    saveDatabase().then(() => process.exit(0)).catch(err => {
      console.error('[Server] Error saving database on shutdown:', err);
      process.exit(0);
    });
  });

  // SIGTERM was previously ignored (commit 1b49e85) to survive GitHub Codespaces idle
  // timeouts, but that breaks docker stop / systemd / k8s. If Codespaces kills the server
  // on idle, restart it — don't make the server unkillable to compensate.
  process.on('SIGTERM', () => {
    console.log('[Server] Received SIGTERM, shutting down gracefully...');
    saveDatabase().then(() => process.exit(0)).catch(err => {
      console.error('[Server] Error saving database on shutdown:', err);
      process.exit(0);
    });
  });
}

// ---------------------------------------------------------------------------
// Startup transcription — runs after port opens, non-blocking.
// Finds music/video entries that have a playable mediaUrl but no transcript.md
// and spawns transcribe-missing.ts as a background child process.
// ---------------------------------------------------------------------------

function isPlayableMediaUrl(url: string): boolean {
  if (!url) return false;
  return (
    /youtube\.com\/watch/.test(url) ||
    /youtu\.be\/[A-Za-z0-9_-]{11}/.test(url) ||
    /youtube\.com\/shorts\//.test(url) ||
    /youtube\.com\/embed\//.test(url) ||
    /nicovideo\.jp\/watch\//.test(url) ||
    /bilibili\.com\/video\//.test(url) ||
    /\.(mp3|mp4|wav|ogg|m4a|webm)(\?|$)/.test(url)
  );
}

function needsTranscript(dir: string): boolean {
  const p = path.join(dir, 'transcript.md');
  if (!fs.existsSync(p)) return true;
  const content = fs.readFileSync(p, 'utf8').trim();
  return content.length === 0 || /^\[.*\]$/.test(content);
}

function runStartupTranscription() {
  // Silently skip if prerequisites aren't installed — transcription is optional
  if (spawnSync('which', ['whisper']).status !== 0) return;
  if (spawnSync('which', ['yt-dlp']).status !== 0) return;

  // Count how many entries actually need transcription
  let needCount = 0;
  for (const contentType of ['music', 'videos'] as const) {
    const dir = path.join(__dirname, 'src', contentType);
    if (!fs.existsSync(dir)) continue;
    for (const name of fs.readdirSync(dir)) {
      const entryDir = path.join(dir, name);
      if (!fs.statSync(entryDir).isDirectory()) continue;
      const metaPath = path.join(entryDir, 'metadata.json');
      if (!fs.existsSync(metaPath)) continue;
      try {
        const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
        if (isPlayableMediaUrl(meta.mediaUrl ?? '') && needsTranscript(entryDir)) {
          needCount++;
        }
      } catch { /* skip malformed metadata */ }
    }
  }

  if (needCount === 0) {
    console.log('[Transcription] All content already has transcripts — skipping startup transcription');
    return;
  }

  console.log(`[Transcription] Starting background transcription for ${needCount} entries (model: large-v3)`);

  const scriptPath = path.join(__dirname, 'scripts', 'transcribe-missing.ts');
  const child = spawn('npx', ['tsx', scriptPath], {
    cwd: __dirname,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: false,
  });

  child.stdout.on('data', (chunk: Buffer) => {
    for (const line of chunk.toString().split('\n').filter(Boolean)) {
      console.log(`[Transcription] ${line}`);
    }
  });
  child.stderr.on('data', (chunk: Buffer) => {
    for (const line of chunk.toString().split('\n').filter(Boolean)) {
      console.log(`[Transcription] ${line}`);
    }
  });
  child.on('close', (code: number | null) => {
    if (code !== 0) {
      console.error(`[Transcription] Background transcription exited with code ${code}`);
      return;
    }
    console.log('[Transcription] Background transcription complete — running vocabulary extraction on new transcripts');

    // Re-load all music/video content from disk (transcripts now exist on disk)
    // and extract vocabulary for any that still lack it in contentWordsStore.
    const freshContent = [...loadMusicFromDisk(), ...loadVideosFromDisk()];
    const toExtract = freshContent.filter(
      c => c.text && c.text.trim().length > 0 && !contentWordsStore.hasContent(c.id)
    );

    if (toExtract.length === 0) {
      console.log('[Transcription] No new vocabulary to extract');
      return;
    }

    console.log(`[Transcription] Extracting vocabulary for ${toExtract.length} newly transcribed items`);
    runBatchExtract(toExtract.map(c => ({ id: c.id, text: c.text })))
      .then(async results => {
        for (const result of results) {
          if (result.words?.length) {
            await contentWordsStore.setContentWords(result.id, result.words);
          }
        }
        await saveDatabase();
        console.log(`[Transcription] Vocabulary extraction complete for ${results.length} items`);
      })
      .catch(err => {
        console.error('[Transcription] Vocabulary extraction error:', err instanceof Error ? err.message : String(err));
      });
  });
}

/**
 * Scrape real Japanese captions for videos with placeholder transcripts.
 * Runs as a non-blocking background process, pulling one video at a time with delays.
 * Detects video sources (YouTube, NHK) and uses source-specific handlers.
 */
function runStartupCaptionScraper() {
  const scriptPath = path.join(__dirname, 'scripts', 'background', 'scrape-video-captions.ts');

  // Script exits after one run (no prerequisites check needed — graceful failures are handled)
  console.log('[CaptionScraper] Starting background caption scraper');

  const child = spawn('npx', ['tsx', scriptPath], {
    cwd: __dirname,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: false,
  });

  child.stdout.on('data', (chunk: Buffer) => {
    for (const line of chunk.toString().split('\n').filter(Boolean)) {
      console.log(`[CaptionScraper] ${line}`);
    }
  });

  child.stderr.on('data', (chunk: Buffer) => {
    for (const line of chunk.toString().split('\n').filter(Boolean)) {
      console.log(`[CaptionScraper] ${line}`);
    }
  });

  child.on('close', (code: number | null) => {
    if (code !== 0) {
      console.warn(`[CaptionScraper] Exited with code ${code} (some captions may not have been pulled)`);
      return;
    }
    console.log('[CaptionScraper] Background caption scraping complete');
  });
}

startServer().catch((err) => {
  console.error('[Server] Fatal error during startup:', err);
  // Don't exit - server should continue even if there's an error
  // Don't exit - server should continue running
});

// Handle unhandled rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error('[Server] Unhandled Rejection:', {
    reason: reason instanceof Error ? reason.message : String(reason),
    stack: reason instanceof Error ? reason.stack : undefined,
    promise: String(promise)
  });
  // Don't exit - log and continue running
  console.error('[Server] Unhandled Rejection:', reason instanceof Error ? reason.message : String(reason));
  // Don't exit - server should continue running
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('[Server] Uncaught Exception:', {
    message: error.message,
    stack: error.stack,
    name: error.name
  });
  // Don't exit - log and continue running
  console.error('[Server] Uncaught Exception:', error instanceof Error ? error.message : String(error));
  // Don't exit - server should continue running
});
