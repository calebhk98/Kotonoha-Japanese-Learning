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
  // The vocab summary lists every meaning the text actually uses: 方 read
  // かた "person" in one sentence and ほう "direction" in another are two
  // rows, but the same meaning in several contexts is one row, and each
  // row counts the occurrences of that meaning.
  const doc = (words: any[], tokenWords: number[]) => ({
    formatVersion: 1,
    words,
    tokens: tokenWords.map((wordIndex, i) => ({ surface: words[wordIndex].word, startIndex: i, endIndex: i + 1, isVocabWord: true, isMorpheme: false, wordIndex })),
  });

  it('words response keeps one row per (word, meaning)', () => {
    const resolved = doc(
      [
        { word: '方', reading: 'かた', meaning: 'person' },
        { word: '方', reading: 'ほう', meaning: 'direction' },
        { word: '方', reading: 'かた', meaning: 'person' }, // same meaning, other context
      ],
      [0, 1, 2, 1]
    );
    const vocab = buildWordsResponse(resolved as any);
    expect(vocab.map((w: any) => `${w.word}:${w.meaning}`)).toEqual(['方:person', '方:direction']);
  });

  it('words response counts occurrences per meaning', () => {
    const resolved = doc(
      [
        { word: '方', reading: 'かた', meaning: 'person' },
        { word: '方', reading: 'ほう', meaning: 'direction' },
        { word: '方', reading: 'かた', meaning: 'person' },
      ],
      [0, 1, 2, 1, 1]
    );
    const vocab = buildWordsResponse(resolved as any);
    expect(vocab.map((w: any) => w.frequencyInContent)).toEqual([2, 3]);
  });
});

// Graded on 100 random corpus items (70 of them carry furigana in the text):
// 行（い）きました was tokenized as 行 "Kō" + きました "came".
describe('furigana in parentheses', { timeout: 30000 }, () => {
  it('tokenizes the text without the furigana and maps tokens back onto the original', async () => {
    const text = '山へ行（い）きました。猫（ねこ）が';
    const seen: string[] = [];
    const tokenizer = {
      name: 'fake',
      ready: async () => {},
      segment: async (t: string) => {
        seen.push(t);
        return [
          { surface: '山', baseForm: '山', pos: '名詞', reading: 'やま' },
          { surface: 'へ', baseForm: 'へ', pos: '助詞', reading: 'へ' },
          { surface: '行きました', baseForm: '行く', pos: '動詞', reading: 'いきました' },
          { surface: '。', baseForm: '。' },
          { surface: '猫', baseForm: '猫', pos: '名詞', reading: 'ねこ' },
          { surface: 'が', baseForm: 'が', pos: '助詞', reading: 'が' },
        ];
      },
    } as any;
    const resolved = await resolveContent(text, tokenizer, new WordResolver(dict));
    expect(seen).toEqual(['山へ行きました。猫が']);
    for (const t of resolved.tokens) expect(text.slice(t.startIndex, t.endIndex)).toBe(t.surface);
    const verb = resolved.tokens.find((t) => t.surface.startsWith('行'))!;
    expect(verb.surface).toBe('行（い）きました');
    expect(resolved.words[verb.wordIndex!].word).toBe('行きました');
    // Furigana between words stays plain text, outside any token.
    expect(resolved.tokens.map((t) => t.surface)).toContain('猫');
    expect(resolved.tokens.find((t) => t.surface === 'が')!.startIndex).toBe(text.indexOf('が'));
  });
});

// Reader test on 9 stories: "to eat" appeared as 8 separate study rows (one
// per conjugated form), and a beginner can't tell they are one verb.
describe('vocab list grouped by dictionary form', () => {
  it('one row per dictionary form + meaning, listing every form used with its count and note', () => {
    const resolved: any = {
      formatVersion: RESOLVED_FORMAT_VERSION,
      words: [
        { word: '食べた', reading: 'たべた', meaning: 'to eat', lemma: '食べる', lemmaReading: 'たべる', form: 'past' },
        { word: '食べます', reading: 'たべます', meaning: 'to eat', lemma: '食べる', lemmaReading: 'たべる', form: 'polite' },
        { word: '猫', reading: 'ねこ', meaning: 'cat' },
      ],
      tokens: [
        { surface: '食べた', wordIndex: 0 }, { surface: '食べた', wordIndex: 0 }, { surface: '食べた', wordIndex: 0 },
        { surface: '食べます', wordIndex: 1 }, { surface: '猫', wordIndex: 2 },
      ],
    };
    const rows = buildWordsResponse(resolved);
    const eat = rows.find((r: any) => r.word === '食べる');
    expect(eat).toMatchObject({ reading: 'たべる', meaning: 'to eat', frequencyInContent: 4 });
    expect(eat.forms).toEqual([
      { word: '食べた', reading: 'たべた', form: 'past', count: 3 },
      { word: '食べます', reading: 'たべます', form: 'polite', count: 1 },
    ]);
    expect(rows.find((r: any) => r.word === '猫').forms).toBeUndefined();
  });
});

