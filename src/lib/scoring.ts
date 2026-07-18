import kanjiData from "kanji-data";
import fs from "fs";
import path from "path";
import { createRequire } from "module";
import { stemJapaneseWord } from "./stemming.js";

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

export interface DictionaryVariant {
  written: string;
  pronounced: string;
  priorities?: string[];
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

export const JLPT_SCORES: Record<number, number> = { 5: 15, 4: 30, 3: 50, 2: 70, 1: 90, 0: 100 };
export const JOYO_PENALTIES: Record<number, number> = { 1: 5, 2: 7, 3: 10, 4: 12, 5: 15, 6: 20, 8: 25, 9: 30 };

/**
 * Human-readable labels for JLPT_SCORES keys, keyed the same way (0 = no JLPT
 * kanji / most advanced). Exported so ScoringView (#259 C2) can render the
 * Base JLPT Points table by mapping over JLPT_SCORES instead of re-typing the
 * numbers — the guide diverged from this file (N4 shown as +25 vs the actual
 * 30, N2 +75 vs 70, N1 +100 vs 90) because nothing forced the two to agree.
 */
export const JLPT_LABELS: Record<number, string> = {
  5: 'N5 (Fundamentals)',
  4: 'N4',
  3: 'N3',
  2: 'N2',
  1: 'N1 (Native / Advanced)',
  0: 'No JLPT kanji',
};

/** Human-readable labels for JOYO_PENALTIES keys — same drift-proofing as JLPT_LABELS. */
export const JOYO_LABELS: Record<number, string> = {
  1: 'Grade 1',
  2: 'Grade 2',
  3: 'Grade 3',
  4: 'Grade 4',
  5: 'Grade 5',
  6: 'Grade 6',
  8: 'Grade 8 (Middle School)',
  9: 'Grade 9+ (Non-Joyo)',
};

/**
 * Ordered frequency-penalty rules, single-sourced by both getFrequencyPenalty
 * (below) and ScoringView's "Frequency Penalties" table (#259 C2) so the two
 * can never drift again — the guide previously hardcoded a 9-row table that
 * didn't match this function's actual buckets/penalties.
 *
 * `tags`-based rules are checked in order for a priority-tag match;
 * `nfMax`-based rules are checked in order (ascending) for the first bucket
 * whose ceiling covers the parsed nfNN rank. `fallback: true` marks the rule
 * used when nothing else matched. Order and values are byte-identical to the
 * pre-refactor implementation — see scoring.test.ts for the pinned cases.
 */
export interface FrequencyPenaltyRule {
  id: string;
  label: string;
  detail: string;
  penalty: number;
  tags?: string[];
  nfMax?: number;
  kanaFallback?: boolean;
  fallback?: boolean;
}

export const FREQUENCY_PENALTY_RULES: FrequencyPenaltyRule[] = [
  {
    id: 'kana-no-variant',
    label: 'Common kana word (no dictionary variant)',
    detail: 'pure-kana word with no matched dictionary variant',
    kanaFallback: true,
    penalty: -20,
  },
  {
    id: 'very-common',
    label: 'Very Common',
    detail: 'ichi1, news1, common kana',
    tags: ['ichi1', 'news1'],
    penalty: -20,
  },
  {
    id: 'common',
    label: 'Common',
    detail: 'ichi2, news2',
    tags: ['ichi2', 'news2'],
    penalty: -10,
  },
  {
    id: 'loan-spec-1',
    label: 'Frequent Loan/Spec 1',
    detail: 'gai1, spec1',
    tags: ['gai1', 'spec1'],
    penalty: 0,
  },
  {
    id: 'loan-spec-2',
    label: 'Frequent Loan/Spec 2',
    detail: 'gai2, spec2',
    tags: ['gai2', 'spec2'],
    penalty: 5,
  },
  {
    id: 'nf-1-5',
    label: 'General Corpus Rank 1-5',
    detail: 'nf01-nf05',
    nfMax: 5,
    penalty: 10,
  },
  {
    id: 'nf-6-10',
    label: 'General Corpus Rank 6-10',
    detail: 'nf06-nf10',
    nfMax: 10,
    penalty: 15,
  },
  {
    id: 'nf-11-20',
    label: 'General Corpus Rank 11-20',
    detail: 'nf11-nf20',
    nfMax: 20,
    penalty: 20,
  },
  {
    id: 'nf-21-30',
    label: 'General Corpus Rank 21-30',
    detail: 'nf21-nf30',
    nfMax: 30,
    penalty: 30,
  },
  {
    id: 'nf-31-48',
    label: 'General Corpus Rank 31-48',
    detail: 'nf31-nf48',
    nfMax: Infinity,
    penalty: 40,
  },
  {
    id: 'very-rare',
    label: 'Very Rare',
    detail: 'no frequency tags',
    fallback: true,
    penalty: 50,
  },
];

export function getFrequencyPenalty(variant: DictionaryVariant | null, wordStr: string): number {
  const priorities = variant?.priorities || [];

  if (variant === null && /^[ぁ-ん]{1,3}$/.test(wordStr)) {
    return FREQUENCY_PENALTY_RULES.find((r) => r.kanaFallback)!.penalty;
  }

  const hasPriority = (p: string) => priorities.includes(p);

  for (const rule of FREQUENCY_PENALTY_RULES) {
    if (rule.tags && rule.tags.some(hasPriority)) return rule.penalty;
  }

  const nfTag = priorities.find((p: string) => p.startsWith('nf'));
  if (nfTag) {
    const rank = parseInt(nfTag.slice(2), 10);
    const nfRule = FREQUENCY_PENALTY_RULES.find((r) => r.nfMax !== undefined && rank <= r.nfMax);
    if (nfRule) return nfRule.penalty;
  }

  return FREQUENCY_PENALTY_RULES.find((r) => r.fallback)!.penalty;
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
