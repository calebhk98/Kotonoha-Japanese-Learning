import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import * as tar from "tar";
import {
  DictionaryVariant,
  DictionaryEntry,
  FindBestVariantResult,
  JLPT_SCORES,
  JOYO_PENALTIES,
  getFrequencyPenalty,
  getWordScoreBreakdown,
  getCachedDictionaryEntries,
  findBestVariant,
  wordsCache,
  markCacheAsDirty,
  shouldSaveCache,
  clearCacheDirtyFlag,
} from "./src/lib/scoring.js";
import { DictionaryManager } from "./src/lib/dictionary.js";
import { createTokenizer, Tokenizer } from "./src/lib/tokenizers.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CACHE_FILE = path.join(__dirname, '.word-cache.json');
const JISHO_CACHE_FILE = path.join(__dirname, '.jisho-cache.json');
let jishoCache = new Map<string, any>();
let jishoCacheNeedsSave = false;

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

// Prepare JMnedict if needed
async function ensureJmnedictPrepared() {
  const jmnedictFile = path.join(__dirname, 'jmnedict.json');
  const sampleFile = path.join(__dirname, 'jmnedict-sample.json');

  if (fs.existsSync(jmnedictFile)) {
    console.log('[JMnedict] Found dictionary file');
    return jmnedictFile;
  }

  // Try to use sample file if available
  if (fs.existsSync(sampleFile)) {
    console.log('[JMnedict] Using sample dictionary file');
    try {
      const data = fs.readFileSync(sampleFile, 'utf-8');
      fs.writeFileSync(jmnedictFile, data);
      console.log('[JMnedict] Initialized from sample dictionary');
      return jmnedictFile;
    } catch (e: any) {
      console.warn('[JMnedict] Failed to initialize from sample:', e.message);
    }
  }

  // Try to fetch from scriptin's jmdict-simplified project
  try {
    console.log('[JMnedict] Attempting to fetch from remote source...');
    const response = await fetch('https://raw.githubusercontent.com/scriptin/jmdict-simplified/master/jmnedict.json', {
      signal: AbortSignal.timeout(30000)
    });
    if (!response.ok) {
      console.warn('[JMnedict] Remote fetch failed, will continue without JMnedict');
      return null;
    }

    console.log('[JMnedict] Downloading dictionary...');
    const data = await response.json();

    // Convert to simplified format if needed
    const simplified = Array.isArray(data) ? data.map((entry: any) => ({
      kana: entry.kana?.[0]?.text || entry.reading,
      kanji: entry.kanji?.[0]?.text || entry.written,
      meanings: entry.senses?.flatMap((sense: any) => sense.glosses?.map((g: any) => g.text || g)) || []
    })) : [];

    fs.writeFileSync(jmnedictFile, JSON.stringify(simplified, null, 2));
    console.log('[JMnedict] Successfully downloaded and cached dictionary');
    return jmnedictFile;
  } catch (e: any) {
    console.warn('[JMnedict] Failed to fetch JMnedict:', e.message);
    return null;
  }
}

// Load persisted cache from disk
function loadCacheFromDisk() {
  try {
    if (fs.existsSync(CACHE_FILE)) {
      const data = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf-8'));
      if (data && typeof data === 'object') {
        let count = 0;
        for (const [key, value] of Object.entries(data)) {
          wordsCache.set(key, value as DictionaryEntry[]);
          count++;
        }
        console.log(`[Server] Loaded ${count} words from cache file`);
        clearCacheDirtyFlag();
      }
    }
  } catch (e) {
    console.error('[Server] Failed to load cache from disk:', (e as any).message);
  }
}

// Load Jisho API cache from disk
function loadJishoCacheFromDisk() {
  try {
    if (fs.existsSync(JISHO_CACHE_FILE)) {
      const data = JSON.parse(fs.readFileSync(JISHO_CACHE_FILE, 'utf-8'));
      if (data && typeof data === 'object') {
        let count = 0;
        for (const [key, value] of Object.entries(data)) {
          jishoCache.set(key, value);
          count++;
        }
        console.log(`[Server] Loaded ${count} Jisho API entries from cache file`);
      }
    }
  } catch (e) {
    console.error('[Server] Failed to load Jisho cache from disk:', (e as any).message);
  }
}

