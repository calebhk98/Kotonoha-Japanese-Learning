import { describe, it, expect } from 'vitest';
import { isKanaHeavy, alignConverted, kanaLemma } from './kanaConversion.js';
import type { TokenInfo } from './tokenizers.js';

// Reader test 2: in all-hiragana children's text Sudachi split and looked up
// the wrong words (いえにかえります → 言え "to say", のみます → の + 見る).
// The pipeline tokenizes a kana-to-kanji conversion (子どもは家に帰ります)
// and keeps the original kana as each token's surface.

const t = (surface: string, baseForm: string, reading: string, extra: Partial<TokenInfo> = {}): TokenInfo => ({
  surface,
  baseForm,
  reading,
  ...extra,
});

describe('isKanaHeavy', () => {
  it('flags hiragana-only and nearly kanji-free sentences', () => {
    expect(isKanaHeavy('子どもはいえにかえります。')).toBe(true);
    expect(isKanaHeavy('くさっぱらをあるこう')).toBe(true);
  });
  it('leaves ordinary mixed text and short or non-Japanese lines alone', () => {
    expect(isKanaHeavy('日本の首都は東京で、人口は約千四百万人です。')).toBe(false);
    expect(isKanaHeavy('はい')).toBe(false);
    expect(isKanaHeavy('Hello world')).toBe(false);
  });
});

describe('kanaLemma', () => {
  it('rewrites the kanji lemma in the text\'s kana spelling', () => {
    expect(kanaLemma('帰ります', 'かえります', '帰る')).toBe('かえる');
    expect(kanaLemma('座っ', 'すわっ', '座る')).toBe('すわる');
    expect(kanaLemma('家', 'いえ', '家')).toBe('いえ');
  });
  it('gives up when the lemma does not share the converted kanji head', () => {
    expect(kanaLemma('行っ', 'いっ', '言う')).toBeUndefined();
  });
});

describe('alignConverted', () => {
  it('maps kanji tokens back onto the kana text by reading', () => {
    const original = '子どもはいえにかえります。';
    const conv = [
      t('子ども', '子供', 'こども'),
      t('は', 'は', 'は'),
      t('家', '家', 'いえ', { dictionaryForm: '家', lemmaSurface: '家' }),
      t('に', 'に', 'に'),
      t('帰ります', '帰る', 'かえります', { dictionaryForm: '帰る', lemmaSurface: '帰る' }),
      t('。', '。', '。'),
    ];
    const out = alignConverted(original, 10, conv);
    expect(out?.map((x) => x.surface)).toEqual(['子ども', 'は', 'いえ', 'に', 'かえります']);
    expect(out?.map((x) => x.startIndex)).toEqual([10, 13, 14, 16, 17]);
    expect(out?.[2].baseForm).toBe('家');
    expect(out?.[4].baseForm).toBe('帰る');
    expect(out?.[4].dictionaryForm).toBe('かえる');
    expect(out?.[4].lemmaSurface).toBe('かえる');
  });
  it('skips spaces between words and matches katakana conversions', () => {
    const original = 'ばったが とんで';
    const conv = [t('バッタ', 'バッタ', 'ばった'), t('が', 'が', 'が'), t('飛んで', '飛ぶ', 'とんで', { dictionaryForm: '飛ぶ', lemmaSurface: '飛ぶ' })];
    const out = alignConverted(original, 0, conv);
    expect(out?.map((x) => [x.surface, x.startIndex, x.endIndex])).toEqual([
      ['ばった', 0, 3],
      ['が', 3, 4],
      ['とんで', 5, 8],
    ]);
    expect(out?.[2].dictionaryForm).toBe('とぶ');
  });
  it('skips punctuation the tokenizer leaves out', () => {
    const out = alignConverted('犬はのみます。', 0, [t('犬', '犬', 'いぬ'), t('は', 'は', 'は'), t('飲みます', '飲む', 'のみます')]);
    expect(out?.map((x) => x.surface)).toEqual(['犬', 'は', 'のみます']);
  });
  it('rejects a conversion whose readings do not spell the original', () => {
    expect(alignConverted('いえにかえる', 0, [t('家', '家', 'うち'), t('に', 'に', 'に'), t('帰る', '帰る', 'かえる')])).toBeNull();
    // The converter rewrote text it was not asked to (leftover kana).
    expect(alignConverted('いえに', 0, [t('家', '家', 'いえ')])).toBeNull();
  });
});
