import { describe, it, expect, beforeEach } from 'vitest';
import {
  getFrequencyPenalty,
  getWordScoreBreakdown,
  findBestVariant,
  wordsCache,
  JLPT_SCORES,
  JOYO_PENALTIES,
  type DictionaryEntry,
  type DictionaryVariant,
} from './scoring';

// ---------------------------------------------------------------------------
// getFrequencyPenalty
// ---------------------------------------------------------------------------

describe('getFrequencyPenalty', () => {
  const v = (priorities: string[]): DictionaryVariant => ({ written: 'x', pronounced: 'x', priorities });

  it('returns -20 for null variant with short hiragana word', () => {
    expect(getFrequencyPenalty(null, 'は')).toBe(-20);
    expect(getFrequencyPenalty(null, 'てる')).toBe(-20);
    expect(getFrequencyPenalty(null, 'ある')).toBe(-20);
  });

  it('returns 50 for null variant with non-short-hiragana word', () => {
    expect(getFrequencyPenalty(null, '食べる')).toBe(50);
    expect(getFrequencyPenalty(null, 'テスト')).toBe(50);
  });

  it('returns -20 for ichi1 or news1 priority', () => {
    expect(getFrequencyPenalty(v(['ichi1']), 'x')).toBe(-20);
    expect(getFrequencyPenalty(v(['news1']), 'x')).toBe(-20);
  });

  it('returns -10 for ichi2 or news2 priority', () => {
    expect(getFrequencyPenalty(v(['ichi2']), 'x')).toBe(-10);
    expect(getFrequencyPenalty(v(['news2']), 'x')).toBe(-10);
  });

  it('returns 0 for gai1 or spec1 priority', () => {
    expect(getFrequencyPenalty(v(['gai1']), 'x')).toBe(0);
    expect(getFrequencyPenalty(v(['spec1']), 'x')).toBe(0);
  });

  it('returns 5 for gai2 or spec2 priority', () => {
    expect(getFrequencyPenalty(v(['gai2']), 'x')).toBe(5);
    expect(getFrequencyPenalty(v(['spec2']), 'x')).toBe(5);
  });

  it('returns 10 for nf01–nf05', () => {
    expect(getFrequencyPenalty(v(['nf01']), 'x')).toBe(10);
    expect(getFrequencyPenalty(v(['nf05']), 'x')).toBe(10);
  });

  it('returns 15 for nf06–nf10', () => {
    expect(getFrequencyPenalty(v(['nf06']), 'x')).toBe(15);
    expect(getFrequencyPenalty(v(['nf10']), 'x')).toBe(15);
  });

  it('returns 20 for nf11–nf20', () => {
    expect(getFrequencyPenalty(v(['nf11']), 'x')).toBe(20);
    expect(getFrequencyPenalty(v(['nf20']), 'x')).toBe(20);
  });

  it('returns 30 for nf21–nf30', () => {
    expect(getFrequencyPenalty(v(['nf21']), 'x')).toBe(30);
    expect(getFrequencyPenalty(v(['nf30']), 'x')).toBe(30);
  });

  it('returns 40 for nf31+', () => {
    expect(getFrequencyPenalty(v(['nf31']), 'x')).toBe(40);
    expect(getFrequencyPenalty(v(['nf48']), 'x')).toBe(40);
  });

  it('returns 50 for variant with no priorities', () => {
    expect(getFrequencyPenalty(v([]), 'x')).toBe(50);
    expect(getFrequencyPenalty({ written: 'x', pronounced: 'x' }, 'x')).toBe(50);
  });
});

// ---------------------------------------------------------------------------
// getWordScoreBreakdown
// ---------------------------------------------------------------------------

