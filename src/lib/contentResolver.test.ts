import { describe, it, expect } from 'vitest';
import {
  resolveContent,
  buildStoryResponse,
  buildWordsResponse,
  RESOLVED_FORMAT_VERSION,
} from './contentResolver.js';
import { WordResolver } from './wordResolver.js';

// A fake tokenizer that returns pre-baked TokenInfo for a known text, so the
// tests exercise classification/structure without the 200MB WASM.
function makeTokenizer(tokens: any[]) {
  return {
    name: 'fake',
    ready: async () => {},
    segment: async () => tokens,
  } as any;
}

const dict = {
  lookup: async (word: string) =>
    ({
      猫: { meaning: 'cat', reading: 'ねこ' },
      読む: { meaning: 'to read', reading: 'よむ' },
    } as any)[word] ?? null,
};

// 猫が読みました。猫! — two 猫 occurrences, particle, grouped verb, punctuation
const TEXT = '猫が読みました。猫';
const TOKENS = [
  { surface: '猫', baseForm: '猫', pos: '名詞', reading: 'ねこ' },
  { surface: 'が', baseForm: 'が', pos: '助詞', reading: 'が' },
  { surface: '読みました', baseForm: '読む', pos: '動詞', reading: 'よみました' },
  { surface: '。', baseForm: '。' },
  { surface: '猫', baseForm: '猫', pos: '名詞', reading: 'ねこ' },
];

describe('resolveContent', { timeout: 30000 }, () => {
  it('produces positioned tokens, deduplicated words, and frequencies', async () => {
    const resolved = await resolveContent(TEXT, makeTokenizer(TOKENS), new WordResolver(dict));

    expect(resolved.formatVersion).toBe(RESOLVED_FORMAT_VERSION);

    // 5 input tokens → 5 positioned tokens (punctuation kept for layout)
    expect(resolved.tokens.length).toBe(5);
    expect(resolved.tokens[0]).toMatchObject({ surface: '猫', startIndex: 0, endIndex: 1 });
    expect(resolved.tokens[4]).toMatchObject({ surface: '猫', startIndex: 8, endIndex: 9 });

    // words deduplicated: 猫, が, 読みました — punctuation excluded
    const wordList = resolved.words.map((w) => w.word);
    expect(wordList).toEqual(['猫', 'が', '読みました']);

    // 猫 appears twice
    expect(resolved.words[0].frequencyInContent).toBe(2);
    expect(resolved.words[0].meaning).toBe('cat');

    // が is a grammar morpheme with zero score
    expect(resolved.words[1]).toMatchObject({ isMorpheme: true, score: 0 });
    expect(resolved.words[1].meaning).toMatch(/subject/i);

    // grouped verb resolves through the dictionary with its surface reading
    expect(resolved.words[2].meaning).toBe('to read');
    expect(resolved.words[2].reading).toBe('よみました');
  });

  it('every Japanese token points at a word entry; punctuation points nowhere', async () => {
    const resolved = await resolveContent(TEXT, makeTokenizer(TOKENS), new WordResolver(dict));
    for (const t of resolved.tokens) {
      if (t.surface === '。') {
        expect(t.wordIndex).toBeUndefined();
        expect(t.isVocabWord).toBe(false);
      } else {
        expect(t.wordIndex).toBeDefined();
        expect(t.isVocabWord).toBe(true);
        expect(resolved.words[t.wordIndex!].word).toBe(t.surface);
      }
    }
  });

  it('is deterministic: two runs produce identical JSON', async () => {
    const a = await resolveContent(TEXT, makeTokenizer(TOKENS), new WordResolver(dict));
    const b = await resolveContent(TEXT, makeTokenizer(TOKENS), new WordResolver(dict));
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

describe('buildStoryResponse / buildWordsResponse', () => {
  it('story response inlines wordInfo per token (the /api/process-story shape)', async () => {
    const resolved = await resolveContent(TEXT, makeTokenizer(TOKENS), new WordResolver(dict));
    const story = buildStoryResponse(resolved);
    expect(story.length).toBe(5);
    expect(story[0].wordInfo.meaning).toBe('cat');
    expect(story[1].wordInfo.isMorpheme).toBe(true);
    expect(story[3].wordInfo).toBeUndefined(); // 。
    // wordIndex is an internal detail — not leaked to the API shape
    expect(story[0].wordIndex).toBeUndefined();
  });

  it('words response excludes generic single-kana fallback entries', async () => {
    // ゃ: single kana, not in the morpheme table → fallback entry in words,
    // hoverable in the reader but not part of the vocab list.
    const tokens = [
      { surface: '猫', baseForm: '猫', pos: '名詞', reading: 'ねこ' },
      { surface: 'ゅ', baseForm: 'ゅ' },
    ];
    const resolved = await resolveContent('猫ゅ', makeTokenizer(tokens), new WordResolver(dict));
    expect(resolved.words.length).toBe(2);
    const vocab = buildWordsResponse(resolved);
    expect(vocab.map((w: any) => w.word)).toEqual(['猫']);
    // ...but the reader still shows something on hover
    const story = buildStoryResponse(resolved);
    expect(story[1].wordInfo.meaning).toBe('Kana particle / expression');
  });
});
