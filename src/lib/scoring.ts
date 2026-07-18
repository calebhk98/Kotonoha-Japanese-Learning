import kanjiData from "kanji-data";
import fs from "fs";
import path from "path";
import { createRequire } from "module";
import { stemJapaneseWord } from "./stemming.js";
import {
  JLPT_SCORES,
  JOYO_PENALTIES,
  JLPT_LABELS,
  JOYO_LABELS,
  FREQUENCY_PENALTY_RULES,
  getFrequencyPenalty,
  type DictionaryVariant,
  type FrequencyPenaltyRule,
} from "./scoringConstants.js";

// Re-exported so every existing import site (server.ts, scoring.test.ts, and
// any other `from './scoring.js'` caller) keeps working unchanged — the
// constants/function now live in scoringConstants.ts (#259 C2 regression
// fix: ScoringView, a CLIENT component, must not import THIS file, since it
// pulls in kanji-data/fs/path and crashes the browser bundle with
// "process is not defined". Import from scoringConstants.ts instead.
export {
  JLPT_SCORES,
  JOYO_PENALTIES,
  JLPT_LABELS,
  JOYO_LABELS,
  FREQUENCY_PENALTY_RULES,
  getFrequencyPenalty,
};
export type { DictionaryVariant, FrequencyPenaltyRule };

// ---------------------------------------------------------------------------
// kanji-data exact-match index.
//
// kanjiData.searchWords() rescans EVERY word shard on EVERY call
// (~200ms-2.3s of synchronous CPU per lookup), which dominated both server
// cold-boots and full-corpus resolution (#252). We only ever use its results
// filtered to exact variant matches, so build a one-time index over the same
// shard files, iterated in the same kanji-meta key order searchWords uses —
// per-key entry order is therefore identical to the old filtered results,
// keeping findBestVariant tie-breaks unchanged.
// ---------------------------------------------------------------------------
let kanjiDataIndex: Map<string, DictionaryEntry[]> | null = null;

function getKanjiDataIndex(): Map<string, DictionaryEntry[]> {
  if (kanjiDataIndex) return kanjiDataIndex;
  const req = createRequire(import.meta.url);
  const moduleRoot = path.dirname(path.dirname(req.resolve("kanji-data")));
  const meta = JSON.parse(
    fs.readFileSync(path.join(moduleRoot, "data", "kanji-meta.json"), "utf8")
  );
  const wordsDir = path.join(moduleRoot, "data", "words");
  const hexPrefix = (c: string) =>
    c.charCodeAt(0).toString(16).padStart(4, "0").substring(0, 2);

  const index = new Map<string, DictionaryEntry[]>();
  const seenPrefixes = new Set<string>();
  for (const kanjiChar of Object.keys(meta)) {
    const prefix = hexPrefix(kanjiChar);
    if (seenPrefixes.has(prefix)) continue;
    seenPrefixes.add(prefix);
    let chunk: Record<string, DictionaryEntry[]>;
    try {
      chunk = JSON.parse(
        fs.readFileSync(path.join(wordsDir, `chunk-${prefix}.json`), "utf8")
      );
    } catch {
      continue; // shard may not exist for rare Unicode ranges
    }
    for (const words of Object.values(chunk)) {
      for (const word of words) {
        const keys = new Set<string>();
        for (const v of (word as any).variants ?? []) {
          if (v.written) keys.add(v.written);
          if (v.pronounced) keys.add(v.pronounced);
        }
        for (const k of keys) {
          let arr = index.get(k);
          if (!arr) index.set(k, (arr = []));
          arr.push(word);
        }
      }
    }
  }
  kanjiDataIndex = index;
  return index;
}

function kanjiDataExact(word: string): DictionaryEntry[] {
  return getKanjiDataIndex().get(word) ?? [];
}

/**
 * Last-ditch partial fallback replacing the old "first 10 raw searchWords
 * results" behavior: entries whose variant text CONTAINS the word, in
 * deterministic shortest-key-first order. Only reached when neither the word
 * nor any of its stems has an exact variant match.
 */
function kanjiDataPartial(word: string): DictionaryEntry[] {
  const index = getKanjiDataIndex();
  const keys: string[] = [];
  for (const k of index.keys()) if (k.includes(word)) keys.push(k);
  keys.sort((a, b) => a.length - b.length || (a < b ? -1 : 1));
  const out: DictionaryEntry[] = [];
  const seen = new Set<DictionaryEntry>();
  for (const k of keys) {
    for (const e of index.get(k)!) {
      if (seen.has(e)) continue;
      seen.add(e);
      out.push(e);
      if (out.length >= 10) return out;
    }
  }
  return out;
}

