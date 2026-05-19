import { describe, it, expect } from 'vitest';
import { getEnglishGlosses, getSenseCommonness, DictionaryManager } from './dictionary';
import { getMorphemeDefinition } from './morphemeDefinitions';

// ---------------------------------------------------------------------------
// #186 – Language filtering: getEnglishGlosses
//
// Before the fix, JmdictDictionary.lookup() had:
//
//   if (glossTexts.length > 0) { meanings.push(...glossTexts); }
//   else if (sense.gloss[0]?.text) { meanings.push(sense.gloss[0].text); }  // ← BUG
//
// The "else if" pushed sense.gloss[0].text without checking g.lang, so JMDict
// senses that have German or Spanish glosses but no English ones would return a
// non-English definition as the primary meaning.
// ---------------------------------------------------------------------------

describe('getEnglishGlosses – #186 language filtering', () => {
  it('returns empty array when the sense has only non-English glosses', () => {
    // Before fix: sense.gloss[0].text ('Katze') would be returned as a definition
    const sense = {
      gloss: [
        { text: 'Katze', lang: 'ger' },
        { text: 'gato', lang: 'spa' },
      ],
    };
    expect(getEnglishGlosses(sense)).toEqual([]);
  });

  it('filters out non-English entries when glosses are mixed languages', () => {
    const sense = {
      gloss: [
        { text: 'Katze', lang: 'ger' },
        { text: 'cat', lang: 'en' },
        { text: 'chat', lang: 'fre' },
      ],
    };
    expect(getEnglishGlosses(sense)).toEqual(['cat']);
  });

  it('returns all English glosses when all entries are English', () => {
    const sense = {
      gloss: [
        { text: 'cat', lang: 'en' },
        { text: 'kitty', lang: 'en' },
      ],
    };
    expect(getEnglishGlosses(sense)).toEqual(['cat', 'kitty']);
  });

  it('returns empty array for a sense with no glosses', () => {
    expect(getEnglishGlosses({ gloss: [] })).toEqual([]);
  });

  it('returns empty array when sense has no gloss field at all', () => {
    expect(getEnglishGlosses({})).toEqual([]);
  });

  it('preserves original order of English glosses', () => {
    const sense = {
      gloss: [
        { text: 'cute', lang: 'en' },
        { text: 'adorable', lang: 'en' },
        { text: 'hübsch', lang: 'ger' },
        { text: 'lovely', lang: 'en' },
      ],
    };
    expect(getEnglishGlosses(sense)).toEqual(['cute', 'adorable', 'lovely']);
  });
});

// ---------------------------------------------------------------------------
// #187 – Sense ordering: getSenseCommonness
//
// Before the fix, getSenseCommonness only scanned gloss *text* for strings like
// "rare" or "archaic". JMDict encodes those markers in a structured `misc` array
// (e.g. misc: ['sl'] for slang, misc: ['arch'] for archaic). Because the old code
// never read sense.misc, slang / archaic senses scored identically to everyday
// senses and could sort to the top.
//
// Real examples that were broken:
//   猫 (neko) – first JMDict sense is unmarked "cat", second has misc:['sl']
//     "submissive partner". Old code: tied score → both could surface as primary.
//   桜 (sakura) – "hired applauder" sense has misc:['arch'].
//   可愛い (kawaii) – "cute/adorable" sense should outscore "dainty/tiny".
// ---------------------------------------------------------------------------

