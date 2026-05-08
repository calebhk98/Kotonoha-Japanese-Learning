import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import * as tar from "tar";
import zlib from "zlib";
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
  markCacheAsDirty,
  shouldSaveCache,
  clearCacheDirtyFlag,
} from "./src/lib/scoring.js";
import { DictionaryManager } from "./src/lib/dictionary.js";
import { createTokenizer, Tokenizer } from "./src/lib/tokenizers.js";
import { ensureJmnedictPrepared } from "./src/lib/jmnedict-utils.js";
import { getMorphemeDefinition } from "./src/lib/morphemeDefinitions.js";
import { loadStoriesFromDisk, loadMusicFromDisk, loadVideosFromDisk } from "./src/lib/storyLoader.js";
import { initDatabase, WordsCache, JishoCache, saveDatabase } from "./src/lib/database.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let wordsCache: WordsCache;
let jishoCache: JishoCache;

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

  dictionary = new DictionaryManager();
  const jmdictPath = path.join(__dirname, 'jmdict-db');
  const jmdictFile = path.join(__dirname, 'jmdict-all-3.6.2.json');
  const jmdictExists = fs.existsSync(jmdictFile);

  const onJishoCacheUpdate = (cache: Map<string, any>) => {
    // Sync updated cache entries from dictionary
    for (const [key, value] of cache.entries()) {
      if (!jishoCache.has(key)) {
        jishoCache.set(key, value);
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
            jishoCache.set(word, result);
          }
        }
        const elapsed = Date.now() - cacheStart;
        console.log(`[Cache] Jisho cache: loaded ${Object.keys(data).length} entries in ${elapsed}ms`);
      } catch (e: any) {
        console.warn('[Cache] Failed to load Jisho cache:', e.message);
      }
    }

    // Load word cache from compressed file using streaming JSON parser
    // Decompress first, then stream the JSON
    const wordCacheGzFile = path.join(__dirname, '.word-cache.json.gz');
    if (fs.existsSync(wordCacheGzFile)) {
      const { Readable } = await import('stream');

      const loadCompressedCache = async () => {
        try {
          const cacheStart = Date.now();
          console.log('[Cache] Word cache: starting decompression...');

          // Decompress the file
          const { promisify } = await import('util');
          const gunzip = promisify(zlib.gunzip);
          const compressed = fs.readFileSync(wordCacheGzFile);
          const decompressedStart = Date.now();
          const decompressed = await gunzip(compressed);
          const decompressedStr = decompressed.toString('utf-8');
          const decompressedTime = Date.now() - decompressedStart;
          console.log(`[Cache] Word cache: decompressed in ${decompressedTime}ms`);

          // Parse JSON object manually to avoid loading entire structure into memory
          // Split on key-value boundaries to process one entry at a time
          let loadedCount = 0;
          let skippedCount = 0;
          let pos = 0;

          // Skip opening brace
          while (pos < decompressedStr.length && decompressedStr[pos] !== '{') pos++;
          pos++;

          while (pos < decompressedStr.length) {
            // Skip whitespace and commas
            let foundClosingBrace = false;
            while (pos < decompressedStr.length && /[\s,}]/.test(decompressedStr[pos])) {
              if (decompressedStr[pos] === '}') {
                // End of object
                foundClosingBrace = true;
                break;
              }
              pos++;
            }

            if (foundClosingBrace) {
              const elapsed = Date.now() - cacheStart;
              console.log(`[Cache] Word cache: loaded ${loadedCount} entries, skipped ${skippedCount} corrupted entries in ${elapsed}ms`);
              return;
            }

            // Parse key: find quoted string
            if (decompressedStr[pos] !== '"') {
              // If we don't find a quote, we're in an unexpected position - try to recover
              // Skip to next quote or closing brace
              while (pos < decompressedStr.length && decompressedStr[pos] !== '"' && decompressedStr[pos] !== '}') {
                pos++;
              }
              if (pos >= decompressedStr.length || decompressedStr[pos] === '}') break;
            }

            let keyStart = pos + 1;
            let keyEnd = keyStart;
            while (keyEnd < decompressedStr.length && decompressedStr[keyEnd] !== '"') {
              if (decompressedStr[keyEnd] === '\\') keyEnd++;
              keyEnd++;
            }
            const key = decompressedStr.slice(keyStart, keyEnd);
            pos = keyEnd + 1;

            // Skip to colon
            while (pos < decompressedStr.length && decompressedStr[pos] !== ':') pos++;
            pos++;

            // Parse value: find the complete JSON value
            let depth = 0;
            let inString = false;
            let valueStart = pos;

            while (pos < decompressedStr.length) {
              const char = decompressedStr[pos];

              if (char === '\\' && inString) {
                pos += 2;
                continue;
              }

              if (char === '"') {
                inString = !inString;
              } else if (!inString) {
                if (char === '{' || char === '[') depth++;
                else if (char === '}' || char === ']') depth--;
                else if ((char === ',' || char === '}') && depth === 0) {
                  // End of this value
                  break;
                }
              }
              pos++;
            }

            const valueStr = decompressedStr.slice(valueStart, pos).trim();

            try {
              const value = JSON.parse(valueStr);
              if (!wordsCache.has(key)) {
                wordsCache.set(key, value);
                loadedCount++;
              }
            } catch (e) {
              skippedCount++;
              console.warn(`[Cache] Skipping corrupted entry for "${key}": ${e instanceof Error ? e.message : String(e)}`);

              // If JSON parse failed, try to recover by finding the next comma or closing brace
              // This helps skip malformed entries and continue parsing
              if (pos < decompressedStr.length && decompressedStr[pos] !== ',' && decompressedStr[pos] !== '}') {
                let recoveryPos = pos;
                let recoveryDepth = 0;
                let recoveryInString = false;

                while (recoveryPos < decompressedStr.length) {
                  const char = decompressedStr[recoveryPos];

                  if (char === '\\' && recoveryInString) {
                    recoveryPos += 2;
                    continue;
                  }

                  if (char === '"') {
                    recoveryInString = !recoveryInString;
                  } else if (!recoveryInString) {
                    if (char === '{' || char === '[') recoveryDepth++;
                    else if (char === '}' || char === ']') {
                      recoveryDepth--;
                      if (recoveryDepth < 0) {
                        // Found end of object
                        pos = recoveryPos;
                        break;
                      }
                    } else if (char === ',' && recoveryDepth === 0) {
                      // Found next entry
                      pos = recoveryPos;
                      break;
                    }
                  }
                  recoveryPos++;
                }
              }
            }
          }

          const elapsed = Date.now() - cacheStart;
          console.log(`[Cache] Word cache: loaded ${loadedCount} entries, skipped ${skippedCount} corrupted entries in ${elapsed}ms`);
        } catch (e: any) {
          console.warn('[Cache] Failed to load word cache:', e.message);
        }
      };

      // Start loading asynchronously (don't await - runs in background)
      loadCompressedCache().catch(e => console.error('[Cache] Background loading error:', e));
    }
  };

  // Load caches in background so server isn't blocked
  loadCachesInBackground().catch(e => console.error('[Cache] Background loading error:', e));
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
  const morphemes = new Map<string, number>(); // Track morpheme frequencies

  for (const token of tokens) {
    const surface = token.surface;
    if (surface.trim() === '' || isPunctuation(surface)) continue;

    if (isSingleKana(surface)) {
      // Check if it's a morpheme we have a definition for
      const morphemeDef = getMorphemeDefinition(surface);
      if (morphemeDef) {
        morphemes.set(surface, (morphemes.get(surface) ?? 0) + 1);
      }
    } else {
      validWords.set(surface, token.baseForm);
      baseFormCounts.set(surface, (baseFormCounts.get(surface) ?? 0) + 1);
    }
  }

  let cacheHits = 0;
  let cacheMisses = 0;
  const hitWords: string[] = [];
  const missWords: string[] = [];
  const results = [];
  const processedWords: string[] = [];
  for (const [wordStr, baseForm] of validWords) {
    processedWords.push(wordStr);
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

    if (cacheHadBase || cacheHadSurface) {
      cacheHits++;
      hitWords.push(wordStr);
    } else {
      cacheMisses++;
      missWords.push(wordStr);
    }

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
      // Try persistent cache first, then batch cache, then dictionary lookup
      const cachedEntries = wordsCache.get(wordStr);
      let dictResult: any = null;

      if (cachedEntries && cachedEntries.length > 0) {
        // Use cached entry
        const entry = cachedEntries[0];
        if (entry.meanings && entry.meanings.length > 0) {
          dictResult = {
            meaning: entry.meanings[0]?.glosses?.join(", ") || "Unknown",
            reading: entry.variants?.[0]?.pronounced || wordStr,
            meanings: entry.meanings.map((m: any) => m.glosses?.join(", ")).filter((m: any) => m)
          };
        }
      } else {
        // Try batch cache first, then dictionary lookup
        dictResult = kanaLookupCache?.get(wordStr);
        if (!dictResult) {
          dictResult = await dictionary.lookup(wordStr);
          // Save to batch cache for reuse within this request
          if (dictResult) {
            kanaLookupCache?.set(wordStr, dictResult);
          }
        }

        // Save dictionary result to persistent cache for future requests
        if (dictResult) {
          const entry: DictionaryEntry = {
            meanings: (dictResult.meanings || [dictResult.meaning])
              .filter(Boolean)
              .map((m: string) => ({ glosses: [m] })),
            variants: [{
              pronounced: dictResult.reading || wordStr,
              written: wordStr,
              priorities: []
            }]
          };
          wordsCache.set(wordStr, [entry]);
        }
      }

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

  // Add morpheme definitions
  for (const [morpheme, frequency] of morphemes) {
    const meaning = getMorphemeDefinition(morpheme) || "Grammatical morpheme";
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

  const hitRate = cacheHits + cacheMisses > 0 ? Math.round(cacheHits / (cacheHits + cacheMisses) * 100) : 100;
  console.log(`[API] Cache stats: ${cacheHits} hits, ${cacheMisses} misses (${hitRate}% hit rate) | Words (${processedWords.length}): hits=[${hitWords.join(', ')}], misses=[${missWords.join(', ')}]`);

  return results;
}

async function processTextWithTokens(text: string, tokens: any[], kanaLookupCache: Map<string, any>) {
  const particles = new Set(["は", "が", "を", "に", "へ", "と", "で", "も", "か", "の", "て", "な", "だ"]);
  const isPunctuation = (s: string) => /[、。！？・「」『』（）()[\]a-zA-Z0-9\s]/.test(s);
  const isSingleKana = (s: string) => s.length === 1 && (particles.has(s) || /[ぁ-ん]/.test(s));

  // Count how many times each word appears (for frequencyInContent)
  const baseFormCounts = new Map<string, number>();
  const validWords = new Map<string, string>(); // Map surface form to baseForm for lookup
  const morphemes = new Map<string, number>(); // Track morpheme frequencies

  for (const token of tokens) {
    const surface = token.surface;
    if (surface.trim() === '' || isPunctuation(surface)) continue;

    if (isSingleKana(surface)) {
      // Check if it's a morpheme we have a definition for
      const morphemeDef = getMorphemeDefinition(surface);
      if (morphemeDef) {
        morphemes.set(surface, (morphemes.get(surface) ?? 0) + 1);
      }
    } else {
      validWords.set(surface, token.baseForm);
      baseFormCounts.set(surface, (baseFormCounts.get(surface) ?? 0) + 1);
    }
  }

  let cacheHits = 0;
  let cacheMisses = 0;
  const hitWords: string[] = [];
  const missWords: string[] = [];
  const results = [];
  const processedWords: string[] = [];
  for (const [wordStr, baseForm] of validWords) {
    processedWords.push(wordStr);
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

    if (cacheHadBase || cacheHadSurface) {
      cacheHits++;
      hitWords.push(wordStr);
    } else {
      cacheMisses++;
      missWords.push(wordStr);
    }

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
      // Try persistent cache first, then batch cache
      const cachedEntries = wordsCache.get(wordStr);
      let dictResult: any = null;

      if (cachedEntries && cachedEntries.length > 0) {
        // Use cached entry
        const entry = cachedEntries[0];
        if (entry.meanings && entry.meanings.length > 0) {
          dictResult = {
            meaning: entry.meanings[0]?.glosses?.join(", ") || "Unknown",
            reading: entry.variants?.[0]?.pronounced || wordStr,
            meanings: entry.meanings.map((m: any) => m.glosses?.join(", ")).filter((m: any) => m)
          };
        }
      } else {
        // Fall back to batch cache
        dictResult = kanaLookupCache.get(wordStr);
      }

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

  // Add morpheme definitions
  for (const [morpheme, frequency] of morphemes) {
    const meaning = getMorphemeDefinition(morpheme) || "Grammatical morpheme";
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

  const hitRate = cacheHits + cacheMisses > 0 ? Math.round(cacheHits / (cacheHits + cacheMisses) * 100) : 100;
  console.log(`[API] Cache stats: ${cacheHits} hits, ${cacheMisses} misses (${hitRate}% hit rate) | Words (${processedWords.length}): hits=[${hitWords.join(', ')}], misses=[${missWords.join(', ')}]`);

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

    const isMorpheme = isSingleKana(surface) && getMorphemeDefinition(surface) !== undefined;
    const isVocabWord = !(surface.trim() === '' || isPunctuation(surface) || isSingleKana(surface));

    tokens.push({
      surface: surface,
      baseForm: tokenInfo.baseForm,
      startIndex: segmentIndex,
      endIndex: segmentIndex + surface.length,
      isVocabWord,
      isMorpheme,
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
      // Try persistent cache first, then dictionary lookup
      const cachedEntries = wordsCache.get(token.surface);
      let dictResult: any = null;

      if (cachedEntries && cachedEntries.length > 0) {
        // Use cached entry
        const entry = cachedEntries[0];
        if (entry.meanings && entry.meanings.length > 0) {
          dictResult = {
            meaning: entry.meanings[0]?.glosses?.join(", ") || "Unknown",
            reading: entry.variants?.[0]?.pronounced || token.surface,
            meanings: entry.meanings.map((m: any) => m.glosses?.join(", ")).filter((m: any) => m)
          };
        }
      } else {
        // Fall back to dictionary lookup
        dictResult = await dictionary.lookup(token.surface);
      }

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

  // Add morpheme definitions to tokenMap
  const morphemeTokens = tokens.filter(t => t.isMorpheme);
  for (const token of morphemeTokens) {
    if (!tokenMap.has(token.surface)) {
      const meaning = getMorphemeDefinition(token.surface) || "Grammatical morpheme";
      tokenMap.set(token.surface, {
        word: token.surface,
        reading: token.surface,
        meaning,
        jlpt: 0,
        joyo: false,
        score: 0,
        breakdown: { jlptScore: 0, joyoPenalty: 0, highestGrade: null, freqPenalty: 0, jlptValues: [], gradeValues: [], priorities: [] },
        isMorpheme: true
      });
    }
  }

  // Enrich tokens with word info
  const enrichedTokens = tokens.map(token => {
    if ((token.isVocabWord || token.isMorpheme) && tokenMap.has(token.surface)) {
      return {
        ...token,
        isVocabWord: token.isVocabWord || token.isMorpheme,
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

  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: '50mb' }));

  // Periodically save database to disk (every 30 seconds)
  setInterval(() => {
    saveDatabase();
  }, 30000);

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
    const batchStart = Date.now();
    try {
      const { texts } = req.body;
      if (!Array.isArray(texts)) {
        return res.status(400).json({ error: "texts must be an array" });
      }

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
            console.error(`[API] Tokenization error for item ${item.id}:`, e instanceof Error ? e.message : String(e));
            return { ...item, tokens: null };
          }
        })
      );
      const tokenTime = Date.now() - tokenStart;
      console.log(`[API] /api/batch-extract: Step 1 - Tokenization completed in ${tokenTime}ms`);

      // Collect unique kana-only words from all texts
      const particles = new Set(["は", "が", "を", "に", "へ", "と", "で", "も", "か", "の", "て", "な", "だ"]);
      const isPunctuation = (s: string) => /[、。！？・「」『』（）()[\]a-zA-Z0-9\s]/.test(s);
      const isSingleKana = (s: string) => s.length === 1 && (particles.has(s) || /[ぁ-ん]/.test(s));

      const collectStart = Date.now();
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
      const collectTime = Date.now() - collectStart;
      console.log(`[API] /api/batch-extract: Step 2 - Found ${uniqueKanaWords.size} unique kana words in ${collectTime}ms`);

      // Look up kana words via API with concurrency limit (KanjiData has wrong defs for pure kana)
      const lookupStart = Date.now();
      const kanaLookupCache = new Map<string, any>();
      if (dictionary && uniqueKanaWords.size > 0) {
        const words = Array.from(uniqueKanaWords);
        const concurrencyLimit = 5;
        const results: { word: string; result: any }[] = [];

        let activeCount = 0;
        let index = 0;

        await new Promise<void>((resolve, reject) => {
          const processNext = async () => {
            try {
              if (index >= words.length && activeCount === 0) {
                resolve();
                return;
              }

              if (activeCount < concurrencyLimit && index < words.length) {
                const word = words[index++];
                activeCount++;

                try {
                  const result = await dictionary!.lookup(word);
                  results.push({ word, result });
                } catch (e) {
                  console.error(`[API] Kana lookup error for "${word}":`, e instanceof Error ? e.message : String(e));
                  results.push({ word, result: null });
                } finally {
                  activeCount--;
                  await processNext();
                }
              } else if (index < words.length) {
                // Wait a bit before retrying
                setTimeout(() => processNext().catch(reject), 10);
              }
            } catch (err) {
              reject(err);
            }
          };

          for (let i = 0; i < concurrencyLimit; i++) {
            processNext().catch(reject);
          }
        });

        for (const { word, result } of results) {
          kanaLookupCache.set(word, result);
          // Save kana lookups to persistent cache so they don't need API calls again
          if (result) {
            wordsCache.set(word, [{
              meanings: [{ glosses: [result.meaning || 'Unknown'] }],
              variants: [{ pronounced: result.reading || word, written: word }]
            } as any]);
          }
        }
      }
      const lookupTime = Date.now() - lookupStart;
      const foundCount = Array.from(kanaLookupCache.values()).filter(v => v !== null).length;
      console.log(`[API] /api/batch-extract: Step 3 - Kana lookup completed in ${lookupTime}ms (${foundCount}/${uniqueKanaWords.size} found)`);

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
            console.error(`[API] batch-extract[${id}]: Error:`, e instanceof Error ? e.message : String(e));
            return { id, error: e instanceof Error ? e.message : String(e) };
          }
        })
      );
      const processTime = Date.now() - processStart;
      const totalTime = Date.now() - batchStart;

      console.log(`[API] /api/batch-extract: Step 4 - Text processing completed in ${processTime}ms`);
      console.log(`[API] /api/batch-extract: Complete - cache now has ${wordsCache.size} words (total: ${totalTime}ms)`);
      res.json(results);
    } catch (err: any) {
      const elapsed = Date.now() - batchStart;
      console.error(`[API] batch-extract failed after ${elapsed}ms:`, err instanceof Error ? err.message : String(err));
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
    saveDatabase();

    console.log(`[API] /api/clear-cache: Cleared ${wordCacheSize} words and ${jishoCacheSize} Jisho entries`);

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

  // Keep server alive even if parent process tries to shut down
  let shutdownRequested = false;
  let shutdownAttempts = 0;

  // Save database on shutdown
  process.on('SIGINT', () => {
    console.log('\n[Server] Shutting down, saving database...');
    saveDatabase();
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    shutdownAttempts++;
    console.log(`[Server] Received SIGTERM (attempt ${shutdownAttempts}), ignoring gracefully...`);

    if (!shutdownRequested) {
      shutdownRequested = true;
      console.log('[Server] Server will continue running. Press Ctrl+C to stop.');
    }
    // Don't exit - server should stay alive
  });

  // Prevent the process from exiting due to empty event loop
  setInterval(() => {
    // Keep-alive interval to prevent process exit
  }, 30000);
}

startServer().catch((err) => {
  console.error('[Server] Fatal error during startup:', err);
  // Don't exit - server should continue even if there's an error
});

// Handle unhandled rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error('[Server] Unhandled Rejection:', {
    reason: reason instanceof Error ? reason.message : String(reason),
    stack: reason instanceof Error ? reason.stack : undefined,
    promise: String(promise)
  });
  // Don't exit - log and continue running
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('[Server] Uncaught Exception:', {
    message: error.message,
    stack: error.stack,
    name: error.name
  });
  // Don't exit - log and continue running
});
