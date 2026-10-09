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
});
