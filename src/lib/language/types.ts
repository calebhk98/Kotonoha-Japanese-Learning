/**
 * Language-profile interfaces (#258).
 *
 * Kotonoha's pipeline is structurally language-agnostic (Tokenizer,
 * Dictionary.lookup, content folders, resolved.json) but Japanese knowledge
 * leaked into ~15 scattered regexes, Sudachi POS literals, and the
 * JLPT-shaped score breakdown. These interfaces give that knowledge one
 * home per language. Everything in this file is browser-safe — server-only
 * bindings (tokenizer/dictionary construction) live in serverProfile.ts.
 *
 * Adding a target language later = one LanguageDisplayProfile (+ server
 * bindings) + a dictionary source + content folders. See issue #258 for the
 * per-language fit assessment (zh closest, es/hi simplest, ko between).
 */

/** BCP-47-ish lowercase code. 'ja' is the only implemented profile today. */
export type LanguageCode = string;

export const DEFAULT_LANGUAGE: LanguageCode = 'ja';

/**
 * Language-neutral POS classes. Tokenizer-native POS strings (Sudachi's
 * 名詞/動詞/…) must be mapped through LanguageDisplayProfile.posClass before
 * any cross-language code branches on them (#258 blocker 3).
 */
export type PosClass =
  | 'noun'
  | 'pronoun'
  | 'verb'
  | 'adjective'
  | 'adverb'
  | 'particle'
  | 'auxiliary'
  | 'conjunction'
  | 'interjection'
  | 'prefix'
  | 'suffix'
  | 'determiner'
  | 'symbol'
  | 'other';

/**
 * Script predicates for one target language. These are PER-LANGUAGE by
 * design: the old global isPunctuation() ("contains no Japanese characters")
 * classified all Spanish/Hindi text as punctuation (#258 blocker 2) —
 * scoping the predicate to a profile is the fix, not changing the Japanese
 * semantics (which are correct for Japanese content).
 */
export interface ScriptProfile {
  /** True when the string contains at least one target-language codepoint. */
  containsContentChar(s: string): boolean;
  /** True when a token carries no target-language content (skip as punctuation). */
  isPunctuation(s: string): boolean;
  /** True for bare grammatical fragments (single kana / particles) that are not vocab. */
  isGrammarFragment(s: string): boolean;
  /** True when this surface benefits from a reading aid (furigana / pinyin). */
  needsReadingAid(s: string): boolean;
  /** Canonicalize a reading for comparison/lookup (ja: katakana → hiragana). */
  normalizeReading(s: string): string;
}

/** One labeled row of a score breakdown, for generic (language-blind) rendering. */
export interface BreakdownRow {
  key: string;
  label: string;
  value: number | string | null;
}

/**
 * Everything the client (and shared pipeline code) needs to know about a
 * target language. Deliberately free of server-only dependencies.
 *
 * The score breakdown stays profile-defined (#258 blocker 1): Japanese uses
 * JLPT/joyo/frequency, Chinese would use HSK, Spanish CEFR/frequency. UI
 * code renders breakdownRows() instead of naming jlptScore/joyoPenalty
 * fields, and validates cached data with isValidBreakdown().
 */
export interface LanguageDisplayProfile {
  code: LanguageCode;
  /** English name of the language (native-language display is issue #260). */
  name: string;
  script: ScriptProfile;
  /** Map a tokenizer-native POS string to the neutral class. */
  posClass(nativePos: string | undefined): PosClass;
  /** Human-readable label for a tokenizer-native POS string. */
  posLabel(nativePos: string | undefined): string;
  /** Labeled rows of a WordInfo.breakdown for generic rendering. */
  breakdownRows(breakdown: Record<string, unknown> | null | undefined): BreakdownRow[];
  /** Schema check for cached breakdowns (localStorage invalidation). */
  isValidBreakdown(breakdown: unknown): boolean;
}
