import { describe, it, expect } from 'vitest';
import { getEnglishGlosses, getSenseCommonness } from './dictionary';

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
