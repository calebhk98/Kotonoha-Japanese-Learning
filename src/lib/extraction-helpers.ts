/**
 * Pure token-filter helpers shared between server.ts (inline extraction) and
 * extraction-worker.ts (worker-thread startup extraction).
 *
 * Previously duplicated verbatim across processText, processTextWithTokens, and
 * runBatchExtract.  Centralised here so both code paths stay in sync.
 */

export const PARTICLES = new Set([
  'は', 'が', 'を', 'に', 'へ', 'と', 'で', 'も', 'か', 'の', 'て', 'な', 'だ',
]);

/** Returns true for characters that should be skipped entirely during extraction. */
export function isPunctuation(s: string): boolean {
  return /[、。！？・「」『』（）()[\]a-zA-Z0-9\s]/.test(s);
}

/**
 * Returns true for single-character tokens that are particles or plain hiragana.
 * These are filtered out before dictionary lookup (they're grammatical glue, not
 * vocabulary items worth showing to learners).
 */
export function isSingleKana(s: string): boolean {
  return s.length === 1 && (PARTICLES.has(s) || /[ぁ-ん]/.test(s));
}

/** Returns true when the entire string is hiragana (small-kana inclusive). */
export function isHiraganaWord(s: string): boolean {
  return s.length > 0 && /^[ぁ-ん]+$/.test(s);
}

/** Returns true when the entire string is katakana (long-vowel mark inclusive). */
export function isKatakanaWord(s: string): boolean {
  return s.length > 0 && /^[ァ-ヴー]+$/.test(s);
}

/**
 * Returns true when a kana word ends in small-tsu (っ), indicating it is a
 * cut-off verb-stem conjugation artifact (e.g. もらっ, 走っ) rather than a
 * complete dictionary entry.  No valid Japanese dictionary form ends in っ, so
 * sending these to Jisho returns geographic noise like "Molazzana" (#174).
 */
export function looksLikePartialStem(s: string): boolean {
  return s.length > 0 && s.endsWith('っ');
}