describe('getSenseCommonness – #187 slang / archaic detection', () => {
  it('gives lower score to a slang sense (misc: ["sl"])', () => {
    const slangSense = {
      gloss: [{ text: 'submissive partner (in a male-male relationship)', lang: 'en' }],
      misc: ['sl'],
    };
    const commonSense = {
      gloss: [{ text: 'cat', lang: 'en' }],
      misc: [],
    };
    expect(getSenseCommonness(slangSense)).toBeLessThan(getSenseCommonness(commonSense));
  });

  it('gives lower score to an archaic sense (misc: ["arch"])', () => {
    const archaicSense = {
      gloss: [{ text: 'hired applauder', lang: 'en' }],
      misc: ['arch'],
    };
    const commonSense = {
      gloss: [{ text: 'cherry blossom', lang: 'en' }],
      misc: [],
    };
    expect(getSenseCommonness(archaicSense)).toBeLessThan(getSenseCommonness(commonSense));
  });

  it('gives lower score to an obsolete sense (misc: ["obs"])', () => {
    const obsSense = { gloss: [{ text: 'old usage', lang: 'en' }], misc: ['obs'] };
    const normalSense = { gloss: [{ text: 'normal usage', lang: 'en' }], misc: [] };
    expect(getSenseCommonness(obsSense)).toBeLessThan(getSenseCommonness(normalSense));
  });

  it('gives lower score to a rare sense (misc: ["rare"])', () => {
    const rareSense = { gloss: [{ text: 'rare sense', lang: 'en' }], misc: ['rare'] };
    const normalSense = { gloss: [{ text: 'cute', lang: 'en' }], misc: [] };
    expect(getSenseCommonness(rareSense)).toBeLessThan(getSenseCommonness(normalSense));
  });

  it('gives lower score to vulgar / rude senses (misc: ["vulg"] / ["X"])', () => {
    const vulgSense = { gloss: [{ text: 'rude term', lang: 'en' }], misc: ['vulg'] };
    const xSense = { gloss: [{ text: 'x-rated term', lang: 'en' }], misc: ['X'] };
    const normalSense = { gloss: [{ text: 'normal term', lang: 'en' }], misc: [] };
    expect(getSenseCommonness(vulgSense)).toBeLessThan(getSenseCommonness(normalSense));
    expect(getSenseCommonness(xSense)).toBeLessThan(getSenseCommonness(normalSense));
  });

  it('gives lower score to idiomatic senses that are domain-restricted', () => {
    const domainSense = {
      gloss: [{ text: 'technical computing term', lang: 'en' }],
      misc: [],
      field: ['comp'],
    };
    const commonSense = {
      gloss: [{ text: 'common everyday word', lang: 'en' }],
      misc: [],
      field: [],
    };
    expect(getSenseCommonness(domainSense)).toBeLessThan(getSenseCommonness(commonSense));
  });

  it('gives higher score to senses with more English synonyms (well-established meanings)', () => {
    // 可愛い: the "cute/adorable/sweet/charming" sense should beat the sparse "dainty" sense
    const richSense = {
      gloss: [
        { text: 'cute', lang: 'en' },
        { text: 'adorable', lang: 'en' },
        { text: 'charming', lang: 'en' },
      ],
      misc: [],
    };
    const sparseSense = {
      gloss: [{ text: 'dainty', lang: 'en' }],
      misc: [],
    };
    expect(getSenseCommonness(richSense)).toBeGreaterThan(getSenseCommonness(sparseSense));
  });

  it('plain senses with no misc markers score >= 0', () => {
    const plain = { gloss: [{ text: 'cat', lang: 'en' }], misc: [] };
    expect(getSenseCommonness(plain)).toBeGreaterThanOrEqual(0);
  });

  it('slang sense penalty is large enough that extra glosses cannot compensate', () => {
    // Even a slang sense with many synonyms should lose to a plain sense with one gloss
    const slangWithManyGlosses = {
      gloss: [
        { text: 'slang term 1', lang: 'en' },
        { text: 'slang term 2', lang: 'en' },
        { text: 'slang term 3', lang: 'en' },
        { text: 'slang term 4', lang: 'en' },
      ],
      misc: ['sl'],
    };
    const plainOneSense = {
      gloss: [{ text: 'cat', lang: 'en' }],
      misc: [],
    };
    expect(getSenseCommonness(slangWithManyGlosses)).toBeLessThan(getSenseCommonness(plainOneSense));
  });
});

// ---------------------------------------------------------------------------
// #191 – Mixed kanji+kana sense ordering
//
// Issue #191 identified that tests only covered hiragana-only text and had
// no assertions. These tests use realistic JMDict-shaped sense data for the
// specific mixed kanji+kana words called out in the issue (猫, 桜, 可愛い,
// プレゼント, 寝る) and verify that the sense-ranking pipeline correctly
// surfaces everyday meanings as the primary definition.
//
// They also verify the helper that simulates what JmdictDictionary.lookup()
// does internally: sort senses by getSenseCommonness() descending, break
// ties by original JMDict position.
// ---------------------------------------------------------------------------