export interface DictionaryEntry {
  meanings: Array<{ glosses: string[] }>;
  variants: DictionaryVariant[];
}

export interface FindBestVariantResult {
  variant: DictionaryVariant | null;
  entry: DictionaryEntry | null;
  score: number;
}

export function getWordScoreBreakdown(wordStr: string, variant: DictionaryVariant | null) {
  let hardestJlpt = 6;
  let hasKanji = false;
  let allJoyo = true;
  let highestGrade: number | null = null;
  const jlptValues: number[] = [];
  const gradeValues: number[] = [];

  const kanjis = kanjiData.extractKanji(wordStr);

  for (const k of kanjis) {
    hasKanji = true;
    const meta = kanjiData.get(k);
    if (!meta) continue;

    const jlpt = meta.jlpt ?? 0;
    jlptValues.push(jlpt);
    if (jlpt < hardestJlpt) hardestJlpt = jlpt;

    if (meta.grade === null || meta.grade > 8) {
      allJoyo = false;
      highestGrade = 9;
    } else {
      gradeValues.push(meta.grade);
      highestGrade = highestGrade === null ? meta.grade : Math.max(highestGrade, meta.grade);
    }
  }

  const finalJlpt = hasKanji && hardestJlpt !== 6 ? hardestJlpt : (hasKanji ? 0 : 5);
  const jlptScore = JLPT_SCORES[finalJlpt] || 100;
  const joyoPenalty = (hasKanji && highestGrade !== null) ? (JOYO_PENALTIES[highestGrade] || 0) : 0;
  const freqPenalty = getFrequencyPenalty(variant, wordStr);
  const score = Math.min(100, Math.max(1, jlptScore + joyoPenalty + freqPenalty));

  return {
    jlpt: finalJlpt,
    joyo: allJoyo,
    score,
    breakdown: {
      jlptScore,
      joyoPenalty,
      highestGrade,
      freqPenalty,
      jlptValues,
      gradeValues,
      priorities: variant?.priorities || []
    }
  };
}

// Use a Map for fast in-memory access, but also track for persistence
export const wordsCache = new Map<string, DictionaryEntry[]>();
const kanjiCache = new Map<string, string[]>();

// Track if cache has unsaved changes
let cacheNeedsSave = false;

export function markCacheAsDirty() {
  cacheNeedsSave = true;
}

export function shouldSaveCache(): boolean {
  return cacheNeedsSave;
}

export function clearCacheDirtyFlag() {
  cacheNeedsSave = false;
}

// Get dictionary entries for a word by looking up all kanji it contains
function getEntriesByKanjiLookup(wordStr: string): DictionaryEntry[] {
  // Cache kanji extraction to avoid redundant work
  let kanjis: string[];
  if (kanjiCache.has(wordStr)) {
    kanjis = kanjiCache.get(wordStr)!;
  } else {
    kanjis = kanjiData.extractKanji(wordStr);
    kanjiCache.set(wordStr, kanjis);
  }

  const allEntries: DictionaryEntry[] = [];

  // If word has kanji, get entries for each kanji
  if (kanjis.length > 0) {
    for (const k of kanjis) {
      const words = kanjiData.getWords(k);
      allEntries.push(...words);
    }
  }

  return allEntries;
}

/**
 * @internal Use WordResolver.resolve() from server endpoints; this is exposed
 * only for cache-warming optimisations in batch-extract and for WordResolver's
 * own pipeline internals.
 */
