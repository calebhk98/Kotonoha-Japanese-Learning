import { describe, it, expect } from 'vitest';
import { getGlosses, getEnglishGlosses, getEntryGlossLang } from './dictionary';

// ---------------------------------------------------------------------------
// #260 – Native-language agnosticism: language-priority gloss extraction.
//
// getEnglishGlosses only ever returned lang:"en"/"eng" glosses. A Spanish
// learner needs Spanish glosses where JMDict has them (spa, ~68k senses) and
// English as a mandatory fallback (~438k senses) elsewhere. getGlosses(sense,
// langPriority) generalises this: it walks the priority list and returns the
// glosses of the first language the sense actually carries.
//
// JMDict tags languages with ISO-639-2 codes ('eng', 'spa', 'ger', ...); the
// test fixtures also use the 2-letter form ('en'). getGlosses matches both so
// callers can pass either 'es' or 'spa'.
// ---------------------------------------------------------------------------

const catSense = {
  gloss: [
    { text: 'cat', lang: 'eng' },
    { text: 'gato', lang: 'spa' },
    { text: 'Katze', lang: 'ger' },
  ],
};

const englishOnlySense = {
  gloss: [
    { text: 'to run', lang: 'eng' },
  ],
};

describe('getGlosses – #260 language-priority extraction', () => {
  it('returns Spanish glosses when Spanish is the top priority and present', () => {
    expect(getGlosses(catSense, ['spa', 'eng'])).toEqual(['gato']);
  });

  it('accepts 2-letter language codes and matches the 3-letter JMDict tag', () => {
    expect(getGlosses(catSense, ['es', 'en'])).toEqual(['gato']);
  });

  it('falls back to English when the requested language is absent from the sense', () => {
    expect(getGlosses(englishOnlySense, ['spa', 'eng'])).toEqual(['to run']);
  });

  it('returns an empty array when no requested language is present', () => {
    expect(getGlosses(englishOnlySense, ['fre'])).toEqual([]);
  });

  it('preserves the order of glosses within the chosen language', () => {
    const sense = {
      gloss: [
        { text: 'cute', lang: 'eng' },
        { text: 'lindo', lang: 'spa' },
        { text: 'adorable', lang: 'eng' },
        { text: 'mono', lang: 'spa' },
      ],
    };
    expect(getGlosses(sense, ['spa', 'eng'])).toEqual(['lindo', 'mono']);
  });

  it('defaults to English when no priority list is passed', () => {
    expect(getGlosses(catSense)).toEqual(['cat']);
  });

  it('returns [] for a sense with no gloss field', () => {
    expect(getGlosses({}, ['spa', 'eng'])).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// #260 – entry-level language selection.
//
// JMDict-simplified "all" groups senses BY LANGUAGE within one entry: English
// senses first, then dut/fre/ger/.../spa/swe, each sense carrying glosses in a
// single language. Per-sense fallback would therefore always pick the (first)
// English sense. getEntryGlossLang decides the language ONCE for the whole
// entry (first requested language present in any sense), so the lookup can then
// take only that language's senses.
// ---------------------------------------------------------------------------

const nekoEntry = {
  sense: [
    { partOfSpeech: ['n'], gloss: [{ text: 'cat', lang: 'eng' }, { text: 'feline', lang: 'eng' }] },
    { partOfSpeech: ['n'], gloss: [{ text: 'shamisen', lang: 'eng' }] },
    { partOfSpeech: ['n'], gloss: [{ text: 'Katze', lang: 'ger' }] },
    { partOfSpeech: ['n'], gloss: [{ text: 'gato', lang: 'spa' }] },
    { partOfSpeech: ['n'], gloss: [{ text: 'parte sumisa', lang: 'spa' }] },
  ],
};

const englishOnlyEntry = {
  sense: [{ partOfSpeech: ['n'], gloss: [{ text: 'book', lang: 'eng' }] }],
};

describe('getEntryGlossLang – #260 entry-level language selection', () => {
  it('chooses Spanish for a Spanish learner when the entry has spa senses', () => {
    expect(getEntryGlossLang(nekoEntry, ['spa', 'eng'])).toBe('spa');
  });

  it('falls back to English when the entry has no Spanish sense', () => {
    expect(getEntryGlossLang(englishOnlyEntry, ['spa', 'eng'])).toBe('eng');
  });

  it('chooses English in English mode', () => {
    expect(getEntryGlossLang(nekoEntry, ['eng'])).toBe('eng');
  });

  it('returns null when none of the requested languages are present', () => {
    expect(getEntryGlossLang(englishOnlyEntry, ['fre'])).toBeNull();
  });

  it('taking only the chosen language’s senses yields Spanish primary (gato, not cat)', () => {
    const lang = getEntryGlossLang(nekoEntry, ['spa', 'eng'])!;
    const spanishMeanings = nekoEntry.sense.flatMap((s) => getGlosses(s, [lang]));
    expect(spanishMeanings[0]).toBe('gato');
    expect(spanishMeanings).not.toContain('cat');
  });
});

describe('getEnglishGlosses – unchanged behaviour after refactor (#260 regression)', () => {
  it('still filters to English only', () => {
    expect(getEnglishGlosses(catSense)).toEqual(['cat']);
  });

  it('still matches both en and eng tags', () => {
    const sense = { gloss: [{ text: 'cat', lang: 'en' }, { text: 'kitty', lang: 'eng' }] };
    expect(getEnglishGlosses(sense)).toEqual(['cat', 'kitty']);
  });

  it('still returns [] for non-English-only senses', () => {
    const sense = { gloss: [{ text: 'gato', lang: 'spa' }] };
    expect(getEnglishGlosses(sense)).toEqual([]);
  });
});