describe('getWordScoreBreakdown', () => {
  it('returns correct jlpt and no joyo penalty for kana-only word', () => {
    const result = getWordScoreBreakdown('ありがとう', null);
    expect(result.jlpt).toBe(5);
    expect(result.breakdown.jlptScore).toBe(JLPT_SCORES[5]); // 15
    expect(result.breakdown.joyoPenalty).toBe(0);
    expect(result.breakdown.jlptValues).toHaveLength(0);
    expect(result.breakdown.gradeValues).toHaveLength(0);
  });

  it('score is clamped between 1 and 100', () => {
    const result = getWordScoreBreakdown('日', null);
    expect(result.score).toBeGreaterThanOrEqual(1);
    expect(result.score).toBeLessThanOrEqual(100);
  });

  it('includes all expected breakdown fields', () => {
    const result = getWordScoreBreakdown('水', null);
    expect(result.breakdown).toHaveProperty('jlptScore');
    expect(result.breakdown).toHaveProperty('joyoPenalty');
    expect(result.breakdown).toHaveProperty('freqPenalty');
    expect(result.breakdown).toHaveProperty('jlptValues');
    expect(result.breakdown).toHaveProperty('gradeValues');
    expect(result.breakdown).toHaveProperty('priorities');
  });

  it('uses frequency penalty from the provided variant', () => {
    const commonVariant: DictionaryVariant = { written: '日', pronounced: 'ひ', priorities: ['ichi1'] };
    const rareVariant: DictionaryVariant = { written: '日', pronounced: 'ひ', priorities: [] };
    const common = getWordScoreBreakdown('日', commonVariant);
    const rare = getWordScoreBreakdown('日', rareVariant);
    expect(common.score).toBeLessThan(rare.score);
  });

  it('includes kanji jlpt and grade values for kanji words', () => {
    // 日 is N5 grade 1 — should populate jlptValues and gradeValues
    const result = getWordScoreBreakdown('日', null);
    expect(result.breakdown.jlptValues.length).toBeGreaterThan(0);
  });

  it('applies joyo penalty for kanji words', () => {
    const noKanji = getWordScoreBreakdown('みず', null);
    const withKanji = getWordScoreBreakdown('水', null);
    // Water (水) is N5 grade 1 so joyoPenalty should be JOYO_PENALTIES[1] = 5
    expect(withKanji.breakdown.joyoPenalty).toBe(JOYO_PENALTIES[1]);
    expect(noKanji.breakdown.joyoPenalty).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// findBestVariant
// ---------------------------------------------------------------------------

describe('findBestVariant', () => {
  beforeEach(() => wordsCache.clear());

  const makeEntry = (written: string, pronounced: string, priorities?: string[]): DictionaryEntry => ({
    meanings: [{ glosses: ['test meaning'] }],
    variants: [{ written, pronounced, ...(priorities ? { priorities } : {}) }],
  });

  it('returns null result for empty entries array', () => {
    const result = findBestVariant('食べる', []);
    expect(result.variant).toBeNull();
    expect(result.entry).toBeNull();
    expect(result.score).toBe(-999);
  });

  it('returns null when no variant written or pronounced matches the word', () => {
    const result = findBestVariant('飲む', [makeEntry('食べる', 'たべる')]);
    expect(result.variant).toBeNull();
  });

  it('finds match by exact written form', () => {
    const entry = makeEntry('食べる', 'たべる', ['ichi1']);
    const result = findBestVariant('食べる', [entry]);
    expect(result.variant).not.toBeNull();
    expect(result.variant?.written).toBe('食べる');
    expect(result.entry).toBe(entry);
  });

  it('finds match by pronunciation when variant has priority tags', () => {
    // Without priorities, a hiragana lookup of a kanji-written variant is penalised
    // to -200 (below the ≥0 threshold), so priority tags are needed to surface it.
    const entry = makeEntry('食べる', 'たべる', ['ichi1']);
    const result = findBestVariant('たべる', [entry]);
    expect(result.variant).not.toBeNull();
    expect(result.variant?.pronounced).toBe('たべる');
  });

  it('returns null for hiragana lookup of kanji variant without priorities', () => {
    // Intentional design: hiragana input matching a kanji-written form is penalised
    // to -200 when no priority tags are present, keeping the result below the ≥0 threshold.
    const entry = makeEntry('食べる', 'たべる');
    const result = findBestVariant('たべる', [entry]);
    expect(result.variant).toBeNull();
  });

  it('prefers written form match over pronunciation-only match', () => {
    const entry: DictionaryEntry = {
      meanings: [{ glosses: ['water'] }],
      variants: [
        { written: 'みず', pronounced: 'みず' },
        { written: '水', pronounced: 'みず' },
      ],
    };
    const result = findBestVariant('水', [entry]);
    expect(result.variant?.written).toBe('水');
  });

  it('prefers variant with priorities over one without', () => {
    const entry: DictionaryEntry = {
      meanings: [{ glosses: ['test'] }],
      variants: [
        { written: 'テスト', pronounced: 'テスト' },
        { written: 'テスト', pronounced: 'テスト', priorities: ['ichi1'] },
      ],
    };
    const result = findBestVariant('テスト', [entry]);
    expect(result.variant?.priorities).toContain('ichi1');
  });

  it('picks best match across multiple entries', () => {
    const poor: DictionaryEntry = { meanings: [{ glosses: ['a'] }], variants: [{ written: '水', pronounced: 'すい' }] };
    const good: DictionaryEntry = { meanings: [{ glosses: ['b'] }], variants: [{ written: '水', pronounced: 'みず', priorities: ['ichi1'] }] };
    const result = findBestVariant('水', [poor, good]);
    expect(result.entry).toBe(good);
  });
});
