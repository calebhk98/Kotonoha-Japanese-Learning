import { describe, it, expect } from 'vitest';
import { getEnglishGlosses, getSenseCommonness, pickBestEntry, DictionaryManager } from './dictionary';
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

  it('does NOT rank multi-gloss senses above single-gloss senses (both unmarked)', () => {
    // Regression: the old +2 "more synonyms" bonus was described as a tiebreaker
    // but acted as the primary ordering signal (most senses have no misc/field
    // markers, so scores were just 0 vs 2). JMDict lists the fundamental sense
    // first, and for common verbs that sense often has a SINGLE gloss:
    //   読む  sense0 ["to read"]  vs sense1 ["to recite (e.g. a sutra)", "to chant"]
    //   食べる sense0 ["to eat"]   vs sense1 ["to live on (e.g. a salary)", ...]
    //   泳ぐ  sense0 ["to swim"]  vs sense2 ["to make one's way through the world", ...]
    // The bonus systematically demoted those primaries. Unmarked senses must
    // score equally so JMDict's own (frequency-informed) order prevails.
    const singleGlossPrimary = {
      gloss: [{ text: 'to read', lang: 'en' }],
      misc: [],
    };
    const multiGlossSecondary = {
      gloss: [
        { text: 'to recite (e.g. a sutra)', lang: 'en' },
        { text: 'to chant', lang: 'en' },
      ],
      misc: [],
    };
    expect(getSenseCommonness(multiGlossSecondary)).toBe(getSenseCommonness(singleGlossPrimary));
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

  it('可愛い: "cute/adorable" stays primary (real JMDict order: cute first, dainty last)', () => {
    // In the actual JMDict data (entry 1577200) "cute/adorable/charming/lovely/
    // pretty" is sense 0 and "dainty/little/tiny" is sense 3 — the previous
    // version of this test fabricated a dainty-first order that doesn't occur,
    // and was used to justify the multi-gloss bonus that broke 読む/食べる/泳ぐ.
    const cuteSense = {
      gloss: [
        { text: 'cute', lang: 'en' },
        { text: 'adorable', lang: 'en' },
        { text: 'charming', lang: 'en' },
        { text: 'pretty', lang: 'en' },
      ],
      misc: ['uk'],
    };
    const daintySense = { gloss: [{ text: 'dainty', lang: 'en' }], misc: ['uk'] };
    const ranked = rankSenses([cuteSense, daintySense]);
    expect(getEnglishGlosses(ranked[0])[0]).toBe('cute');
  });

  it('可愛い: primary definition contains "cute" or "adorable" — not a slang/archaic term', () => {
    // Fixture mirrors real JMDict order (cute is sense 0, dainty sense 3);
    // the point of this test is that a slang sense can never become primary.
    const senses = [
      { gloss: [{ text: 'cute', lang: 'en' }, { text: 'adorable', lang: 'en' }], misc: [] },
      { gloss: [{ text: 'dainty', lang: 'en' }], misc: [] },
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

// ---------------------------------------------------------------------------
// Sense ordering – JMDict native order must be preserved for unmarked senses
//
// JMDict lists the fundamental, most common sense first. The ranking pipeline
// exists only to DEMOTE senses that carry explicit rarity markers (slang,
// archaic, obsolete, …) — it must never reorder plain everyday senses.
// These fixtures mirror the real JMDict sense data for each word.
// ---------------------------------------------------------------------------

describe('sense ordering – single-gloss primary senses stay primary', () => {
  it('読む: "to read" stays above "to recite (e.g. a sutra)"', () => {
    const senses = [
      { gloss: [{ text: 'to read', lang: 'en' }], misc: [] },
      { gloss: [{ text: 'to recite (e.g. a sutra)', lang: 'en' }, { text: 'to chant', lang: 'en' }], misc: [] },
      { gloss: [{ text: 'to predict', lang: 'en' }, { text: 'to guess', lang: 'en' }, { text: 'to forecast', lang: 'en' }], misc: [] },
    ];
    const ranked = rankSenses(senses);
    expect(getEnglishGlosses(ranked[0])[0]).toBe('to read');
  });

  it('食べる: "to eat" stays above "to live on (e.g. a salary)"', () => {
    const senses = [
      { gloss: [{ text: 'to eat', lang: 'en' }], misc: [] },
      { gloss: [{ text: 'to live on (e.g. a salary)', lang: 'en' }, { text: 'to live off', lang: 'en' }, { text: 'to subsist on', lang: 'en' }], misc: [] },
    ];
    const ranked = rankSenses(senses);
    expect(getEnglishGlosses(ranked[0])[0]).toBe('to eat');
  });

  it('泳ぐ: "to swim" stays above "to make one\'s way through the world"', () => {
    const senses = [
      { gloss: [{ text: 'to swim', lang: 'en' }], misc: [] },
      { gloss: [{ text: 'to struggle through (a crowd)', lang: 'en' }], misc: [] },
      { gloss: [{ text: "to make one's way through the world", lang: 'en' }, { text: 'to get along (in life)', lang: 'en' }], misc: [] },
    ];
    const ranked = rankSenses(senses);
    expect(getEnglishGlosses(ranked[0])[0]).toBe('to swim');
  });

  it('走る: "to run" stays above "to run (of a vehicle)"', () => {
    const senses = [
      { gloss: [{ text: 'to run', lang: 'en' }], misc: [] },
      { gloss: [{ text: 'to run (of a vehicle)', lang: 'en' }, { text: 'to drive', lang: 'en' }, { text: 'to travel', lang: 'en' }], misc: [] },
    ];
    const ranked = rankSenses(senses);
    expect(getEnglishGlosses(ranked[0])[0]).toBe('to run');
  });
});

// ---------------------------------------------------------------------------
// Homograph entry selection – pickBestEntry
//
// When one written form matches several JMDict entries, the picker must
// prefer the entry the learner actually searched for. Before the fix, ties
// on the common-flag score were broken by database index order, so 本
// resolved to the もと entry ("origin") instead of ほん ("book"), and よう
// resolved to 酔う ("to get drunk"). Fixtures mirror the real entries.
// ---------------------------------------------------------------------------

describe('homograph entry selection – pickBestEntry', () => {
  it('本: picks the ほん (book) entry, where 本 is the PRIMARY kanji — not もと (origin)', () => {
    // Real entry 1260670: 元/本/素/基 (もと) — 本 is a secondary written form.
    const motoEntry = {
      id: '1260670',
      kanji: [
        { text: '元', common: true },
        { text: '本', common: true },
        { text: '素', common: false },
        { text: '基', common: false },
      ],
      kana: [{ text: 'もと', common: true }],
      sense: [{}, {}, {}, {}],
    };
    // Real entry 1522150: 本 (ほん) — 本 is the primary (and only) written form.
    const honEntry = {
      id: '1522150',
      kanji: [{ text: '本', common: true }],
      kana: [{ text: 'ほん', common: true }],
      sense: [{}, {}, {}],
    };
    // もと first: this is the actual candidate order returned by the index scan.
    const best = pickBestEntry([motoEntry, honEntry], '本');
    expect(best.id).toBe('1522150');
  });

  it('たい: picks the kana-only auxiliary ("want to do") over 対 (versus)', () => {
    // Real entry 1409800: 対 (たい) "versus" — common kanji entry.
    const taiVersus = {
      id: '1409800',
      kanji: [{ text: '対', common: true }, { text: '對', common: false }],
      kana: [{ text: 'たい', common: true }],
      sense: [{}, {}, {}],
    };
    // Real entry 2017560: たい auxiliary "want to do ..." — kana-only, common.
    const taiAux = {
      id: '2017560',
      kanji: [],
      kana: [{ text: 'たい', common: true }, { text: 'ったい', common: false }],
      sense: [{}, {}],
    };
    const best = pickBestEntry([taiVersus, taiAux], 'たい');
    expect(best.id).toBe('2017560');
  });

  it('single exact match is returned unchanged', () => {
    const only = { id: 'x', kanji: [{ text: '猫', common: true }], kana: [{ text: 'ねこ', common: true }], sense: [{}] };
    expect(pickBestEntry([only], '猫').id).toBe('x');
  });
});