// Save cache to disk
function saveCacheToDisk() {
  try {
    if (!shouldSaveCache()) return;

    const obj: Record<string, DictionaryEntry[]> = {};
    for (const [key, value] of wordsCache.entries()) {
      obj[key] = value;
    }
    fs.writeFileSync(CACHE_FILE, JSON.stringify(obj), 'utf-8');
    clearCacheDirtyFlag();
    console.log(`[Server] Saved ${wordsCache.size} words to cache file`);
  } catch (e) {
    console.error('[Server] Failed to save cache to disk:', (e as any).message);
  }
}

// Save Jisho API cache to disk
function saveJishoCacheToDisk() {
  try {
    if (!jishoCacheNeedsSave) return;

    const obj: Record<string, any> = {};
    for (const [key, value] of jishoCache.entries()) {
      obj[key] = value;
    }
    fs.writeFileSync(JISHO_CACHE_FILE, JSON.stringify(obj), 'utf-8');
    jishoCacheNeedsSave = false;
    console.log(`[Server] Saved ${jishoCache.size} Jisho API entries to cache file`);
  } catch (e) {
    console.error('[Server] Failed to save Jisho cache to disk:', (e as any).message);
  }
}

let tokenizer: Tokenizer | null = null;
let dictionary: DictionaryManager | null = null;

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

  // Load Jisho cache before initializing dictionary
  loadJishoCacheFromDisk();

  dictionary = new DictionaryManager();
  const jmdictPath = path.join(__dirname, 'jmdict-db');
  const jmdictFile = path.join(__dirname, 'jmdict-all-3.6.2.json');
  const jmdictExists = fs.existsSync(jmdictFile);

  const onJishoCacheUpdate = (cache: Map<string, any>) => {
    jishoCache = cache;
    jishoCacheNeedsSave = true;
  };

  if (jmdictExists) {
    console.log('[Dictionary] jmdict file found, attempting to initialize');
    await dictionary.initialize('jmdict', jmdictPath, jmdictFile, jmnedictFile as string | undefined, jishoCache, onJishoCacheUpdate);
  } else {
    console.log('[Dictionary] jmdict file not found, using Jisho API');
    await dictionary.initialize('jisho', undefined, undefined, jmnedictFile as string | undefined, jishoCache, onJishoCacheUpdate);
  }
  console.log('[Dictionary] Initialization complete');
})();