/** Applies the same stable sort that JmdictDictionary.lookup() uses internally. */
function rankSenses(senses: any[]): any[] {
  return senses
    .map((sense, order) => ({ sense, order, score: getSenseCommonness(sense) }))
    .sort((a, b) => b.score !== a.score ? b.score - a.score : a.order - b.order)
    .map(({ sense }) => sense);
}

describe('mixed kanji+kana sense ordering – real-world cases (#191)', () => {
  // ── 猫 (neko) ──────────────────────────────────────────────────────────────

  it('猫: primary "cat" sense is found (sense was found at all)', () => {
    const catSense = { gloss: [{ text: 'cat', lang: 'en' }], misc: [] };
    const glosses = getEnglishGlosses(catSense);
    expect(glosses.length).toBeGreaterThan(0);
    expect(glosses[0]).toBe('cat');
  });

  it('猫: "cat" ranks above "submissive partner" even when slang appears first in JMDict', () => {
    // JMDict lists the slang sense before the cat sense in some builds.
    const slangFirst = { gloss: [{ text: 'submissive partner', lang: 'en' }], misc: ['sl'] };
    const catSense   = { gloss: [{ text: 'cat', lang: 'en' }], misc: [] };
    const ranked = rankSenses([slangFirst, catSense]);
    expect(getEnglishGlosses(ranked[0])[0]).toBe('cat');
  });

  // ── 桜 (sakura) ────────────────────────────────────────────────────────────

  it('桜: "cherry blossom" ranks above "hired applauder" (archaic)', () => {
    const archFirst   = { gloss: [{ text: 'hired applauder', lang: 'en' }], misc: ['arch'] };
    const cherrySense = {
      gloss: [{ text: 'cherry blossom', lang: 'en' }, { text: 'cherry tree', lang: 'en' }],
      misc: [],
    };
    const ranked = rankSenses([archFirst, cherrySense]);
    expect(getEnglishGlosses(ranked[0])[0]).toBe('cherry blossom');
  });

  // ── 可愛い (kawaii) ────────────────────────────────────────────────────────

  it('可愛い: "cute/adorable" (multi-gloss) ranks above "dainty" (sparse) even when dainty appears first', () => {
    const daintyFirst = { gloss: [{ text: 'dainty', lang: 'en' }], misc: [] };
    const cuteSense = {
      gloss: [
        { text: 'cute', lang: 'en' },
        { text: 'adorable', lang: 'en' },
        { text: 'charming', lang: 'en' },
        { text: 'pretty', lang: 'en' },
      ],
      misc: [],
    };
    const ranked = rankSenses([daintyFirst, cuteSense]);
    expect(getEnglishGlosses(ranked[0])[0]).toBe('cute');
  });

  it('可愛い: primary definition contains "cute" or "adorable" — not a slang/archaic term', () => {
    const senses = [
      { gloss: [{ text: 'dainty', lang: 'en' }], misc: [] },
      { gloss: [{ text: 'cute', lang: 'en' }, { text: 'adorable', lang: 'en' }], misc: [] },
      { gloss: [{ text: 'spoiled child (slang)', lang: 'en' }], misc: ['sl'] },
    ];
    const ranked = rankSenses(senses);
    const primary = getEnglishGlosses(ranked[0])[0];
    expect(['cute', 'adorable']).toContain(primary);
  });

  // ── 寝る (neru) — conjugated verb base form ─────────────────────────────

  it('寝る: "to sleep" sense is found and has no unusual misc markers', () => {
    const sleepSense = {
      gloss: [{ text: 'to sleep (lying down)', lang: 'en' }, { text: 'to go to sleep', lang: 'en' }],
      misc: [],
    };
    expect(getSenseCommonness(sleepSense)).toBeGreaterThanOrEqual(0);
    expect(getEnglishGlosses(sleepSense)).toContain('to sleep (lying down)');
  });

  it('寝る: plain "to sleep" outranks a hypothetical archaic sense', () => {
    const archSense   = { gloss: [{ text: 'to lie in state (archaic)', lang: 'en' }], misc: ['arch'] };
    const sleepSense  = { gloss: [{ text: 'to sleep', lang: 'en' }], misc: [] };
    const ranked = rankSenses([archSense, sleepSense]);
    expect(getEnglishGlosses(ranked[0])[0]).toBe('to sleep');
  });

  // ── プレゼント (katakana loan word) ────────────────────────────────────────

  it('プレゼント: "present/gift" sense has no slang or archaic markers and scores >= 0', () => {
    const giftSense = {
      gloss: [{ text: 'present', lang: 'en' }, { text: 'gift', lang: 'en' }],
      misc: [],
    };
    expect(getSenseCommonness(giftSense)).toBeGreaterThanOrEqual(0);
    expect(getEnglishGlosses(giftSense)).toContain('present');
  });

  // ── Ordering stability: equal-score senses keep original JMDict order ─────

  it('senses with identical scores preserve the original JMDict position order', () => {
    const s1 = { gloss: [{ text: 'first meaning', lang: 'en' }], misc: [] };
    const s2 = { gloss: [{ text: 'second meaning', lang: 'en' }], misc: [] };
    const s3 = { gloss: [{ text: 'third meaning', lang: 'en' }], misc: [] };
    // All three score identically; original order must be preserved.
    const ranked = rankSenses([s1, s2, s3]);
    expect(getEnglishGlosses(ranked[0])[0]).toBe('first meaning');
    expect(getEnglishGlosses(ranked[1])[0]).toBe('second meaning');
    expect(getEnglishGlosses(ranked[2])[0]).toBe('third meaning');
  });

  // ── Grammar words: morpheme definitions must be accessible ─────────────────

  it('です has a morpheme definition (not undefined)', () => {
    // morphemeDefinitions covers common grammar words so the word detail page
    // can return a grammatical explanation instead of a JMnedict proper noun.
    expect(getMorphemeDefinition('です')).toBeDefined();
    expect(getMorphemeDefinition('です')).toMatch(/copula|to be|polite/i);
  });

  it('ます has a morpheme definition (not undefined)', () => {
    expect(getMorphemeDefinition('ます')).toBeDefined();
    expect(getMorphemeDefinition('ます')).toMatch(/polite/i);
  });

  it('ない has a morpheme definition (not undefined)', () => {
    expect(getMorphemeDefinition('ない')).toBeDefined();
    expect(getMorphemeDefinition('ない')).toMatch(/negat/i);
  });
});

