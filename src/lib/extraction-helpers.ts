/**
 * Pure token-filter helpers shared between server.ts (inline extraction) and
 * extraction-worker.ts (worker-thread startup extraction).
 *
 * Previously duplicated verbatim across processText, processTextWithTokens, and
 * runBatchExtract.  Centralised here so both code paths stay in sync.
 */

import { getMorphemeDefinition } from './morphemeDefinitions.js';

export const PARTICLES = new Set([
  'は', 'が', 'を', 'に', 'へ', 'と', 'で', 'も', 'か', 'の', 'て', 'な', 'だ',
]);

/**
 * Returns true for tokens that should be skipped entirely during extraction.
 *
 * Uses a negative test: a token is "punctuation" if it contains NO Japanese
 * vocabulary characters (kanji, hiragana, katakana). This handles full-width
 * punctuation (：, …, ［, ＃, ②, etc.) without maintaining an ever-growing
 * allowlist, and correctly passes katakana loanwords through to the dictionary.
 */
export function isPunctuation(s: string): boolean {
  return !/[ぁ-ん゛゜ァ-ヴー一-鿿々〆〇]/.test(s);
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
 * Returns the grammatical (morpheme-table) definition for a token, or
 * undefined when the token is ordinary vocabulary.
 *
 * The tokenizer keeps grammatical auxiliaries (たい, ない, です, ます…) as
 * separate tokens so learners see their meanings, but hands back conjugated
 * SURFACE forms (たく, なかっ, でし) whose base form is the table entry.
 * Checking only the surface let those fall through to JMDict homograph
 * lookup, which returned nonsense: たく(たい)→対 "versus", なかっ(ない)→
 * "nonexistent". The surface definition wins when both exist (ました is more
 * specific than ます).
 *
 * Only pure-kana tokens qualify: a kanji base form (見る for the surface 見)
 * means the token is a content word and must use the dictionary waterfall.
 */
export function getGrammarDefinition(surface: string, baseForm: string): string | undefined {
  if (!/^[ぁ-んー]+$/.test(surface)) return undefined;
  const surfaceDef = getMorphemeDefinition(surface);
  if (surfaceDef) return surfaceDef;
  if (baseForm && baseForm !== surface && /^[ぁ-んー]+$/.test(baseForm)) {
    return getMorphemeDefinition(baseForm);
  }
  return undefined;
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
