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

/** A sentence worth converting: a hiragana run of 4+ and under 20% kanji. */
export function isKanaHeavy(sentence: string): boolean {
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
  if (!KANJI.test(convSurface)) return /[ァ-ヶ]/.test(kanaSurface) ? lemma : toHiragana(lemma);
  let headLen = 0;
  for (let i = 0; i < convSurface.length; i++) if (KANJI.test(convSurface[i])) headLen = i + 1;
  const head = convSurface.slice(0, headLen);
  const tail = convSurface.slice(headLen);
  if (!lemma.startsWith(head) || !toHiragana(kanaSurface).endsWith(toHiragana(tail))) return undefined;
  return kanaSurface.slice(0, kanaSurface.length - tail.length) + lemma.slice(head.length);
}

/**
 * Tokens of the converted sentence placed on the original one (which starts
 * at `offset` in the full text), or null when their readings do not spell
 * it exactly. Whitespace between words (分かち書き) is skipped.
 */
export function alignConverted(original: string, offset: number, conv: TokenInfo[]): PositionedToken[] | null {
  const out: PositionedToken[] = [];
  let p = 0;
  const skipSpace = () => {
    while (p < original.length && /[\s\p{P}\p{S}]/u.test(original[p])) p++;
  };
  for (const tk of conv) {
    if (/^[\s\p{P}\p{S}]*$/u.test(tk.surface)) continue;
    skipSpace();
    let len: number | undefined;
    if (original.startsWith(tk.surface, p)) len = tk.surface.length;
    else if (tk.reading && toHiragana(original.slice(p, p + tk.reading.length)) === toHiragana(tk.reading)) len = tk.reading.length;
    else if (toHiragana(original.slice(p, p + tk.surface.length)) === toHiragana(tk.surface)) len = tk.surface.length;
    if (!len) return null;
    const surface = original.slice(p, p + len);
    const token: PositionedToken = { ...tk, surface, startIndex: offset + p, endIndex: offset + p + len };
    if (surface !== tk.surface) {
      for (const field of ['dictionaryForm', 'lemmaSurface'] as const) {
        const lemma = tk[field];
        if (!lemma) continue;
        const kana = kanaLemma(tk.surface, surface, lemma);
        if (kana) token[field] = kana;
        else delete token[field];
      }
    }
    out.push(token);
    p += len;
  }
  skipSpace();
  return p === original.length ? out : null;
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
  convert: (sentences: string[]) => Promise<(string | null)[]>
): Promise<PositionedToken[]> {
  const sentences = splitSentences(text).filter((s) => isKanaHeavy(s.text));
  Object.assign(kanaConversionStats, { sentences: sentences.length, converted: 0, rejected: 0 });
  if (sentences.length === 0) return positioned;
  const converted = await convert(sentences.map((s) => s.text));
  let out = positioned;
  for (const [k, s] of sentences.entries()) {
    const c = converted[k];
    if (!c || c === s.text) continue;
    const inside = (t: PositionedToken) => t.startIndex >= s.start && t.endIndex <= s.end;
    const outside = (t: PositionedToken) => t.endIndex <= s.start || t.startIndex >= s.end;
    // A token straddling the sentence edge: leave the sentence as it is.
    if (out.some((t) => !inside(t) && !outside(t))) continue;
    const aligned = alignConverted(s.text, s.start, await tokenizer.segment(c));
    if (!aligned) {
      kanaConversionStats.rejected++;
      continue;
    }
    kanaConversionStats.converted++;
    const spaces = out.filter((t) => inside(t) && /^\s+$/.test(t.surface));
    out = [...out.filter(outside), ...spaces, ...aligned].sort((a, b) => a.startIndex - b.startIndex);
  }
  return out;
}
