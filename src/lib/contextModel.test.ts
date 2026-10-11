import { describe, it, expect } from 'vitest';
import { resolveContent } from './contentResolver.js';
import { WordResolver } from './wordResolver.js';
import { chooseSense, SENSE_MARGIN, type ContextModel, type ContextSentenceIn } from './contextModel.js';

// The translation context step (scripts/context/enrich.py behind the
// ContextModel interface): sentence translations are stored in the resolved
// document, and a token's dictionary sense switches only when the
// translation clearly favours another sense of the SAME entry.

function makeTokenizer(tokens: any[]) {
  return { name: 'fake', ready: async () => {}, segment: async () => tokens } as any;
}

const dict = {
  lookup: async (word: string) =>
    ({
      猫: { meaning: 'cat, feline', reading: 'ねこ', meanings: ['cat', 'feline', 'shamisen', 'geisha'], senseSizes: [2, 1, 1] },
      読む: { meaning: 'to read', reading: 'よむ' },
    } as any)[word] ?? null,
};

const TEXT = '猫が読みました。猫';
const TOKENS = [
  { surface: '猫', baseForm: '猫', pos: '名詞', reading: 'ねこ', posDetail: ['名詞', '普通名詞', '一般'] },
  { surface: 'が', baseForm: 'が', pos: '助詞', reading: 'が', posDetail: ['助詞', '格助詞'] },
  { surface: '読みました', baseForm: '読む', pos: '動詞', reading: 'よみました', posDetail: ['動詞', '一般'] },
  { surface: '。', baseForm: '。' },
  { surface: '猫', baseForm: '猫', pos: '名詞', reading: 'ねこ', posDetail: ['名詞', '普通名詞', '一般'] },
];

function fakeContext(simsPerSentence: number[][]): ContextModel & { requests: ContextSentenceIn[][] } {
  const requests: ContextSentenceIn[][] = [];
  return {
    requests,
    async enrich(sentences) {
      requests.push(sentences);
      return sentences.map((s, i) => ({
        translation: `EN(${s.text})`,
        candidates: s.candidates.map(() => ({ aligned: ['x'], sims: simsPerSentence[i] })),
      }));
    },
  };
}

describe('chooseSense', () => {
  it('keeps sense 0 unless another sense beats it by the margin', () => {
    expect(chooseSense([0.5, 0.5 + SENSE_MARGIN / 2])).toBe(0);
    expect(chooseSense([0.5, 0.5 + SENSE_MARGIN + 0.01, 0.55])).toBe(1);
    expect(chooseSense([0.2, 0.1, 0.9])).toBe(2);
    expect(chooseSense([])).toBe(0);
  });

  it('never jumps past the 4th sense (deep senses were wrong 4 times in 5 on graded text)', () => {
    expect(chooseSense([0.3, 0.3, 0.3, 0.3, 0.3, 0.3, 0.9])).toBe(0);
    expect(chooseSense([0.3, 0.3, 0.3, 0.9, 0.3, 0.95])).toBe(3);
  });

  it('keeps sense 0 when an aligned English word already appears in its glosses', () => {
    // 星 aligned to "stars": sense 1 "star" already fits, so the closer
    // embedding of "star (actor, player, etc.)" must not win.
    const senses = [['star', 'any light-emitting celestial body'], ['spot'], ['star (actor, player, etc.)']];
    expect(chooseSense([0.6, 0.2, 0.9], ['stars', 'shining'], senses)).toBe(0);
    expect(chooseSense([0.6, 0.2, 0.9], ['actor', 'famous'], senses)).toBe(2);
  });
});

