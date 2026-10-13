import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
  buildMaster, splitResolved, joinResolved, splitStandalone, toResolved, masterKey,
  rotateSenses, unrotateSenses, shardOf, serializeMaster, expandWord, contractWord,
  SLIM_FORMAT_VERSION, type MasterEntry,
} from './vocabMaster.js';
import { buildStoryResponse, buildWordsResponse } from './contentResolver.js';

const BD = (priorities: string[] = [], extra: any = {}) => ({
  jlptScore: 15, joyoPenalty: 0, highestGrade: null, freqPenalty: -20, jlptValues: [], gradeValues: [], priorities, ...extra,
});
const EMPTY = { jlptScore: 0, joyoPenalty: 0, highestGrade: null, freqPenalty: 0, jlptValues: [], gradeValues: [], priorities: [] };

// Field order as the resolver emits it (word ... breakdown, form, lemma, lemmaReading, senses, pos, frequency).
const eat = (word: string, reading: string, extra: any = {}) => {
  const { form, lemma, lemmaReading, frequencyInContent, ...rest } = extra;
  return {
    word, reading, meaning: 'to eat', jlpt: 5, joyo: true, score: 12, breakdown: BD(['ichi1']),
    ...(form ? { form } : {}), ...(lemma ? { lemma } : {}), ...(lemmaReading ? { lemmaReading } : {}),
    meanings: ['to eat', 'to live on', 'to make a living'], senseSizes: [1, 2], pos: '動詞',
    ...(frequencyInContent ? { frequencyInContent } : {}),
    ...rest,
  };
};

function doc(words: any[], tokens: any[] = []) {
  return { formatVersion: 1, words, tokens };
}

describe('sense rotation', () => {
  const m = ['a', 'b', 'c', 'd', 'e'];
  const sizes = [2, 1, 2];
  it('unrotate inverts rotate', () => {
    for (const s of [1, 2]) {
      const r = rotateSenses(m, sizes, s)!;
      expect(r.meanings[0]).toBe(s === 1 ? 'c' : 'd');
      const u = unrotateSenses(r.meanings, r.sizes, s)!;
      expect(u.meanings).toEqual(m);
      expect(u.sizes).toEqual(sizes);
    }
  });
  it('is a no-op for sense 0 or out of range', () => {
    expect(rotateSenses(m, sizes, 0)).toBeNull();
    expect(rotateSenses(m, sizes, 9)).toBeNull();
    expect(rotateSenses(m, [1, 1], 1)).toBeNull(); // sizes do not cover meanings
  });
});

describe('masterKey', () => {
  it('is the same for every conjugated form of a lemma', () => {
    const a = eat('食べた', 'たべた', { lemma: '食べる', lemmaReading: 'たべる', form: 'past' });
    const b = eat('食べます', 'たべます', { lemma: '食べる', lemmaReading: 'たべる', form: 'polite' });
    const c = eat('食べる', 'たべる');
    expect(masterKey(a)).toBe(masterKey(b));
    expect(masterKey(a)).toBe(masterKey(c));
  });
  it('separates kana homographs by dictionary entry (priorities / sense layout)', () => {
    const love = { word: 'あい', reading: 'あい', meaning: 'love', jlpt: 5, joyo: true, score: 1, breakdown: BD(['ichi1', 'news1', 'nf02']) };
    const name = { word: 'あい', reading: 'あい', meaning: 'Ai (name)', jlpt: 5, joyo: true, score: 1, breakdown: BD([]) };
    expect(masterKey(love)).not.toBe(masterKey(name));
  });
  it('is unchanged by a context-switched sense', () => {
    const base = { ...eat('作', 'さく'), meanings: ['x', 'y', 'z'], senseSizes: [1, 1, 1] };
    const sw = { ...base, contextSense: 2, meanings: ['z', 'x', 'y'], meaning: 'z (also: x)' };
    expect(masterKey(sw)).toBe(masterKey(base));
  });
  it('keys grammar morphemes by surface only', () => {
    const a = { word: 'で', reading: 'で', meaning: 'copula', jlpt: 0, joyo: false, score: 0, breakdown: EMPTY, isMorpheme: true };
    const b = { ...a, meaning: 'place marker' };
    expect(masterKey(a)).toBe(masterKey(b));
  });
});

