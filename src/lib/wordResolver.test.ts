import { describe, it, expect } from 'vitest';
import { WordResolver } from './wordResolver.js';

// ---------------------------------------------------------------------------
// #197 – WordResolver class
//
// resolveWordMeaning() in server.ts was the fix for #188, but several
// handlers still bypassed it by calling getCachedDictionaryEntries /
// findBestVariant / getWordScoreBreakdown separately. WordResolver bundles
// the entire pipeline into a single public method so endpoints cannot half-use
// it.
//
// These tests pin the specific regression cases from #188: ます/ない being
// shadowed by JMnedict proper nouns, and 猫/春 having slang/archaic senses
// promoted to primary meaning.
// ---------------------------------------------------------------------------

/** Minimal duck-typed dictionary stand-in for injection in tests. */
function makeMockDictionary(
  lookupMap: Record<string, { meaning: string; reading?: string; meanings?: string[] } | null>
) {
  return {
    lookup: async (word: string) => lookupMap[word] ?? null,
  };
}

// ── Morpheme early-return guard (fix for #188) ───────────────────────────────

describe('WordResolver – morpheme early-return guard (#188)', () => {
  it('ます: returns polite suffix definition even when a dictionary would return "Masu"', async () => {
    // JMnedict stores ます as the proper noun "Masu". Without the guard the
    // JMDict/JMnedict result would overwrite the correct grammatical definition.
    const dict = makeMockDictionary({ ます: { meaning: 'Masu', reading: 'ます' } });
    const resolver = new WordResolver(dict);
    const result = await resolver.resolve('ます', 'ます');
    expect(result.meaning).toMatch(/polite/i);
    expect(result.meaning).not.toBe('Masu');
  });

  it('ない: returns negation definition even when a dictionary would return "Nai"', async () => {
    const dict = makeMockDictionary({ ない: { meaning: 'Nai', reading: 'ない' } });
    const resolver = new WordResolver(dict);
    const result = await resolver.resolve('ない', 'ない');
    expect(result.meaning).toMatch(/negat/i);
    expect(result.meaning).not.toBe('Nai');
  });

  it('です: returns copula definition, not a JMnedict proper noun', async () => {
    const dict = makeMockDictionary({ です: { meaning: 'Desu', reading: 'です' } });
    const resolver = new WordResolver(dict);
    const result = await resolver.resolve('です', 'です');
    expect(result.meaning).toMatch(/copula|to be|polite/i);
    expect(result.meaning).not.toBe('Desu');
  });
});

// ── All fields returned in one call (the whole point of the class) ───────────

// kanji-data cold-start can be slow on first lookup; allow 15 s for the suite.
describe('WordResolver – single-call contract', { timeout: 15000 }, () => {
  it('resolve() returns all required fields without extra calls', async () => {
    const resolver = new WordResolver(null);
    const result = await resolver.resolve('猫', '猫');
    expect(result).toHaveProperty('reading');
    expect(result).toHaveProperty('meaning');
    expect(result).toHaveProperty('meanings');  // may be undefined — key must exist
    expect(result).toHaveProperty('variant');
    expect(result).toHaveProperty('entry');
    expect(result).toHaveProperty('jlpt');
    expect(result).toHaveProperty('joyo');
    expect(result).toHaveProperty('score');
    expect(result).toHaveProperty('breakdown');
  });

  it('breakdown contains expected sub-fields', async () => {
    const resolver = new WordResolver(null);
    const result = await resolver.resolve('猫', '猫');
    expect(result.breakdown).toHaveProperty('jlptScore');
    expect(result.breakdown).toHaveProperty('joyoPenalty');
    expect(result.breakdown).toHaveProperty('highestGrade');
    expect(result.breakdown).toHaveProperty('freqPenalty');
    expect(result.breakdown).toHaveProperty('jlptValues');
    expect(result.breakdown).toHaveProperty('gradeValues');
    expect(result.breakdown).toHaveProperty('priorities');
  });

  it('score is within the documented 1–100 range', async () => {
    const resolver = new WordResolver(null);
    const result = await resolver.resolve('猫', '猫');
    expect(result.score).toBeGreaterThanOrEqual(1);
    expect(result.score).toBeLessThanOrEqual(100);
  });
});

// ── JMDict preferred over kanji-data when available ─────────────────────────

describe('WordResolver – JMDict preference over kanji-data', () => {
  it('uses JMDict meaning when it provides a non-Unknown result', async () => {
    // kanji-data might surface a less-common sense; JMDict should win.
    const dict = makeMockDictionary({
      猫: { meaning: 'cat', reading: 'ねこ', meanings: ['cat'] },
    });
    const resolver = new WordResolver(dict);
    const result = await resolver.resolve('猫', '猫');
    expect(result.meaning).toBe('cat');
  });

  it('falls back to kanji-data meaning when JMDict returns null', async () => {
    const dict = makeMockDictionary({ 猫: null });
    const resolver = new WordResolver(dict);
    const result = await resolver.resolve('猫', '猫');
    // kanji-data has 猫 — meaning must be a non-empty string, not "Unknown meaning"
    expect(result.meaning).toBeTruthy();
    expect(result.meaning).not.toBe('');
  });

  it('does not replace meaning when JMDict returns "Unknown"', async () => {
    const dict = makeMockDictionary({ 猫: { meaning: 'Unknown', reading: 'ねこ' } });
    const resolver = new WordResolver(dict);
    const result = await resolver.resolve('猫', '猫');
    expect(result.meaning).not.toBe('Unknown');
  });

  it('result includes meanings array when JMDict provides multiple senses', async () => {
    const dict = makeMockDictionary({
      猫: { meaning: 'cat', reading: 'ねこ', meanings: ['cat', 'pussy'] },
    });
    const resolver = new WordResolver(dict);
    const result = await resolver.resolve('猫', '猫');
    expect(result.meanings).toEqual(['cat', 'pussy']);
  });
});

// ── lookupCache deduplication across calls ───────────────────────────────────

describe('WordResolver – lookupCache', () => {
  it('does not call dictionary a second time for the same word when cache is provided', async () => {
    let callCount = 0;
    const dict = {
      lookup: async (word: string) => {
        callCount++;
        return { meaning: 'cat', reading: 'ねこ' };
      },
    };
    const resolver = new WordResolver(dict);
    const cache = new Map<string, any>();
    await resolver.resolve('猫', '猫', cache);
    await resolver.resolve('猫', '猫', cache);
    expect(callCount).toBe(1);
  });
});

// ── Kana-only fallback ────────────────────────────────────────────────────────

describe('WordResolver – kana-only fallback', () => {
  it('pure kana with no morpheme definition and no dictionary falls back gracefully', async () => {
    const resolver = new WordResolver(null);
    // ぽ has no morpheme definition and no kanji-data entry
    const result = await resolver.resolve('ぽ', 'ぽ');
    expect(result.meaning).toBe('Kana particle / expression');
  });

  it('pure kana morpheme is returned without calling the dictionary', async () => {
    let callCount = 0;
    const dict = { lookup: async () => { callCount++; return null; } };
    const resolver = new WordResolver(dict);
    await resolver.resolve('ます', 'ます');
    expect(callCount).toBe(0);
  });
});