async function processText(text: string, kanaLookupCache?: Map<string, any>) {
  if (!tokenizer) throw new Error("Tokenizer not ready");
  const tokens = await tokenizer.segment(text);

  const particles = new Set(["は", "が", "を", "に", "へ", "と", "で", "も", "か", "の", "て", "な", "だ"]);
  const isPunctuation = (s: string) => /[、。！？・「」『』（）()[\]a-zA-Z0-9\s]/.test(s);
  const isSingleKana = (s: string) => s.length === 1 && (particles.has(s) || /[ぁ-ん]/.test(s));

  // Count how many times each word appears (for frequencyInContent)
  const baseFormCounts = new Map<string, number>();
  const validWords = new Map<string, string>(); // Map surface form to baseForm for lookup

  for (const token of tokens) {
    const surface = token.surface;
    if (surface.trim() === '' || isPunctuation(surface) || isSingleKana(surface)) continue;

    if (!isSingleKana(surface)) {
      validWords.set(surface, token.baseForm);
      baseFormCounts.set(surface, (baseFormCounts.get(surface) ?? 0) + 1);
    }
  }

  let cacheHits = 0;
  let cacheMisses = 0;
  const results = [];
  for (const [wordStr, baseForm] of validWords) {
    const start = Date.now();
    // Try to look up using baseForm first (for conjugated verbs), then fall back to wordStr
    const cacheHadBase = wordsCache.has(baseForm);
    const cacheHadSurface = wordsCache.has(wordStr);
    let entries = cacheHadBase ? wordsCache.get(baseForm)! : getCachedDictionaryEntries(baseForm);

    // If baseForm lookup failed, try the surface form
    if (entries.length === 0 && baseForm !== wordStr) {
      entries = cacheHadSurface ? wordsCache.get(wordStr)! : getCachedDictionaryEntries(wordStr);
    }

    const lookupTime = Date.now() - start;

    if (cacheHadBase || cacheHadSurface) cacheHits++;
    else cacheMisses++;

    if (lookupTime > 250) {
      console.log(`[API] Slow lookup: "${wordStr}" took ${lookupTime}ms`);
    }

    const { variant, entry } = findBestVariant(baseForm, entries);

    let meaning = "Unknown meaning";
    let meanings: string[] | undefined = undefined;
    let reading = wordStr;

    if (entry && variant) {
      reading = variant.pronounced || wordStr;
      meaning = entry.meanings[0]?.glosses?.join(", ") || meaning;
    }

    // Use dictionary (Jisho API or jmdict) for pure hiragana or katakana words
    // These are particles, auxiliaries, and other kana-only words where kanji-data is unreliable
    const isPureHiragana = /^[ぁ-ん]+$/.test(wordStr);
    const isPureKatakana = /^[ァ-ヴー]+$/.test(wordStr);
    const isKanaOnly = isPureHiragana || isPureKatakana;

    if (isKanaOnly && dictionary) {
      // Use pre-looked-up cache if available (from batch concurrent lookup)
      const dictResult = kanaLookupCache?.get(wordStr) ?? await dictionary.lookup(wordStr);
      if (dictResult) {
        meaning = dictResult.meaning;
        if (dictResult.meanings) {
          meanings = dictResult.meanings;
        }
      }
    }

    // Fallback for pure hiragana particles if still no result from dictionary
    if (meaning === "Unknown meaning" && isPureHiragana) {
      meaning = "Kana particle / expression";
    }

    const { jlpt, joyo, score, breakdown } = getWordScoreBreakdown(wordStr, variant);
    const frequencyInContent = baseFormCounts.get(wordStr) ?? 1;
    const wordData: any = { word: wordStr, reading, meaning, jlpt, joyo, score, breakdown, frequencyInContent };
    if (meanings) {
      wordData.meanings = meanings;
    }
    results.push(wordData);
  }

  console.log(`[API] Cache stats: ${cacheHits} hits, ${cacheMisses} misses (${Math.round(cacheHits / (cacheHits + cacheMisses) * 100)}% hit rate)`);

  return results;
}

async function processTextWithTokens(text: string, tokens: any[], kanaLookupCache: Map<string, any>) {
  const particles = new Set(["は", "が", "を", "に", "へ", "と", "で", "も", "か", "の", "て", "な", "だ"]);
  const isPunctuation = (s: string) => /[、。！？・「」『』（）()[\]a-zA-Z0-9\s]/.test(s);
  const isSingleKana = (s: string) => s.length === 1 && (particles.has(s) || /[ぁ-ん]/.test(s));

  // Count how many times each word appears (for frequencyInContent)
  const baseFormCounts = new Map<string, number>();
  const validWords = new Map<string, string>(); // Map surface form to baseForm for lookup

  for (const token of tokens) {
    const surface = token.surface;
    if (surface.trim() === '' || isPunctuation(surface) || isSingleKana(surface)) continue;

    if (!isSingleKana(surface)) {
      validWords.set(surface, token.baseForm);
      baseFormCounts.set(surface, (baseFormCounts.get(surface) ?? 0) + 1);
    }
  }

  let cacheHits = 0;
  let cacheMisses = 0;
  const results = [];
  for (const [wordStr, baseForm] of validWords) {
    const start = Date.now();
    // Try to look up using baseForm first (for conjugated verbs), then fall back to wordStr
    const cacheHadBase = wordsCache.has(baseForm);
    const cacheHadSurface = wordsCache.has(wordStr);
    let entries = cacheHadBase ? wordsCache.get(baseForm)! : getCachedDictionaryEntries(baseForm);

    // If baseForm lookup failed, try the surface form
    if (entries.length === 0 && baseForm !== wordStr) {
      entries = cacheHadSurface ? wordsCache.get(wordStr)! : getCachedDictionaryEntries(wordStr);
    }

    const lookupTime = Date.now() - start;

    if (cacheHadBase || cacheHadSurface) cacheHits++;
    else cacheMisses++;

    if (lookupTime > 250) {
      console.log(`[API] Slow lookup: "${wordStr}" took ${lookupTime}ms`);
    }

    const { variant, entry } = findBestVariant(baseForm, entries);

    let meaning = "Unknown meaning";
    let meanings: string[] | undefined = undefined;
    let reading = wordStr;

    if (entry && variant) {
      reading = variant.pronounced || wordStr;
      meaning = entry.meanings[0]?.glosses?.join(", ") || meaning;
    }

    // Use dictionary (Jisho API or jmdict) for pure hiragana or katakana words
    const isPureHiragana = /^[ぁ-ん]+$/.test(wordStr);
    const isPureKatakana = /^[ァ-ヴー]+$/.test(wordStr);
    const isKanaOnly = isPureHiragana || isPureKatakana;

    if (isKanaOnly) {
      // Use pre-looked-up cache (all kana words looked up concurrently before)
      const dictResult = kanaLookupCache.get(wordStr);
      if (dictResult) {
        meaning = dictResult.meaning;
        if (dictResult.meanings) {
          meanings = dictResult.meanings;
        }
      }
    }

    // Fallback for pure hiragana particles if still no result from dictionary
    if (meaning === "Unknown meaning" && isPureHiragana) {
      meaning = "Kana particle / expression";
    }

    const { jlpt, joyo, score, breakdown } = getWordScoreBreakdown(wordStr, variant);
    const frequencyInContent = baseFormCounts.get(wordStr) ?? 1;
    const wordData: any = { word: wordStr, reading, meaning, jlpt, joyo, score, breakdown, frequencyInContent };
    if (meanings) {
      wordData.meanings = meanings;
    }
    results.push(wordData);
  }

  console.log(`[API] Cache stats: ${cacheHits} hits, ${cacheMisses} misses (${Math.round(cacheHits / (cacheHits + cacheMisses) * 100)}% hit rate)`);

  return results;
}