describe('resolveContent with a context model', { timeout: 30000 }, () => {
  it('stores one translation per sentence', async () => {
    const ctx = fakeContext([[0.6, 0.5, 0.5], [0.6, 0.5, 0.5]]);
    const r: any = await resolveContent(TEXT, makeTokenizer(TOKENS), new WordResolver(dict), undefined, undefined, ctx);
    expect(r.sentences.map((s: any) => [TEXT.slice(s.start, s.end), s.translation])).toEqual([
      ['猫が読みました。', 'EN(猫が読みました。)'],
      ['猫', 'EN(猫)'],
    ]);
  });

  it('sends only content words with several senses, with spans relative to the sentence', async () => {
    const ctx = fakeContext([[0.6, 0.5, 0.5], [0.6, 0.5, 0.5]]);
    await resolveContent(TEXT, makeTokenizer(TOKENS), new WordResolver(dict), undefined, undefined, ctx);
    const sent = ctx.requests[0];
    expect(sent[0].candidates).toEqual([{ start: 0, end: 1, senses: [['cat', 'feline'], ['shamisen'], ['geisha']] }]);
    expect(sent[1].candidates).toEqual([{ start: 0, end: 1, senses: [['cat', 'feline'], ['shamisen'], ['geisha']] }]);
  });

  it('switches only the occurrence whose translation favours another sense', async () => {
    const ctx = fakeContext([[0.3, 0.2, 0.9], [0.6, 0.5, 0.55]]);
    const r = await resolveContent(TEXT, makeTokenizer(TOKENS), new WordResolver(dict), undefined, undefined, ctx);
    const first = r.words[r.tokens[0].wordIndex!];
    const second = r.words[r.tokens[4].wordIndex!];
    expect(first.meaning).toBe('geisha (also: cat)');
    expect(second.meaning).toBe('cat, feline');
  });

  it('resolves exactly as before without a context model', async () => {
    const r: any = await resolveContent(TEXT, makeTokenizer(TOKENS), new WordResolver(dict));
    expect(r.sentences).toBeUndefined();
    expect(r.words[r.tokens[0].wordIndex].meaning).toBe('cat, feline');
  });
  it('recognises a split katakana name from the translations (ゾル|タン → Zoltan)', async () => {
    const text = 'ゾルタンに来た。';
    const tokens = [
      { surface: 'ゾル', baseForm: 'ゾル', pos: '名詞', reading: 'ぞる', posDetail: ['名詞', '普通名詞', '一般'] },
      { surface: 'タン', baseForm: 'タン', pos: '名詞', reading: 'たん', posDetail: ['名詞', '普通名詞', '一般'] },
      { surface: 'に', baseForm: 'に', pos: '助詞', reading: 'に', posDetail: ['助詞', '格助詞'] },
      { surface: '来た', baseForm: '来る', pos: '動詞', reading: 'きた', posDetail: ['動詞', '一般'] },
      { surface: '。', baseForm: '。' },
    ];
    const ctx = { ...fakeContext([[]]), translate: async (texts: string[]) => texts.map(() => 'We came to Zoltan.') };
    const r = await resolveContent(text, makeTokenizer(tokens), new WordResolver(dict), undefined, undefined, ctx);
    expect(r.tokens[0].surface).toBe('ゾルタン');
    expect(r.words[r.tokens[0].wordIndex!].meaning).toBe('Zoltan (name)');
  });
  it('does not switch kana-only spellings (かぜ stays "wind"; graded 13 wrong of 13 on corpus stories)', async () => {
    const text = 'かぜがふく';
    const tokens = [
      { surface: 'かぜ', baseForm: '風', pos: '名詞', reading: 'かぜ', posDetail: ['名詞', '普通名詞', '一般'] },
      { surface: 'が', baseForm: 'が', pos: '助詞', reading: 'が', posDetail: ['助詞', '格助詞'] },
      { surface: 'ふく', baseForm: '吹く', pos: '動詞', reading: 'ふく', posDetail: ['動詞', '一般'] },
    ];
    const kanaDict = { lookup: async (w: string) => (w === '風' ? { meaning: 'wind', reading: 'かぜ', meanings: ['wind', 'cold'], senseSizes: [1, 1] } : null) };
    const ctx = fakeContext([[0.2, 0.9]]);
    const r = await resolveContent(text, makeTokenizer(tokens), new WordResolver(kanaDict), undefined, undefined, ctx);
    expect(ctx.requests[0][0].candidates).toEqual([]);
    expect(r.words[r.tokens[0].wordIndex!].meaning).toBe('wind');
  });

  it('a single katakana dictionary word is not renamed from a capitalised translation (カバン "bag")', async () => {
    const text = 'カバンを持つ。';
    const tokens = [
      { surface: 'カバン', baseForm: 'カバン', pos: '名詞', reading: 'かばん', posDetail: ['名詞', '普通名詞', '一般'] },
      { surface: 'を', baseForm: 'を', pos: '助詞', reading: 'を', posDetail: ['助詞', '格助詞'] },
      { surface: '持つ', baseForm: '持つ', pos: '動詞', reading: 'もつ', posDetail: ['動詞', '一般'] },
      { surface: '。', baseForm: '。' },
    ];
    const ctx = { ...fakeContext([[]]), translate: async (t: string[]) => t.map(() => 'I hold the Kaban.') };
    const r = await resolveContent(text, makeTokenizer(tokens), new WordResolver(dict), undefined, undefined, ctx);
    expect(r.words[r.tokens[0].wordIndex!].meaning).not.toMatch(/\(name\)/);
  });
});


