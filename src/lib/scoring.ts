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

export const wordsCache = new Map<string, DictionaryEntry[]>();

// Get dictionary entries for a word by looking up all kanji it contains
function getEntriesByKanjiLookup(wordStr: string): DictionaryEntry[] {
  const kanjis = kanjiData.extractKanji(wordStr);
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

  // Use efficient kanji-based lookup instead of global searchWords
  const entries = getEntriesByKanjiLookup(wordStr);
  wordsCache.set(wordStr, entries);
  return entries;
}

export function findBestVariant(wordStr: string, entries: DictionaryEntry[]): FindBestVariantResult {
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

      if (score > best.score) {
        best = { variant: v, entry, score };
      }
    }
  }

  return best.score >= 0 ? best : { variant: null, entry: null, score: -999 };
}
