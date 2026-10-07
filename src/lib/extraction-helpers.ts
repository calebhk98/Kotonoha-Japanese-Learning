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
/**
 * Sudachi normalizes the highest-frequency grammatical verbs to KANJI base
 * forms (しました→為る, いました→居る, あります→有る). Those kanji have
 * JMDict homographs that mislead dictionary lookup (為る matches 成る "to
 * become"), so kana surfaces with these bases route to the corresponding
 * kana morpheme-table entry instead.
 */
const KANJI_GRAMMAR_BASES: Record<string, string> = {
  '為る': 'する',
  '居る': 'いる',
  '有る': 'ある',
};

export function getGrammarDefinition(surface: string, baseForm: string): string | undefined {
  if (!/^[ぁ-んー]+$/.test(surface)) return undefined;
  const surfaceDef = getMorphemeDefinition(surface);
  if (surfaceDef) return surfaceDef;
  if (!baseForm || baseForm === surface) return undefined;
  if (/^[ぁ-んー]+$/.test(baseForm)) {
    return getMorphemeDefinition(baseForm);
  }
  const kanaBase = KANJI_GRAMMAR_BASES[baseForm];
  return kanaBase ? getMorphemeDefinition(kanaBase) : undefined;
}

/**
 * Grammar label for a kana token using its full UniDic POS, so one surface
 * gets the label for the job it does HERE (な after 好き is the copula, not
 * the sentence-final particle; と after a verb is "when/if", not "with").
 *
 * Returns:
 *   - a string: the grammar label to show
 *   - null: this surface is a CONTENT word here (もの "thing", ある日's ある
 *     handled as a label, こと "matter") and must be resolved as vocabulary
 *   - undefined: no POS-specific rule; caller falls back to getGrammarDefinition
 */
export function getContextualGrammarLabel(
  surface: string,
  posDetail: string[] | undefined,
  baseForm?: string
): string | null | undefined {
  if (!posDetail) return undefined;
  const [p0, p1] = posDetail;

  // Interjections (あ, ええ, はい) are words with dictionary entries
  // ("ah!", "yes"); the kana table only has verb-fragment labels for them.
  if (p0 === '感動詞') return null;
  switch (surface) {
    case 'な':
      if (p0 === '助動詞') return 'copula (attributive): links a na-adjective or noun to the noun after it (好きな人)';
      break;
    case 'に':
      if (p0 === '助動詞') return 'adverbial ending: "-ly" / "so that, like" (きれいに, ように)';
      break;
    case 'で':
      // Sudachi also tags plain locative で (家で) as the copula, so the
      // label has to cover both readings.
      if (p0 === '助動詞') return 'at / in / by means of; or copula te-form "is ... and" (〜で)';
      if (p1 === '接続助詞') return 'te-form connector: "and" / "-ing" (遊んで)';
      if (p1 === '格助詞') return 'at / in / by means of; also "is ... and" (te-form of だ)';
      break;
    case 'と':
      if (p1 === '接続助詞') return 'conditional: "when / whenever / if" (〜と)';
      if (p1 === '並立助詞') return 'and (complete list: AとB)';
      if (p1 === '格助詞') return 'quotation marker ("..." と言う) / with / and';
      break;
    case 'が':
      if (p1 === '接続助詞') return 'but / and (joins two clauses)';
      break;
    case 'の':
      // Sudachi also tags some possessive の (衣の色) as 準体助詞.
      if (p1 === '準体助詞') return 'nominalizer: "the one / the fact that"; explanatory (〜のです); also possessive "\'s"';
      break;
    case 'か':
      if (p1 === '副助詞') return 'question marker; "or"; some- (何か "something", いつか "someday")';
      break;
    case 'ある':
      if (p0 === '連体詞') return 'a certain / one (ある日 "one day")';
      break;
    case 'もの':
    case 'こと':
      if (p0 === '名詞') return null;
      break;
    case 'てる':
    case 'でる':
      if (p0 === '助動詞') return 'progressive: "is doing" (contraction of 〜ている)';
      break;
  }
  // Any other conjugated auxiliary stem (れ in 言われます) is labelled by
  // its lemma (れる "passive"), not by the bare-kana stem table.
  // Only replaces the placeholder stem labels; まし keeps its own
  // "polite verb stem" (ます's label says non-past, wrong for ました).
  const own = getMorphemeDefinition(surface);
  if (own && !/^Verb stem/.test(own)) return undefined;
  if (p0 === '助動詞' && baseForm && baseForm !== surface && /^[ぁ-ん]+$/.test(baseForm)) {
    const lemmaLabel = getMorphemeDefinition(baseForm);
    if (lemmaLabel) return lemmaLabel;
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