// ---------------------------------------------------------------------------
// DictionaryManager – JMnedict fallback for kanji-containing names
//
// The previous DictionaryManager.lookup() only tried the JMnedict fallback for
// pure-hiragana words. Kanji-written names like 和彦 or 山城屋 would fail the
// primary lookup and then skip JMnedict entirely, always returning null (which
// became "Unknown meaning" in WordResolver).  The fix removes the isPureHiragana
// guard so JMnedict is tried for any word the primary dictionary misses.
// ---------------------------------------------------------------------------

describe('DictionaryManager – JMnedict fallback', () => {
  it('tries JMnedict for kanji-containing words when primary returns null', async () => {
    const manager = new DictionaryManager();

    // Inject mock dictionaries directly (TypeScript cast to bypass private fields).
    const primaryMock = { lookup: async (_word: string) => null };
    const jmnedictMock = {
      lookup: async (word: string) =>
        word === '和彦'
          ? { meaning: 'Japanese male given name', reading: 'かずひこ', meanings: ['Japanese male given name'] }
          : null,
    };
    (manager as any).primary = primaryMock;
    (manager as any).fallback1 = jmnedictMock;

    const result = await manager.lookup('和彦');
    expect(result).not.toBeNull();
    expect(result?.meaning).toBe('Japanese male given name');
  });

  it('still returns null when both primary and JMnedict miss the word', async () => {
    const manager = new DictionaryManager();
    const primaryMock = { lookup: async (_word: string) => null };
    const jmnedictMock = { lookup: async (_word: string) => null };
    (manager as any).primary = primaryMock;
    (manager as any).fallback1 = jmnedictMock;

    const result = await manager.lookup('和彦');
    expect(result).toBeNull();
  });
});
