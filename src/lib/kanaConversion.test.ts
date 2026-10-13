import { describe, it, expect } from 'vitest';
import { isKanaHeavy, alignConverted, kanaLemma, applyKanaConversion } from './kanaConversion.js';
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
    expect(isKanaHeavy('えを かいて います。')).toBe(true);
    // A whole short kana utterance (Peter Rabbit: いたい！ read as 遺体 "corpse").
    expect(isKanaHeavy('「いたい！」')).toBe(true);
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
    const out = alignConverted('かざって あります', 0, [t('飾ってあります', '飾る', 'かざってあります', { dictionaryForm: '飾る', posDetail: ['動詞', '一般'] })]);
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
  // Graded sample: 気もち (気持ち) became "気 + もち", はいって来 Unknown.
  it('keeps the converted word when the original\'s kanji are part of it', () => {
    const out = alignConverted('気もちが いい', 0, [t('気持ち', '気持ち', 'きもち', { posDetail: ['名詞'] }), t('が', 'が', 'が'), t('いい', '良い', 'いい')]);
    expect(out?.[0].surface).toBe('気もち');
    expect(out?.[0].baseForm).toBe('気持ち');
  });
  // その次の日 ほんとうに → 日本当に: a noun may not swallow a space.
  it('lets only a verb or adjective disagree across a space', () => {
    const conv = [t('日本', '日本', 'にほん', { posDetail: ['名詞'] }), t('当に', '当に', 'とうに', { posDetail: ['副詞'] })];
    const out = alignConverted('日 ほんとうに', 0, conv);
    expect(out?.some((x) => x.surface.includes(' ')) ?? false).toBe(false);
  });
  // Graded sample: きょう　たろう became the name "Kyōtarō".
  it('never matches a noun across a space, even exactly', () => {
    const conv = [t('京太郎', '京太郎', 'きょうたろう', { posDetail: ['名詞', '固有名詞', '人名'] }), t('は', 'は', 'は')];
    const out = alignConverted('きょう　たろうは', 0, conv);
    expect(out?.some((x) => /\s/.test(x.surface)) ?? false).toBe(false);
  });
  // Graded sample: お客さまが became one Unknown token.
  it('a disagreeing word with kanji in the original does not swallow the next particle', () => {
    const conv = [t('お客様', 'お客様', 'おきゃくさま', { posDetail: ['名詞'] }), t('が', 'が', 'が'), t('来た', '来る', 'きた')];
    const out = alignConverted('お客さまが きた', 0, conv);
    expect(out?.map((x) => x.surface)).toEqual(['お客さま', 'が', 'きた']);
    expect(out?.[0].baseForm).toBe('お客様');
  });
  it('never takes a word from a converter that rewrote kanji in the original', () => {
    const conv = [t('その', 'その', 'その'), t('日', '日', 'ひ'), t('の', 'の', 'の'), t('夜', '夜', 'よる')];
    const out = alignConverted('そのひの夕', 0, conv);
    expect(out?.[3].surface).toBe('夕');
    expect(out?.[3].baseForm).toBe('夕');
  });
  // A 120-token sentence that fails at its end hung the sample run
  // (kana tokens match by surface and by reading: 2^n retries).
  it('fails fast on a long sentence that does not align at the end', () => {
    const original = 'あ'.repeat(120) + 'い';
    const conv = Array.from({ length: 120 }, () => t('あ', 'あ', 'あ')).concat([t('う', 'う', 'う')]);
    const started = Date.now();
    alignConverted(original, 0, conv);
    expect(Date.now() - started).toBeLessThan(1000);
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

describe('applyKanaConversion', () => {
  const tokenizerFor = (map: Record<string, TokenInfo[]>) => ({
    name: 'fake',
    ready: async () => {},
    segment: async (s: string) => map[s] ?? [],
  });
  const readings: Record<string, string[]> = { 旗: ['はた'], 描く: ['かく', 'えがく'], 黄色: ['きいろ'], 絵: ['え'] };
  const readingsOf = async (w: string) => new Set(readings[w] ?? []);

  // Sample run: きいろの き (yellow tree) converted to 黄色の旗 (flag) kept 旗.
  it('drops a mismatched word the kana is not a reading of', async () => {
    const text = 'きいろの きが ありました。';
    const conv = '黄色の旗がありました。';
    const tk = tokenizerFor({
      [conv]: [t('黄色', '黄色', 'きいろ'), t('の', 'の', 'の'), t('旗', '旗', 'はた', { posDetail: ['名詞', '普通名詞'] }), t('が', 'が', 'が'), t('ありました', '有る', 'ありました')],
    });
    const out = await applyKanaConversion([], text, tk, async () => [conv], readingsOf);
    const ki = out.find((x) => x.surface === 'き');
    expect(ki?.baseForm).toBe('き');
    expect(out.find((x) => x.surface === 'きいろ')?.baseForm).toBe('黄色');
  });
  it('keeps a mismatched word the kana is a reading of', async () => {
    const text = 'えを かいて います。';
    const conv = '絵を描いています。';
    const tk = tokenizerFor({
      [conv]: [t('絵', '絵', 'え'), t('を', 'を', 'を'), t('描いています', '描く', 'えがいています', { dictionaryForm: '描く', posDetail: ['動詞', '一般'] })],
    });
    const out = await applyKanaConversion([], text, tk, async () => [conv], readingsOf);
    expect(out.find((x) => x.surface.startsWith('かいて'))?.baseForm).toBe('描く');
  });
  const pos = (surface: string, start: number, baseForm: string, posDetail: string[]) => ({
    surface,
    baseForm,
    reading: surface,
    posDetail,
    pos: posDetail[0],
    startIndex: start,
    endIndex: start + surface.length,
  });
  // Graded sample: みお (a girl's name) became 澪 "waterway", あいこ ("a
  // draw") became 愛子 "Aiko", katakana シロ became 城 "castle".
  it('keeps the original token for names and katakana', async () => {
    const text = 'みおと シロと あいこ。';
    const conv = '澪と城と愛子。';
    const original = [
      pos('みお', 0, 'みお', ['名詞', '固有名詞', '人名', '名']),
      pos('と', 2, 'と', ['助詞']),
      pos('シロ', 4, 'シロ', ['名詞', '普通名詞', '一般']),
      pos('と', 6, 'と', ['助詞']),
      pos('あいこ', 8, '相子', ['名詞', '普通名詞', '一般']),
    ];
    const tk = tokenizerFor({
      [conv]: [
        t('澪', '澪', 'みお', { posDetail: ['名詞', '普通名詞', '一般'] }),
        t('と', 'と', 'と'),
        t('城', '城', 'しろ', { posDetail: ['名詞', '普通名詞', '一般'] }),
        t('と', 'と', 'と'),
        t('愛子', '愛子', 'あいこ', { posDetail: ['名詞', '固有名詞', '人名', '名'] }),
      ],
    });
    const out = await applyKanaConversion(original, text, tk, async () => [conv], readingsOf);
    expect(out.map((x) => x.baseForm)).toEqual(['みお', 'と', 'シロ', 'と', '相子']);
  });
  // Graded sample: the converter's pick for a short kana noun was wrong
  // about as often as right (うち 内 for 家, あさ 麻 for 朝); where it and
  // the original tokenization disagree on the same word, both are kept.
  it('keeps the original reading of a same-span word as an alternative', async () => {
    const text = 'うちに かえる。';
    const conv = '内に帰る。';
    const original = [pos('うち', 0, '内', ['名詞', '普通名詞', '副詞可能']), pos('に', 2, 'に', ['助詞']), pos('かえる', 4, '変える', ['動詞', '一般'])];
    const tk = tokenizerFor({
      [conv]: [t('内', '内', 'うち', { posDetail: ['名詞', '普通名詞'] }), t('に', 'に', 'に'), t('帰る', '帰る', 'かえる', { posDetail: ['動詞', '一般'], dictionaryForm: '帰る' })],
    });
    const out = await applyKanaConversion(original, text, tk, async () => [conv], readingsOf);
    expect(out[0].kanaAlt).toBeUndefined(); // same word both ways
    expect(out[2].baseForm).toBe('帰る');
    expect(out[2].kanaAlt?.baseForm).toBe('変える');
  });
  it('keeps a same-kanji word through the reading check (気もち / 気持ち)', async () => {
    const text = 'やさしい気もちです。';
    const conv = '優しい気持ちです。';
    const tk = tokenizerFor({ [conv]: [t('優しい', '優しい', 'やさしい'), t('気持ち', '気持ち', 'きもち', { posDetail: ['名詞'], dictionaryForm: '気持ち' }), t('です', 'です', 'です')] });
    const out = await applyKanaConversion([], text, tk, async () => [conv], async (w) => new Set(w === '気持ち' ? ['きもち'] : []));
    expect(out.find((x) => x.surface === '気もち')?.baseForm).toBe('気持ち');
  });
  // Random-story grading: the converter wrote 観た for 見た, the token fell
  // back to its own text as the lookup key and matched a proverb.
  it('uses the original token where a disagreeing kanji word has the same span', async () => {
    const text = 'わたしはかおを見た。';
    const conv = '私は顔を観た。';
    const original = [
      pos('わたし', 0, '私', ['代名詞']),
      pos('は', 3, 'は', ['助詞']),
      pos('かお', 4, '顔', ['名詞', '普通名詞', '一般']),
      pos('を', 6, 'を', ['助詞']),
      { ...pos('見た', 7, '見る', ['動詞', '一般']), dictionaryForm: '見る' },
    ];
    const tk = tokenizerFor({
      [conv]: [t('私', '私', 'わたし'), t('は', 'は', 'は'), t('顔', '顔', 'かお', { posDetail: ['名詞'] }), t('を', 'を', 'を'), t('観た', '観る', 'みた', { posDetail: ['動詞', '一般'], dictionaryForm: '観る' })],
    });
    const out = await applyKanaConversion(original, text, tk, async () => [conv], readingsOf);
    expect(out.find((x) => x.surface === '見た')?.baseForm).toBe('見る');
  });
  // All-items diff review: demoting converter names that are also common
  // kana words fixed one かみ "paper" and broke seven given names (なな
  // "seven", けんじ "public prosecutor", みき "tree trunk").
  it('keeps a converter name for a kana given name that is also a common word', async () => {
    const text = 'ななちゃんが わらいました。';
    const conv = '奈々ちゃんが笑いました。';
    const tk = tokenizerFor({
      [conv]: [t('奈々', '奈々', 'なな', { posDetail: ['名詞', '固有名詞', '人名', '名'] }), t('ちゃん', 'ちゃん', 'ちゃん'), t('が', 'が', 'が'), t('笑いました', '笑う', 'わらいました', { posDetail: ['動詞', '一般'] })],
    });
    const out = await applyKanaConversion([], text, tk, async () => [conv], readingsOf);
    expect(out.find((x) => x.surface === 'なな')?.posDetail?.[1]).toBe('固有名詞');
  });
  // The converter turned a full-width space into U+FFFD and garbage.
  it('sends sentences to the converter without spaces', async () => {
    let sent: string[] = [];
    await applyKanaConversion([], 'おばあちゃんは\u3000うなずきました。', tokenizerFor({}), async (s) => ((sent = s), s.map(() => null)), readingsOf);
    expect(sent).toEqual(['おばあちゃんはうなずきました。']);
  });
});