describe('split / join', () => {
  const words = [
    eat('食べる', 'たべる', { frequencyInContent: 2 }),
    eat('食べた', 'たべた', { lemma: '食べる', lemmaReading: 'たべる', form: 'past', frequencyInContent: 3 }),
    eat('食べます', 'たべます', { lemma: '食べる', lemmaReading: 'たべる', form: 'polite', frequencyInContent: 1 }),
    { word: 'で', reading: 'で', meaning: 'copula (da)', jlpt: 0, joyo: false, score: 0, breakdown: EMPTY, isMorpheme: true, frequencyInContent: 4 },
    { word: 'で', reading: 'で', meaning: 'at / by (place marker)', jlpt: 0, joyo: false, score: 0, breakdown: EMPTY, isMorpheme: true, frequencyInContent: 4 },
    { word: '作', reading: 'さく', meaning: 'work (also: harvest)', jlpt: 4, joyo: true, score: 17, breakdown: BD(['ichi1'], { jlptScore: 30 }), meanings: ['work', 'piece', 'harvest', 'crop'], senseSizes: [2, 2], pos: '名詞', frequencyInContent: 2 },
    { word: '作', reading: 'さく', meaning: 'harvest, crop (also: work)', jlpt: 4, joyo: true, score: 17, breakdown: BD(['ichi1'], { jlptScore: 30 }), meanings: ['harvest', 'crop', 'work', 'piece'], senseSizes: [2, 2], pos: '名詞', contextSense: 1, frequencyInContent: 1 },
  ];
  const d = doc(words, [{ surface: '食べた', startIndex: 0, endIndex: 3, isVocabWord: true, isMorpheme: false, wordIndex: 1 }]);

  it('round trips exactly (value and JSON text)', () => {
    const { master, slim } = splitStandalone(d);
    const back = joinResolved(slim, master);
    expect(back).toEqual(d);
    expect(JSON.stringify(back)).toBe(JSON.stringify(d));
  });

  it('collapses conjugations and context senses into one master entry', () => {
    const { master, slim } = splitStandalone(d);
    expect(master.size).toBe(3); // 食べる, で, 作 (both 作 occurrences share one entry)
    const eatKey = masterKey(words[0]);
    expect(master.get(eatKey)!.inflects).toBe(true);
    expect(master.get(eatKey)!.word).toBe('食べる');
    // slim entries hold only context data
    expect(slim.words[1]).toEqual({ k: eatKey, word: '食べた', reading: 'たべた', form: 'past', frequencyInContent: 3 });
    // the switched sense is derived from the native sense list: no meaning/meanings stored
    const sw = slim.words[6];
    expect(sw.contextSense).toBe(1);
    expect(sw.meaning).toBeUndefined();
    expect(sw.set).toBeUndefined();
  });

  it('keeps per-context morpheme labels as meaning overrides', () => {
    const { slim } = splitStandalone(d);
    const overrides = slim.words.filter((w) => w.k.startsWith('g|')).map((w) => w.meaning);
    expect(overrides.filter(Boolean).length).toBe(1); // one label is the master default
  });

  it('falls back to set/del patches for anything the master cannot express', () => {
    const odd = { ...eat('食べる', 'たべる'), jlpt: 4, score: 99, extraField: 7 } as any;
    delete odd.pos;
    const master = buildMaster([doc([eat('食べる', 'たべる')])]);
    const slim = splitResolved(doc([odd]), master);
    expect(slim.words[0].set).toMatchObject({ jlpt: 4, score: 99, extraField: 7 });
    expect(slim.words[0].del).toEqual(['pos']);
    expect(joinResolved(slim, master)).toEqual(doc([odd]));
  });

  it('missing key: throws, or embeds a local entry when asked (imports)', () => {
    const master = buildMaster([doc([eat('食べる', 'たべる')])]);
    const imported = doc([{ word: '猫', reading: 'ねこ', meaning: 'cat', jlpt: 5, joyo: true, score: 5, breakdown: BD(['ichi1']), pos: '名詞', frequencyInContent: 1 }]);
    expect(() => splitResolved(imported, master)).toThrow(/no master entry/);
    const slim = splitResolved(imported, master, { embedMissing: true });
    expect(Object.keys(slim.local!)).toEqual([masterKey(imported.words[0])]);
    expect(joinResolved(slim, master)).toEqual(imported);
    // once the master has the entry, the local copy is not needed
    const grown = buildMaster([doc([eat('食べる', 'たべる')]), imported]);
    expect(splitResolved(imported, grown).local).toBeUndefined();
  });

  it('a word-level change in the master reaches every document (the point of the design)', () => {
    const { master, slim } = splitStandalone(d);
    const k = masterKey(words[0]);
    master.set(k, { ...master.get(k)!, score: 40 });
    const joined = joinResolved(slim, master);
    expect(joined.words.filter((w: any) => w.lemma === '食べる' || w.word === '食べる').every((w: any) => w.score === 40)).toBe(true);
    expect(joined.words[3].score).toBe(0); // other words untouched
  });

  it('toResolved accepts both formats', () => {
    const { master, slim } = splitStandalone(d);
    expect(slim.formatVersion).toBe(SLIM_FORMAT_VERSION);
    expect(toResolved(slim, master)).toEqual(d);
    expect(toResolved(d, master)).toBe(d);
  });

  it('expandWord(contractWord(w)) is w for arbitrary field combinations', () => {
    const m: MasterEntry = { word: '食べる', reading: 'たべる', inflects: true, jlpt: 5, joyo: true, score: 1, breakdown: BD() };
    for (const w of [
      { word: '食べる', reading: 'たべる', meaning: 'm', jlpt: 5, joyo: true, score: 1, breakdown: BD() },
      { word: '食べた', reading: 'たべた', meaning: 'm', jlpt: 5, joyo: true, score: 1, breakdown: BD(), lemma: '食べる' }, // lemmaReading missing
      { word: '食べた', reading: 'x', meaning: 'm', jlpt: 5, joyo: true, score: 1, breakdown: BD(), lemma: '別', lemmaReading: 'べつ', form: 'f', frequencyInContent: 2 },
    ]) {
      expect(expandWord(m, contractWord(m, 'k', w))).toEqual(w);
    }
  });
});

