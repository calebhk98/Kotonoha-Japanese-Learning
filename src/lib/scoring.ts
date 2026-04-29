import kanjiData from "kanji-data";

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

export function getFrequencyPenalty(variant: DictionaryVariant | null, wordStr: string): number {
  const priorities = variant?.priorities || [];

  if (variant === null && /^[ぁ-ん]{1,3}$/.test(wordStr)) return -20;

  const hasPriority = (p: string) => priorities.includes(p);

  if (hasPriority('news1') || hasPriority('ichi1')) return -20;
  if (hasPriority('news2') || hasPriority('ichi2')) return -10;
  if (hasPriority('gai1') || hasPriority('spec1')) return 0;
  if (hasPriority('gai2') || hasPriority('spec2')) return 5;

  const nfTag = priorities.find((p: string) => p.startsWith('nf'));
  if (nfTag) {
    const rank = parseInt(nfTag.slice(2), 10);
    if (rank <= 5) return 10;
    if (rank <= 10) return 15;
    if (rank <= 20) return 20;
    if (rank <= 30) return 30;
    return 40;
  }

  return 50;
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

export function getCachedDictionaryEntries(wordStr: string): DictionaryEntry[] {
  if (wordsCache.has(wordStr)) return wordsCache.get(wordStr)!;

  // Use global search for all words to ensure correct definitions
  // searchWords looks up by written form first, then pronunciation
  const entries = kanjiData.searchWords(wordStr) as DictionaryEntry[];

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