export function getCachedDictionaryEntries(wordStr: string): DictionaryEntry[] {
  if (wordsCache.has(wordStr)) return wordsCache.get(wordStr)!;

  // Try the word as-is first (exact variant match via the one-time index)
  let entries = kanjiDataExact(wordStr);

  // If no exact matches found, try stemming for conjugated verbs
  if (entries.length === 0 && wordStr.length > 2) {
    const stems = stemJapaneseWord(wordStr);
    // Try each stem until we find results
    for (const stem of stems.slice(1)) { // Skip the original word (already tried)
      entries = kanjiDataExact(stem);
      if (entries.length > 0) {
        // Found a match with a stem, cache it under the original word
        break;
      }
    }
  }

  // For pure hiragana/katakana words, strongly prefer entries with hiragana-only written form
  // (particles, grammar words) over kanji entries (e.g., prefer に as particle over に as reading of 荷)
  entries = [...entries]; // copy: downstream sort() must not mutate the index arrays
  const isPureKana = /^[ぁ-ん|ァ-ヴー]+$/.test(wordStr);
  if (isPureKana && entries.length > 0) {
    const hiraganaOnly = entries.filter(entry =>
      entry.variants?.some(v => /^[ぁ-ん]+$/.test(v.written))
    );
    if (hiraganaOnly.length > 0) {
      entries = hiraganaOnly;
    }
  }

  // If still no results, fall back to partial matches (variant text containing
  // the word), capped at 10 — replaces the old "first 10 raw searchWords
  // results", which also matched English glosses and shard order.
  if (entries.length === 0) {
    entries = kanjiDataPartial(wordStr);
  }

  // Sort by frequency for better defaults
  // Entries with "ichi1" or "news1" priorities are most common
  entries.sort((a, b) => {
    const aFreq = (a.variants?.[0]?.priorities?.includes('ichi1') ? 2 :
                   a.variants?.[0]?.priorities?.includes('news1') ? 2 :
                   a.variants?.[0]?.priorities?.includes('ichi2') ? 1 :
                   a.variants?.[0]?.priorities?.includes('news2') ? 1 : 0);
    const bFreq = (b.variants?.[0]?.priorities?.includes('ichi1') ? 2 :
                   b.variants?.[0]?.priorities?.includes('news1') ? 2 :
                   b.variants?.[0]?.priorities?.includes('ichi2') ? 1 :
                   b.variants?.[0]?.priorities?.includes('news2') ? 1 : 0);
    return bFreq - aFreq;
  });

  // For pure hiragana input, filter to prefer entries where at least one variant
  // has hiragana in the written form or matches the pronunciation
  if (/^[ぁ-ん]+$/.test(wordStr)) {
    // Move entries with hiragana-containing or pronunciation-matching variants to the front
    const [withHiragana, withoutHiragana] = entries.reduce((acc, entry) => {
      const hasHiraganaVariant = entry.variants?.some(v =>
        /[ぁ-ん]/.test(v.written) || v.pronounced === wordStr
      );
      if (hasHiraganaVariant) {
        acc[0].push(entry);
      } else {
        acc[1].push(entry);
      }
      return acc;
    }, [[], []] as DictionaryEntry[][]);

    entries.splice(0, entries.length, ...withHiragana, ...withoutHiragana);
  }

  wordsCache.set(wordStr, entries);
  markCacheAsDirty();
  return entries;
}

/**
 * @internal Use WordResolver.resolve() from server endpoints; this function is
 * part of WordResolver's private pipeline.
 */
export function findBestVariant(wordStr: string, entries: DictionaryEntry[]): FindBestVariantResult {
  // Track entry positions to prefer earlier entries
  const entryMap = new Map<DictionaryEntry, number>();
  entries.forEach((e, i) => entryMap.set(e, i));

  let best: FindBestVariantResult = { variant: null, entry: null, score: -999 };

  for (const entry of entries) {
    if (!entry.variants) continue;
    for (const v of entry.variants) {
      if (v.written !== wordStr && v.pronounced !== wordStr) continue;

      let score = (v.written === wordStr ? 100 : 0) + (v.priorities?.length ? 50 : 0);
      const isHiragana = /^[ぁ-ん]+$/.test(wordStr);
      const hasKanji = /[一-龯]/.test(v.written);

      if (v.written !== wordStr && isHiragana && hasKanji) {
        score -= v.priorities?.length ? 20 : 200;
      }

      // Strongly prefer entries with common frequency tags (ichi1, news1 = most common)
      if (v.priorities) {
        const hasIchi1 = v.priorities.includes('ichi1');
        const hasNews1 = v.priorities.includes('news1');
        const hasIchi2 = v.priorities.includes('ichi2');
        const hasNews2 = v.priorities.includes('news2');

        if (hasIchi1 || hasNews1) {
          score += 1000; // Very strong preference for most common words
        } else if (hasIchi2 || hasNews2) {
          score += 500; // Strong preference for common words
        }
      }

      // Modest preference for the first entry from searchWords (typically most common sense)
      const entryPos = entryMap.get(entry) ?? 0;
      score += Math.max(0, 50 - entryPos); // Small decreasing bonus for later entries

      if (score > best.score) {
        best = { variant: v, entry, score };
      }
    }
  }

  return best.score >= 0 ? best : { variant: null, entry: null, score: -999 };
}