// Trained sense scorer (Japanese sentence + token + English translation ->
// sense of the chosen entry). Fresh-sample review on 100 unseen corpus
// items: confident (p >= 0.8) same-entry switches went 92 better / 29 worse.
describe('trained sense scorer (probs from the helper)', { timeout: 30000 }, () => {
  it('chooseSenseByModel switches only on a confident non-first sense', async () => {
    const { chooseSenseByModel } = await import('./contextModel.js');
    expect(chooseSenseByModel([0.1, 0.85, 0.05])).toBe(1);
    expect(chooseSenseByModel([0.3, 0.6, 0.1])).toBe(0);
    expect(chooseSenseByModel([0.9, 0.1])).toBe(0);
  });

  const info = (n: number) => Array.from({ length: n }, (_, k) => ({ index: k, misc: [], common: true, primary: true }));
  const sDict = {
    lookup: async (w: string) =>
      ({
        凄い: { meaning: 'terrible, dreadful', reading: 'すごい', meanings: ['terrible', 'dreadful', 'amazing', 'great'], senseSizes: [2, 2], senseInfo: info(2) },
        仕舞う: { meaning: 'to finish', reading: 'しまう', meanings: ['to finish', 'to do completely'], senseSizes: [1, 1], senseInfo: info(2) },
      } as any)[w] ?? null,
  };
  function probsContext(probs: number[]) {
    const requests: ContextSentenceIn[][] = [];
    return {
      requests,
      async enrich(sentences: ContextSentenceIn[]) {
        requests.push(sentences);
        return sentences.map((s) => ({ translation: 'EN', candidates: s.candidates.map(() => ({ aligned: [], sims: [0, 0], probs })) }));
      },
    } as ContextModel & { requests: ContextSentenceIn[][] };
  }

  it('sends kana words with their sense info and switches on the model\'s confident pick', async () => {
    const text = 'すごい';
    const tokens = [{ surface: 'すごい', baseForm: '凄い', pos: '形容詞', reading: 'すごい', posDetail: ['形容詞', '一般'] }];
    const ctx = probsContext([0.05, 0.95]);
    const r = await resolveContent(text, makeTokenizer(tokens), new WordResolver(sDict), undefined, undefined, ctx);
    expect(ctx.requests[0][0].candidates[0].info).toEqual(info(2));
    expect(r.words[r.tokens[0].wordIndex!].meaning).toBe('amazing, great (also: terrible)');
  });

  it('never sends helper verbs (〜てしまう "do completely" is not "to finish")', async () => {
    const text = 'たべてしまう';
    const tokens = [
      { surface: 'たべて', baseForm: '食べる', pos: '動詞', reading: 'たべて', posDetail: ['動詞', '一般'] },
      { surface: 'しまう', baseForm: '仕舞う', pos: '動詞', reading: 'しまう', posDetail: ['動詞', '非自立可能'] },
    ];
    const ctx = probsContext([0.05, 0.95]);
    await resolveContent(text, makeTokenizer(tokens), new WordResolver(sDict), undefined, undefined, ctx);
    expect(ctx.requests[0][0].candidates).toEqual([]);
  });
});

describe('trained scorer adds to the embedding-margin switch (does not replace it)', { timeout: 30000 }, () => {
  it('keeps the margin switch when the scorer is not confident (遅い "late" stays)', async () => {
    const lateDict = { lookup: async (w: string) => (w === '遅い' ? { meaning: 'slow', reading: 'おそい', meanings: ['slow', 'late'], senseSizes: [1, 1], senseInfo: [{ index: 0, misc: [], common: true, primary: true }, { index: 1, misc: [], common: true, primary: true }] } : null) };
    const tokens = [{ surface: '遅い', baseForm: '遅い', pos: '形容詞', reading: 'おそい', posDetail: ['形容詞', '一般'] }];
    const ctx: ContextModel = {
      async enrich(sentences) {
        return sentences.map((s) => ({ translation: 'It is late.', candidates: s.candidates.map(() => ({ aligned: ['late'], sims: [0.2, 0.9], probs: [0.6, 0.4] })) }));
      },
    };
    const r = await resolveContent('遅い', makeTokenizer(tokens), new WordResolver(lateDict), undefined, undefined, ctx);
    expect(r.words[r.tokens[0].wordIndex!].meaning).toBe('late (also: slow)');
  });
});
