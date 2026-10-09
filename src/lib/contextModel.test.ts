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
      額: { meaning: '(picture) frame', reading: 'がく', meanings: ['(picture) frame', 'amount'], senseSizes: [1, 1] },
    } as any)[word] ?? null,
  // Other JMDict entries written the same way (homographs).
  alternativeEntries: async (word: string) =>
    word === '額' ? [{ reading: 'ひたい', senses: [['forehead', 'brow']] }] : [],
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
});

describe('resolveContent with a context model', () => {
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

  it('can switch to another entry of the same spelling, with its reading (額 がく → ひたい)', async () => {
    const text = '額に汗';
    const tokens = [
      { surface: '額', baseForm: '額', pos: '名詞', reading: 'がく', posDetail: ['名詞', '普通名詞', '一般'] },
      { surface: 'に', baseForm: 'に', pos: '助詞', reading: 'に', posDetail: ['助詞', '格助詞'] },
      { surface: '汗', baseForm: '汗', pos: '名詞', reading: 'あせ', posDetail: ['名詞', '普通名詞', '一般'] },
    ];
    // senses sent: [frame], [amount], then the other entry's [forehead, brow]
    const ctx = fakeContext([[0.48, 0.49, 0.9]]);
    const r = await resolveContent(text, makeTokenizer(tokens), new WordResolver(dict), undefined, undefined, ctx);
    expect(ctx.requests[0][0].candidates[0].senses).toEqual([['(picture) frame'], ['amount'], ['forehead', 'brow']]);
    const w = r.words[r.tokens[0].wordIndex!];
    expect(w.meaning).toBe('forehead, brow');
    expect(w.reading).toBe('ひたい');
  });
});

