import { describe, it, expect } from 'vitest';
import { isAdultGloss, filterAdultGlosses } from './senseDisplay';

// ---------------------------------------------------------------------------
// #259 P7 — Word Detail's "All Definitions" list dumped every JMDict sense
// verbatim, including adult/vulgar ones (e.g. 猫 sense tagged misc:['uk','sl']
// glosses "bottom (submissive partner of a homosexual relationship)"). By the
// time a sense reaches the client it's a flattened string (dictionary.ts's
// `meanings: string[]` — see getSenseCommonness, which discards `misc[]`
// after using it to sort), so filtering has to work off the gloss text
// itself rather than the JMDict register tag. These tests pin the filter
// against the actual reported case plus ordinary glosses that must survive.
// ---------------------------------------------------------------------------

describe('isAdultGloss', () => {
  it('flags the reported 猫 vulgar sense', () => {
    expect(isAdultGloss('bottom (submissive partner of a homosexual relationship)')).toBe(true);
  });

  it('flags common vulgar/sexual slang patterns', () => {
    expect(isAdultGloss('vulgar slang for penis')).toBe(true);
    expect(isAdultGloss('to have sexual intercourse (vulgar)')).toBe(true);
    expect(isAdultGloss('slang for prostitute')).toBe(true);
  });

  it('does not flag ordinary, everyday glosses', () => {
    expect(isAdultGloss('cat (esp. the domestic cat, Felis catus)')).toBe(false);
    expect(isAdultGloss('feline')).toBe(false);
    expect(isAdultGloss('to eat')).toBe(false);
    expect(isAdultGloss('shamisen')).toBe(false);
    expect(isAdultGloss('wheelbarrow')).toBe(false);
    expect(isAdultGloss('geisha')).toBe(false);
  });

  it('is case-insensitive', () => {
    expect(isAdultGloss('Bottom (Submissive Partner of a Homosexual Relationship)')).toBe(true);
  });
});

describe('filterAdultGlosses', () => {
  it('removes flagged senses from a list, keeping order of the rest', () => {
    const senses = [
      'cat (esp. the domestic cat, Felis catus)',
      'feline',
      'shamisen',
      'bottom (submissive partner of a homosexual relationship)',
      'geisha',
    ];
    expect(filterAdultGlosses(senses)).toEqual([
      'cat (esp. the domestic cat, Felis catus)',
      'feline',
      'shamisen',
      'geisha',
    ]);
  });

  it('never returns an empty list — falls back to the original when every sense is flagged', () => {
    const allAdult = ['vulgar slang for penis', 'vulgar term for sexual intercourse'];
    expect(filterAdultGlosses(allAdult)).toEqual(allAdult);
  });

  it('returns the input unchanged when nothing is flagged', () => {
    const senses = ['to eat', 'to dine'];
    expect(filterAdultGlosses(senses)).toEqual(senses);
  });

  it('handles an empty list', () => {
    expect(filterAdultGlosses([])).toEqual([]);
  });
});
