/**
 * Kana-to-kanji pre-conversion for hiragana-heavy sentences.
 *
 * Beginner texts are written in kana, and Sudachi segments and normalizes
 * long hiragana runs badly: reader test 2 (9 stories) found いえにかえります
 * read as 言え "to say", のみます as の + 見る, くさっぱら as 腐っ + 腹. A
 * small kana-kanji conversion model (zenz, run by scripts/context/enrich.py)
 * turns such a sentence into ordinary mixed text (子どもは家に帰ります),
 * Sudachi tokenizes THAT, and each token is mapped back onto the original
 * kana by its reading. The reader and vocab list keep the kana the text was
 * written in; only segmentation, POS and lookup keys come from the kanji
 * version. A conversion whose readings do not spell the original exactly is
 * dropped, so the converter can never change what the text says, only how
 * it is split and looked up (a wrong homophone, 撃つ for 討つ, still passes).
 */
import type { TokenInfo, Tokenizer } from './tokenizers.js';
import type { PositionedToken } from './tokenContext.js';
import { splitSentences } from './sentenceSplitter.js';

const KANJI = /[一-鿿々〆]/;
const JAPANESE = /[ぁ-ゖァ-ヺー一-鿿々〆]/g;
const toHiragana = (s: string) => s.replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));

/**
 * A sentence worth converting: a hiragana run of 4+ (spaces between words
 * ignored: えを かいて います) and under 20% kanji.
 */
export function isKanaHeavy(sentence: string): boolean {
  sentence = sentence.replace(/\s+/g, '');
  const jp = sentence.match(JAPANESE) ?? [];
  if (jp.length === 0) return false;
  const longestRun = Math.max(0, ...(sentence.match(/[ぁ-ゖー]+/g) ?? []).map((r) => r.length));
  const kanji = jp.filter((c) => KANJI.test(c)).length;
  return longestRun >= 4 && kanji / jp.length < 0.2;
}

/**
 * A converted token's lemma in the text's own kana spelling: 帰ります /
 * かえります / 帰る → かえる. Undefined when the lemma does not start with
 * the converted surface's kanji part (行っ / 言う).
 */
export function kanaLemma(convSurface: string, kanaSurface: string, lemma: string): string | undefined {
  kanaSurface = kanaSurface.replace(/\s/g, '');
  if (!KANJI.test(convSurface)) return /[ァ-ヶ]/.test(kanaSurface) ? lemma : toHiragana(lemma);
  let headLen = 0;
  for (let i = 0; i < convSurface.length; i++) if (KANJI.test(convSurface[i])) headLen = i + 1;
  const head = convSurface.slice(0, headLen);
  const tail = convSurface.slice(headLen);
  if (!lemma.startsWith(head) || !toHiragana(kanaSurface).endsWith(toHiragana(tail))) return undefined;
  return kanaSurface.slice(0, kanaSurface.length - tail.length) + lemma.slice(head.length);
}

/** A placed token; `mismatch` when its kana disagreed with the conversion. */
export interface ConvertedToken extends PositionedToken {
  mismatch?: boolean;
}

const SKIP = /[\s\p{P}\p{S}]/u;
/** Tokens whose kana may disagree with the conversion, per sentence. */
const MAX_MISMATCHES = 2;

/**
 * End of `form` matched against the original from p (kana compared as
 * hiragana, spaces allowed inside: かざって あります), or -1.
 */
function matchAt(original: string, p: number, form: string): number {
  let q = p;
  for (const ch of toHiragana(form)) {
    while (q > p && q < original.length && /\s/.test(original[q])) q++;
    if (q >= original.length || toHiragana(original[q]) !== ch) return -1;
    q++;
  }
  return q;
}

/**
 * Tokens of the converted sentence placed on the original one (which starts
 * at `offset` in the full text), or null when they do not spell it.
 * Whitespace (分かち書き) and punctuation, which the tokenizer drops, are
 * skipped. Up to MAX_MISMATCHES tokens may disagree (a name the converter
 * guessed: けんじ → 健人 たけと; a reading variant: 描く えがく for かく);
 * such a token covers the original kana up to where the rest agrees again.
 * It keeps the converted word only when the original is kana and the token
 * is not a name; otherwise its own text is the lookup key.
 */