async function processStoryText(text: string) {
  if (!tokenizer) throw new Error("Tokenizer not ready");
  const tokenInfos = await tokenizer.segment(text);

  const particles = new Set(["は", "が", "を", "に", "へ", "と", "で", "も", "か", "の", "て", "な", "だ"]);
  const isPunctuation = (s: string) => /[、。！？・「」『』（）()[\]a-zA-Z0-9\s]/.test(s);
  const isSingleKana = (s: string) => s.length === 1 && (particles.has(s) || /[ぁ-ん]/.test(s));

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

    const isVocabWord = !(surface.trim() === '' || isPunctuation(surface) || isSingleKana(surface));

    tokens.push({
      surface: surface,
      baseForm: tokenInfo.baseForm,
      startIndex: segmentIndex,
      endIndex: segmentIndex + surface.length,
      isVocabWord,
    });

    searchStart = segmentIndex + surface.length;
  }

  // Look up vocab words
  const vocabTokens = tokens.filter(t => t.isVocabWord);
  const tokenMap = new Map<string, any>();

  for (const token of vocabTokens) {
    if (tokenMap.has(token.surface)) continue;

    // Try baseForm first for dictionary lookup
    let entries = getCachedDictionaryEntries(token.baseForm);
    if (entries.length === 0 && token.baseForm !== token.surface) {
      entries = getCachedDictionaryEntries(token.surface);
    }
    const { variant, entry } = findBestVariant(token.baseForm, entries);

    let meaning = "Unknown meaning";
    let meanings: string[] | undefined = undefined;
    let reading = token.surface;

    if (entry && variant) {
      reading = variant.pronounced || token.surface;
      meaning = entry.meanings[0]?.glosses?.join(", ") || meaning;
    }

    const isPureHiragana = /^[ぁ-ん]+$/.test(token.surface);
    if (isPureHiragana && dictionary) {
      const dictResult = await dictionary.lookup(token.surface);
      if (dictResult) {
        meaning = dictResult.meaning;
        if (dictResult.meanings) {
          meanings = dictResult.meanings;
        }
      }
    }

    if (meaning === "Unknown meaning" && isPureHiragana) {
      meaning = "Kana particle / expression";
    }

    const { jlpt, joyo, score, breakdown } = getWordScoreBreakdown(token.surface, variant);

    tokenMap.set(token.surface, {
      word: token.surface,
      reading,
      meaning,
      jlpt,
      joyo,
      score,
      breakdown,
      meanings,
    });
  }

  // Enrich tokens with word info
  const enrichedTokens = tokens.map(token => {
    if (token.isVocabWord && tokenMap.has(token.surface)) {
      return {
        ...token,
        wordInfo: tokenMap.get(token.surface),
      };
    }
    return token;
  });

  return enrichedTokens;
}

