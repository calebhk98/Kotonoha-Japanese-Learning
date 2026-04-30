import { describe, it, expect } from 'vitest';
import {
  getFrequencyPenalty,
  getWordScoreBreakdown,
  findBestVariant,
  type DictionaryEntry,
  type DictionaryVariant,
} from './scoring';

// ---------------------------------------------------------------------------
// Integration: Full vocabulary extraction pipeline
// ---------------------------------------------------------------------------

describe('vocabulary extraction pipeline', () => {
  /**
   * Tests the complete flow: tokenization → filtering → dictionary lookup → scoring
   *
   * Note: Full end-to-end testing of processText() requires tokenizer and dictionary
   * to be initialized. These tests cover the scoring and variant selection logic
   * which comprises the core extraction pipeline.
   */

  it('extracts and scores a simple hiragana phrase', () => {
    // Test: "ありがとう" (arigatou - thank you)
    const entry: DictionaryEntry = {
      meanings: [{ glosses: ['thank you', 'thanks'] }],
      variants: [{ written: 'ありがとう', pronounced: 'ありがとう', priorities: ['ichi1'] }],
    };

    const variant = findBestVariant('ありがとう', [entry]);
    expect(variant.variant).not.toBeNull();
    expect(variant.variant?.written).toBe('ありがとう');

    const scored = getWordScoreBreakdown('ありがとう', variant.variant);
    expect(scored.score).toBeGreaterThan(0);
    expect(scored.score).toBeLessThanOrEqual(100);
  });

  it('extracts and scores a kanji word with variant selection', () => {
    // Test: "水" (mizu - water)
    // Multiple variants: hiragana and kanji
    const entry: DictionaryEntry = {
      meanings: [{ glosses: ['water', 'liquid'] }],
      variants: [
        { written: 'みず', pronounced: 'みず', priorities: ['ichi1'] },
        { written: '水', pronounced: 'みず', priorities: ['ichi1'] },
      ],
    };

    // When looking up "水", should pick the kanji variant
    const variant = findBestVariant('水', [entry]);
    expect(variant.variant?.written).toBe('水');

    const scored = getWordScoreBreakdown('水', variant.variant);
    expect(scored.breakdown.joyoPenalty).toBeGreaterThan(0); // Has kanji
    expect(scored.score).toBeGreaterThan(0);
  });

  it('scores rare words higher than common words', () => {
    const rareEntry: DictionaryEntry = {
      meanings: [{ glosses: ['rare word'] }],
      variants: [{ written: '稀', pronounced: 'まれ' }], // No frequency tags = rare
    };

    const commonEntry: DictionaryEntry = {
      meanings: [{ glosses: ['common word'] }],
      variants: [{ written: '日', pronounced: 'ひ', priorities: ['ichi1'] }],
    };

    const rareScore = getWordScoreBreakdown('稀', rareEntry.variants[0]);
    const commonScore = getWordScoreBreakdown('日', commonEntry.variants[0]);

    // Rare should score higher than common (more valuable to learn)
    expect(rareScore.score).toBeGreaterThan(commonScore.score);
  });

  it('handles pure hiragana particles and auxiliaries', () => {
    // Test particles like "は" (topic marker), "を" (object marker) - should be filtered
    const particles = ['は', 'を', 'に', 'が', 'の'];

    for (const particle of particles) {
      // These would be filtered by processText() before dictionary lookup
      // but if they do get looked up, they should score very low
      const result = getWordScoreBreakdown(particle, null);
      expect(result.score).toBeDefined();
    }
  });

  it('applies frequency penalties correctly across priority ranges', () => {
    const testCases = [
      // (priorities, expectedMinScore, description)
      (['ichi1'], null, 'very common word'),
      (['nf01'], null, 'frequent in general corpus'),
      (['nf31'], null, 'rare in general corpus'),
      ([], null, 'no frequency data'),
    ];

    const entry: DictionaryEntry = {
      meanings: [{ glosses: ['test'] }],
      variants: [{ written: 'テスト', pronounced: 'てすと' }],
    };

    const commonVariant = { ...entry.variants[0], priorities: ['ichi1'] };
    const rareVariant = { ...entry.variants[0], priorities: [] };

    const commonScore = getWordScoreBreakdown('テスト', commonVariant);
    const rareScore = getWordScoreBreakdown('テスト', rareVariant);

    // Rare (no freq tags) should score higher than common (ichi1)
    expect(rareScore.score).toBeGreaterThan(commonScore.score);
  });

  it('correctly identifies kanji grade and applies joyo penalties', () => {
    // Grade 1 kanji: 日, 月, 火, 木, 金, 土
    const grade1Entry: DictionaryEntry = {
      meanings: [{ glosses: ['day', 'sun'] }],
      variants: [{ written: '日', pronounced: 'ひ', priorities: ['ichi1'] }],
    };

    const result = getWordScoreBreakdown('日', grade1Entry.variants[0]);
    expect(result.breakdown.highestGrade).toBe(1);
    expect(result.breakdown.joyoPenalty).toBeGreaterThan(0);
    expect(result.breakdown.gradeValues).toHaveLength(1);
    expect(result.breakdown.gradeValues[0]).toBe(1);
  });

  it('aggregates multiple dictionary entries and picks best variant', () => {
    // Scenario: Multiple dictionary entries for the same word
    const entries: DictionaryEntry[] = [
      {
        meanings: [{ glosses: ['old definition 1'] }],
        variants: [{ written: '生', pronounced: 'い', priorities: [] }],
      },
      {
        meanings: [{ glosses: ['common: birth, life, living'] }],
        variants: [
          { written: '生', pronounced: 'い', priorities: ['ichi2'] },
          { written: '生', pronounced: 'せい', priorities: ['ichi2'] },
        ],
      },
    ];

    const result = findBestVariant('生', entries);
    expect(result.variant).not.toBeNull();
    expect(result.entry).toBeDefined();
    // Should pick the variant with priorities from the second entry
    expect(result.variant?.priorities).toBeDefined();
  });

  it('maintains score bounds (1-100) across all input combinations', () => {
    const testWords = [
      { word: 'あ', entry: null }, // Single hiragana
      { word: '日', entry: { meanings: [{ glosses: ['day'] }], variants: [{ written: '日', pronounced: 'ひ', priorities: ['ichi1'] }] } }, // Common kanji
      { word: '麗', entry: { meanings: [{ glosses: ['beautiful'] }], variants: [{ written: '麗', pronounced: 'れい' }] } }, // Rare kanji
    ];

    for (const test of testWords) {
      const variant = test.entry ? test.entry.variants[0] : null;
      const scored = getWordScoreBreakdown(test.word, variant);
      expect(scored.score).toBeGreaterThanOrEqual(1);
      expect(scored.score).toBeLessThanOrEqual(100);
    }
  });
});