describe('shards', () => {
  it('assigns a stable shard from the key alone', () => {
    expect(shardOf('食べる|たべる|ichi1|1.2')).toBe(shardOf('食べる|たべる|ichi1|1.2'));
    expect(shardOf('a')).toMatch(/^[0-9a-f]{2}$/);
  });
  it('serializes one entry per line in key order', () => {
    const m = new Map<string, MasterEntry>([
      ['b', { word: 'b', reading: 'b', jlpt: 5, joyo: true, score: 1, breakdown: BD() }],
      ['a', { word: 'a', reading: 'a', jlpt: 5, joyo: true, score: 1, breakdown: BD() }],
    ]);
    for (const text of serializeMaster(m).values()) {
      const parsed = JSON.parse(text);
      expect(Object.keys(parsed).every((k) => ['a', 'b'].includes(k))).toBe(true);
      const lines = text.trim().split('\n');
      expect(lines.length).toBe(Object.keys(parsed).length + 2);
    }
  });
});

describe('committed artifacts', () => {
  // A handful of real documents: the full 607-document check is
  // scripts/vocab-master-split.ts (kept out of the unit suite for speed).
  const roots = ['src/stories', 'src/music', 'src/videos'].map((r) => path.join(process.cwd(), r));
  const files: string[] = [];
  for (const r of roots) {
    if (!fs.existsSync(r)) continue;
    for (const d of fs.readdirSync(r).sort().slice(0, 4)) {
      const f = path.join(r, d, 'resolved.json');
      if (fs.existsSync(f)) files.push(f);
    }
  }
  const docs = files.map((f) => JSON.parse(fs.readFileSync(f, 'utf-8')));

  it('round trip through a shared master, builders unchanged', () => {
    expect(docs.length).toBeGreaterThan(0);
    const master = buildMaster(docs);
    for (const x of docs) {
      const back = joinResolved(splitResolved(x, master), master);
      expect(JSON.stringify(back)).toBe(JSON.stringify(x));
      expect(buildWordsResponse(back)).toEqual(buildWordsResponse(x));
      expect(buildStoryResponse(back)).toEqual(buildStoryResponse(x));
    }
  });

  it('shares entries across documents', () => {
    const master = buildMaster(docs);
    const total = docs.reduce((n, x) => n + x.words.length, 0);
    expect(master.size).toBeLessThan(total);
  });
});