// Vocab-list review of four imported texts: one word showed up as several
// rows (し / した / して / したら / する, ある / あった / あり, みどり ×3,
// いう / 言う, すごい ×2).
describe('vocab list: one word, one row', () => {
  const doc = (words: any[], tokenWords: number[]): any => ({
    formatVersion: RESOLVED_FORMAT_VERSION,
    words,
    tokens: tokenWords.map((wordIndex, i) => ({ surface: words[wordIndex].word, startIndex: i, endIndex: i + 1, isVocabWord: true, isMorpheme: false, wordIndex })),
  });

  it('conjugated forms of a verb the grammar table labels share one row under the dictionary form', () => {
    const label = 'form of する "to do"';
    const rows = buildWordsResponse(doc(
      [
        { word: 'し', reading: 'し', meaning: label, isMorpheme: true, lemma: 'する', lemmaReading: 'する' },
        { word: 'した', reading: 'した', meaning: label, isMorpheme: true, lemma: 'する', lemmaReading: 'する' },
        { word: 'して', reading: 'して', meaning: label, isMorpheme: true, lemma: 'する', lemmaReading: 'する' },
        { word: 'する', reading: 'する', meaning: label, isMorpheme: true },
      ],
      [0, 0, 1, 2, 3]
    ));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ word: 'する', frequencyInContent: 5 });
    expect(rows[0].forms.map((f: any) => f.word).sort()).toEqual(['した', 'して', 'し', 'する'].sort());
  });

  it('a sense switched by the translation is the same row as the entry it came from', () => {
    const entry = ['amazing', 'terrible'];
    const rows = buildWordsResponse(doc(
      [
        { word: 'すごい', reading: 'すごい', meaning: 'amazing (also: terrible)', meanings: entry, senseSizes: [1, 1] },
        { word: 'すごい', reading: 'すごい', meaning: 'terrible (also: amazing)', meanings: [...entry].reverse(), senseSizes: [1, 1], contextSense: 1 },
      ],
      [0, 1, 1]
    ));
    expect(rows).toHaveLength(1);
    expect(rows[0].frequencyInContent).toBe(3);
  });

  it('a verb written in kana and in kanji with the same reading and meaning is one row', () => {
    const rows = buildWordsResponse(doc(
      [
        { word: '言った', reading: 'いった', meaning: 'to say', lemma: '言う', lemmaReading: 'いう', form: 'past' },
        { word: 'いう', reading: 'いう', meaning: 'to say' },
      ],
      [0, 1, 1]
    ));
    expect(rows).toHaveLength(1);
    expect(rows[0].frequencyInContent).toBe(3);
  });

  it('keeps homographs with different readings apart', () => {
    const rows = buildWordsResponse(doc(
      [
        { word: '方', reading: 'かた', meaning: 'person' },
        { word: '方', reading: 'ほう', meaning: 'person' },
      ],
      [0, 1]
    ));
    expect(rows).toHaveLength(2);
  });

  it('resolveContent: する forms (grammar-table verbs) are filed under the dictionary form', async () => {
    const text = 'したしました';
    const verb = (surface: string, reading: string) => ({
      surface, baseForm: '為る', pos: '動詞', reading, dictionaryForm: 'する', lemmaSurface: 'する',
      posDetail: ['動詞', '非自立可能', '*', '*', 'サ行変格', '連用形-一般'],
    });
    const resolved = await resolveContent(text, makeTokenizer([verb('した', 'した'), verb('しました', 'しました')]), new WordResolver(dict));
    const rows = buildWordsResponse(resolved);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ word: 'する', frequencyInContent: 2 });
  });

  it('resolveContent: a set phrase resolved from the inflected surface keeps its own row (かかわらず is not かかわる)', async () => {
    const phraseDict = {
      lookup: async (w: string) => ({ かかわる: { meaning: 'to be concerned with', reading: 'かかわる' } } as any)[w] ?? null,
      hasForm: async () => false,
      expression: async (w: string) => (w === 'かかわらず' ? { reading: 'かかわらず', gloss: 'in spite of, despite' } : null),
    };
    const resolver = new WordResolver(phraseDict as any);
    // WordResolver.expression is the lookup the early set-phrase return uses
    (resolver as any).expression = async (w: string) => (w === 'かかわらず' ? { reading: 'かかわらず', gloss: 'in spite of, despite' } : null);
    const tok = {
      surface: 'かかわらず', baseForm: '関わる', pos: '動詞', reading: 'かかわらず', dictionaryForm: 'かかわる', lemmaSurface: 'かかわる',
      posDetail: ['動詞', '一般', '*', '*', '五段-ラ行', '未然形-一般'],
      parts: [{ surface: 'かかわら', norm: '関わる', pos: '動詞', conj: '未然形-一般' }, { surface: 'ず', norm: 'ず', pos: '助動詞', conj: '終止形-一般' }],
    };
    const resolved = await resolveContent('かかわらず', makeTokenizer([tok]), resolver);
    const rows = buildWordsResponse(resolved);
    expect(rows).toHaveLength(1);
    expect(rows[0].word).toBe('かかわらず');
    expect(rows[0].meaning).toMatch(/in spite of/);
  });
});
