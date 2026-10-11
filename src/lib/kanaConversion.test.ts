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
  // Sample run: 31% of conversions were rejected, mostly for one token.
  it('matches a grouped token across a space in spaced-out text', () => {
    const out = alignConverted('かざって あります', 0, [t('飾ってあります', '飾る', 'かざってあります', { dictionaryForm: '飾る' })]);
    expect(out?.map((x) => x.surface)).toEqual(['かざって あります']);
    expect(out?.[0].baseForm).toBe('飾る');
  });
  it('keeps the kana for one mis-guessed name and aligns the rest', () => {
    const conv = [
      t('健人', '健人', 'たけと', { posDetail: ['名詞', '固有名詞', '人名', '名'] }),
      t('くん', 'くん', 'くん'),
      t('が', 'が', 'が'),
      t('来ました', '来る', 'きました', { dictionaryForm: '来る' }),
    ];
    const out = alignConverted('けんじくんが きました。', 0, conv);
    expect(out?.map((x) => x.surface)).toEqual(['けんじ', 'くん', 'が', 'きました']);
    expect(out?.[0].baseForm).toBe('けんじ');
    expect(out?.[0].reading).toBe('けんじ');
    expect(out?.[3].baseForm).toBe('来る');
  });
  it('keeps the word when only its reading differs (描く かく / えがく)', () => {
    const conv = [t('絵', '絵', 'え'), t('を', 'を', 'を'), t('描く', '描く', 'えがく', { dictionaryForm: '描く', posDetail: ['動詞', '一般'] })];
    const out = alignConverted('えを かく', 0, conv);
    expect(out?.map((x) => [x.surface, x.baseForm, x.reading])).toEqual([
      ['え', '絵', 'え'],
      ['を', 'を', 'を'],
      ['かく', '描く', 'かく'],
    ]);
  });
  it('never takes a word from a converter that rewrote kanji in the original', () => {
    const conv = [t('その', 'その', 'その'), t('日', '日', 'ひ'), t('の', 'の', 'の'), t('夜', '夜', 'よる')];
    const out = alignConverted('そのひの夕', 0, conv);
    expect(out?.[3].surface).toBe('夕');
    expect(out?.[3].baseForm).toBe('夕');
  });
  it('rejects a conversion whose readings do not spell the original', () => {
    // Three mismatching tokens: too little of the conversion agrees.
    expect(
      alignConverted('いえにかえるよ', 0, [t('家', '家', 'うち'), t('に', 'に', 'へ'), t('帰る', '帰る', 'もどる'), t('よ', 'よ', 'よ')])
    ).toBeNull();
    // The converter rewrote text it was not asked to (leftover kana).
    expect(alignConverted('いえに', 0, [t('家', '家', 'いえ')])).toBeNull();
  });
});