export function alignConverted(original: string, offset: number, conv: TokenInfo[]): ConvertedToken[] | null {
  const toks = conv.filter((tk) => !/^[\s\p{P}\p{S}]*$/u.test(tk.surface));
  const skip = (p: number) => {
    while (p < original.length && SKIP.test(original[p])) p++;
    return p;
  };
  const place = (tk: TokenInfo, p: number, q: number, mismatch: boolean): ConvertedToken => {
    const surface = original.slice(p, q);
    const token: ConvertedToken = { ...tk, surface, startIndex: offset + p, endIndex: offset + q };
    if (mismatch) token.mismatch = true;
    if (mismatch && (KANJI.test(surface) || tk.posDetail?.[1] === '固有名詞')) {
      Object.assign(token, { baseForm: surface, dictionaryForm: surface, lemmaSurface: surface });
      if (KANJI.test(surface)) delete token.reading;
      else token.reading = toHiragana(surface);
      return token;
    }
    if (mismatch) token.reading = toHiragana(surface.replace(/\s/g, ''));
    if (surface !== tk.surface) {
      for (const field of ['dictionaryForm', 'lemmaSurface'] as const) {
        const lemma = tk[field];
        if (!lemma) continue;
        const kana = kanaLemma(tk.surface, surface, lemma);
        if (kana) token[field] = kana;
        else delete token[field];
      }
    }
    return token;
  };
  let budget = 0;
  // Failed (position, token, mismatches) states: without this a long
  // sentence failing near its end retried 2^n paths.
  let failed = new Set<string>();
  const go = (from: number, k: number, mismatches: number): ConvertedToken[] | null => {
    const key = `${from}:${k}:${mismatches}`;
    if (failed.has(key)) return null;
    const out = step(from, k, mismatches);
    if (!out) failed.add(key);
    return out;
  };
  const step = (from: number, k: number, mismatches: number): ConvertedToken[] | null => {
    const p = skip(from);
    if (k === toks.length) return p === original.length ? [] : null;
    const tk = toks[k];
    for (const form of new Set([tk.surface, tk.reading])) {
      if (!form) continue;
      const q = matchAt(original, p, form);
      if (q < 0) continue;
      const rest = go(q, k + 1, mismatches);
      if (rest) return [place(tk, p, q, false), ...rest];
    }
    // Only a content word may disagree, and it may not grow (it would
    // swallow the next particle) except a name by one kana.
    if (mismatches >= budget || ['助詞', '助動詞'].includes(tk.posDetail?.[0] ?? tk.pos ?? '')) return null;
    const expected = (tk.reading ?? tk.surface).length;
    const longest = expected + (tk.posDetail?.[1] === '固有名詞' ? 1 : 0);
    // Count kana, not spaces (かいて います); stop at punctuation.
    let chars = 0;
    for (let q = p; q < original.length && chars < longest; ) {
      if (/[\p{P}\p{S}]/u.test(original[q])) break;
      if (!/\s/.test(original[q])) chars++;
      q++;
      if (chars < Math.max(1, expected - 1) || /\s/.test(original[q - 1])) continue;
      const rest = go(q, k + 1, mismatches + 1);
      if (rest) return [place(tk, p, q, true), ...rest];
    }
    return null;
  };
  // Fewest mismatches first (けんじ|くん, never け|んじくん); at most one
  // per four tokens, so a mostly-wrong conversion is dropped.
  const allowed = Math.min(MAX_MISMATCHES, Math.max(1, Math.floor(toks.length / 4)));
  for (budget = 0; budget <= allowed; budget++) {
    failed = new Set();
    const out = go(0, 0, 0);
    if (out) return out;
  }
  return null;
}

/** Counts from the last applyKanaConversion call (for scripts / logs). */
export const kanaConversionStats = { sentences: 0, converted: 0, rejected: 0 };

/**
 * Replace the tokens of each kana-heavy sentence with the tokens of its
 * kanji conversion, mapped back onto the kana. `convert` returns one
 * conversion per sentence (null = none).
 */
export async function applyKanaConversion(
  positioned: PositionedToken[],
  text: string,
  tokenizer: Tokenizer,
  convert: (sentences: string[]) => Promise<(string | null)[]>,
  readingsOf: (word: string) => Promise<Set<string>> = async () => new Set()
): Promise<PositionedToken[]> {
  const sentences = splitSentences(text).filter((s) => isKanaHeavy(s.text));
  Object.assign(kanaConversionStats, { sentences: sentences.length, converted: 0, rejected: 0 });
  if (sentences.length === 0) return positioned;
  // Spaces between words go: the converter garbles a full-width space
  // (U+3000 came back as U+FFFD and took the next word with it).
  const converted = await convert(sentences.map((s) => s.text.replace(/\s+/g, '')));
  let out = positioned;
  for (const [k, s] of sentences.entries()) {
    const c = converted[k];
    if (!c || c === s.text.replace(/\s+/g, '')) continue;
    const inside = (t: PositionedToken) => t.startIndex >= s.start && t.endIndex <= s.end;
    const outside = (t: PositionedToken) => t.endIndex <= s.start || t.startIndex >= s.end;
    // A token straddling the sentence edge: leave the sentence as it is.
    if (out.some((t) => !inside(t) && !outside(t))) continue;
    const aligned = alignConverted(s.text, s.start, await tokenizer.segment(c));
    if (!aligned) {
      kanaConversionStats.rejected++;
      continue;
    }
    // A disagreeing word is kept only when the kana is one of its readings
    // (かく for 描く), never a different word (き "tree" converted to 旗 "flag").
    for (const tk of aligned) {
      if (!tk.mismatch) continue;
      delete tk.mismatch;
      if (tk.baseForm === tk.surface) continue;
      const kana = toHiragana((tk.dictionaryForm ?? tk.surface).replace(/\s/g, ''));
      const known = [...(await readingsOf(tk.baseForm))].map(toHiragana);
      if (!known.includes(kana)) Object.assign(tk, { baseForm: tk.surface, dictionaryForm: tk.surface, lemmaSurface: tk.surface });
    }
    kanaConversionStats.converted++;
    const spaces = out.filter((t) => inside(t) && /^\s+$/.test(t.surface));
    out = [...out.filter(outside), ...spaces, ...aligned].sort((a, b) => a.startIndex - b.startIndex);
  }
  return out;
}