async function startServer() {
  // Wait for tokenizer and dictionary to be ready before starting server
  await tokenizerReady;
  await dictionaryReady;

  // Load persisted cache from disk
  loadCacheFromDisk();

  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // Periodically save caches to disk (every 30 seconds if changed)
  setInterval(() => {
    saveCacheToDisk();
    saveJishoCacheToDisk();
  }, 30000);

  app.use((req, _res, next) => {
    console.log(`[Server] ${req.method} ${req.path}`);
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
    const { texts } = req.body;
    if (!Array.isArray(texts)) {
      return res.status(400).json({ error: "texts must be an array" });
    }

    const batchStart = Date.now();
    console.log(`[API] /api/batch-extract: Processing ${texts.length} items (cache: ${wordsCache.size} words)`);

    // Sort by text length (shorter first) for faster initial cache warmup
    const sortedTexts = [...texts].sort((a, b) => (a.text?.length ?? 0) - (b.text?.length ?? 0));

    // Tokenize all texts concurrently upfront
    const tokenStart = Date.now();
    const tokenizedBatch = await Promise.all(
      sortedTexts.map(async (item: any) => {
        if (!item.text || typeof item.text !== "string") return { ...item, tokens: null };
        try {
          const tokens = await tokenizer!.segment(item.text);
          return { ...item, tokens };
        } catch (e) {
          return { ...item, tokens: null };
        }
      })
    );
    const tokenTime = Date.now() - tokenStart;
    console.log(`[API] /api/batch-extract: Tokenization complete (${tokenTime}ms)`);

    // Collect unique kana-only words from all texts
    const particles = new Set(["は", "が", "を", "に", "へ", "と", "で", "も", "か", "の", "て", "な", "だ"]);
    const isPunctuation = (s: string) => /[、。！？・「」『』（）()[\]a-zA-Z0-9\s]/.test(s);
    const isSingleKana = (s: string) => s.length === 1 && (particles.has(s) || /[ぁ-ん]/.test(s));

    const uniqueKanaWords = new Set<string>();
    for (const item of tokenizedBatch) {
      if (!item.tokens) continue;
      for (const token of item.tokens) {
        const surface = token.surface;
        if (surface.trim() === '' || isPunctuation(surface) || isSingleKana(surface)) continue;

        const isPureHiragana = /^[ぁ-ん]+$/.test(surface);
        const isPureKatakana = /^[ァ-ヴー]+$/.test(surface);
        if (isPureHiragana || isPureKatakana) {
          uniqueKanaWords.add(surface);
        }
      }
    }

    // Look up all kana words concurrently
    const lookupStart = Date.now();
    console.log(`[API] /api/batch-extract: Looking up ${uniqueKanaWords.size} unique kana words concurrently`);
    const kanaLookupCache = new Map<string, any>();
    if (dictionary && uniqueKanaWords.size > 0) {
      const lookupPromises = Array.from(uniqueKanaWords).map(async (word) => {
        try {
          const result = await dictionary.lookup(word);
          return { word, result };
        } catch (e) {
          return { word, result: null };
        }
      });
      const lookupResults = await Promise.all(lookupPromises);
      for (const { word, result } of lookupResults) {
        kanaLookupCache.set(word, result);
      }
    }
    const lookupTime = Date.now() - lookupStart;
    const foundCount = Array.from(kanaLookupCache.values()).filter(v => v !== null).length;
    console.log(`[API] /api/batch-extract: Kana lookup complete (${lookupTime}ms, ${foundCount}/${uniqueKanaWords.size} found)`);

    // Process texts with pre-looked-up kana cache
    const processStart = Date.now();
    const results = await Promise.all(
      tokenizedBatch.map(async (item: any) => {
        const { id, text, tokens } = item;
        if (!text || typeof text !== "string") return { id, error: "No text" };
        if (!tokens) return { id, error: "Tokenization failed" };

        const start = Date.now();
        try {
          // Re-inject tokens to avoid re-tokenizing
          const words = await processTextWithTokens(text, tokens, kanaLookupCache);
          const elapsed = Date.now() - start;
          console.log(`[API] batch-extract[${id}]: ${words.length} words in ${elapsed}ms`);
          return { id, words, elapsed };
        } catch (e: any) {
          console.error(`[API] batch-extract[${id}]: Error:`, e.message);
          return { id, error: e.message };
        }
      })
    );
    const processTime = Date.now() - processStart;
    const totalTime = Date.now() - batchStart;

    console.log(`[API] /api/batch-extract: Text processing complete (${processTime}ms)`);
    console.log(`[API] /api/batch-extract: Complete - cache now has ${wordsCache.size} words (total: ${totalTime}ms)`);
    res.json(results);
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

  app.post("/api/update-words", (req, res) => {
    const start = Date.now();
    try {
      const { words } = req.body;
      if (!Array.isArray(words)) {
        return res.status(400).json({ error: "Invalid words array" });
      }

      console.log(`[API] /api/update-words: scoring ${words.length} words`);
      const results = words.map((w: Record<string, unknown>) => {
        const wordStr = w.word as string | undefined;
        if (!wordStr) return w;

        const entries = getCachedDictionaryEntries(wordStr);
        const { variant } = findBestVariant(wordStr, entries);
        const calculated = getWordScoreBreakdown(wordStr, variant);

        return {
          ...w,
          score: w.score ?? calculated.score,
          breakdown: w.breakdown ?? calculated.breakdown,
          jlpt: w.jlpt ?? calculated.jlpt,
          joyo: w.joyo ?? calculated.joyo,
        };
      });

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

  app.post("/api/clear-cache", (req, res) => {
    const wordCacheSize = wordsCache.size;
    const jishoCacheSize = jishoCache.size;

    wordsCache.clear();
    jishoCache.clear();
    jishoCacheNeedsSave = true;
    markCacheAsDirty();

    console.log(`[API] /api/clear-cache: Cleared ${wordCacheSize} words and ${jishoCacheSize} Jisho entries`);

    // Delete cache files
    try {
      if (fs.existsSync(CACHE_FILE)) {
        fs.unlinkSync(CACHE_FILE);
      }
      if (fs.existsSync(JISHO_CACHE_FILE)) {
        fs.unlinkSync(JISHO_CACHE_FILE);
      }
      console.log(`[API] /api/clear-cache: Deleted cache files`);
    } catch (e) {
      console.error('[API] /api/clear-cache: Error deleting files:', (e as any).message);
    }

    res.json({
      cleared: true,
      message: `Cleared ${wordCacheSize} words and ${jishoCacheSize} Jisho entries`
    });
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

      const entries = getCachedDictionaryEntries(word);
      const { variant, entry } = findBestVariant(word, entries);

      let reading = word;
      let meaning = "Unknown meaning";
      let meanings: string[] | undefined = undefined;

      if (entry && variant) {
        reading = variant.pronounced || word;
        if (entry.meanings && entry.meanings.length > 0) {
          meaning = entry.meanings[0].glosses?.join(", ") || meaning;
          // Collect all unique meanings
          const allMeanings = new Set<string>();
          for (const m of entry.meanings) {
            if (m.glosses) {
              for (const gloss of m.glosses) {
                allMeanings.add(gloss);
              }
            }
          }
          meanings = Array.from(allMeanings);
        }
      }

      const { jlpt, joyo, score, breakdown } = getWordScoreBreakdown(word, variant);

      const wordData: any = {
        word,
        reading,
        meaning,
        jlpt,
        joyo,
        score,
        breakdown,
        entry
      };

      if (meanings) {
        wordData.meanings = meanings;
      }

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

  // Save caches on shutdown
  process.on('SIGINT', () => {
    console.log('\n[Server] Shutting down, saving caches...');
    saveCacheToDisk();
    saveJishoCacheToDisk();
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    console.log('[Server] Terminating, saving caches...');
    saveCacheToDisk();
    saveJishoCacheToDisk();
    process.exit(0);
  });
}

startServer();
