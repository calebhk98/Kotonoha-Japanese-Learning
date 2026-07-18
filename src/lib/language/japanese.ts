/**
 * The Japanese LanguageDisplayProfile (#258).
 *
 * Every predicate here delegates to (or copies EXACTLY) the regex that the
 * pipeline already used at its scattered call sites — this module is a
 * mechanical centralization, not a behavior change. The committed
 * resolved.json artifacts are the regression proof: regenerating after the
 * rewiring must produce a zero diff.
 *
 * NOTE the two content regexes intentionally differ, as they always have:
 * - containsContentChar uses the server's request-validation range
 *   ぀-ゟ゠-ヿ一-鿿 (whole kana blocks incl. punctuation-ish codepoints).
 * - isPunctuation uses extraction's narrower vocabulary test
 *   ぁ-ん゛゜ァ-ヴー一-鿿々〆〇.
 * Unifying them would change which tokens are extracted — don't, without
 * regenerating and reviewing the artifact diff.
 */

import { isPunctuation, isSingleKana } from '../extraction-helpers.js';
import type { BreakdownRow, LanguageDisplayProfile, PosClass } from './types.js';

/** Sudachi POS → language-neutral class (#258 blocker 3). */
const SUDACHI_POS_CLASSES: Record<string, PosClass> = {
  名詞: 'noun',
  代名詞: 'pronoun',
  動詞: 'verb',
  形容詞: 'adjective',
  形状詞: 'adjective',
  副詞: 'adverb',
  助詞: 'particle',
  助動詞: 'auxiliary',
  接続詞: 'conjunction',
  感動詞: 'interjection',
  接頭辞: 'prefix',
  接尾辞: 'suffix',
  連体詞: 'determiner',
  記号: 'symbol',
  補助記号: 'symbol',
  空白: 'symbol',
};

const POS_CLASS_LABELS: Record<PosClass, string> = {
  noun: 'noun',
  pronoun: 'pronoun',
  verb: 'verb',
  adjective: 'adjective',
  adverb: 'adverb',
  particle: 'particle',
  auxiliary: 'auxiliary',
  conjunction: 'conjunction',
  interjection: 'interjection',
  prefix: 'prefix',
  suffix: 'suffix',
  determiner: 'determiner',
  symbol: 'symbol',
  other: 'other',
};

/** Katakana → hiragana, long-vowel marks preserved (moved from tokenizers.ts usage sites). */
export function katakanaToHiraganaJa(s: string): string {
  return s.replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
}

/**
 * Rows for generic score-breakdown rendering. Field knowledge (jlptScore,
 * joyoPenalty, …) lives HERE and nowhere in the UI (#258 blocker 1): other
 * languages return their own rows (HSK for zh, CEFR for es) and the client
 * renders them without naming any field.
 */
function breakdownRows(breakdown: Record<string, unknown> | null | undefined): BreakdownRow[] {
  if (!breakdown) return [];
  const num = (v: unknown): number | null => (typeof v === 'number' ? v : null);
  const rows: BreakdownRow[] = [
    { key: 'jlptScore', label: 'JLPT difficulty', value: num(breakdown.jlptScore) },
    { key: 'joyoPenalty', label: 'Kanji grade penalty', value: num(breakdown.joyoPenalty) },
    { key: 'highestGrade', label: 'Highest kanji grade', value: num(breakdown.highestGrade) },
    { key: 'freqPenalty', label: 'Frequency adjustment', value: num(breakdown.freqPenalty) },
  ];
  const priorities = breakdown.priorities;
  if (Array.isArray(priorities) && priorities.length > 0) {
    rows.push({ key: 'priorities', label: 'Frequency tags', value: priorities.join(', ') });
  }
  return rows;
}

export const JAPANESE_PROFILE: LanguageDisplayProfile = {
  code: 'ja',
  name: 'Japanese',
  script: {
    // Same range as the server's request-validation JAPANESE_SCRIPT.
    containsContentChar: (s) => /[぀-ゟ゠-ヿ一-鿿]/.test(s),
    isPunctuation: (s) => isPunctuation(s),
    isGrammarFragment: (s) => isSingleKana(s),
    // Same test ContentReader uses to decide whether furigana makes sense.
    needsReadingAid: (s) => /[一-龯]/.test(s),
    normalizeReading: katakanaToHiraganaJa,
  },
  posClass: (nativePos) => (nativePos && SUDACHI_POS_CLASSES[nativePos]) || 'other',
  posLabel: (nativePos) =>
    POS_CLASS_LABELS[(nativePos && SUDACHI_POS_CLASSES[nativePos]) || 'other'],
  breakdownRows,
  // Parity with useContentData's cached-vocab schema check.
  isValidBreakdown: (b): boolean =>
    !!b &&
    typeof b === 'object' &&
    (b as Record<string, unknown>).jlptScore !== undefined &&
    (b as Record<string, unknown>).highestGrade !== undefined,
};
