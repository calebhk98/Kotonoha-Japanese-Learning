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

// ── #191 – Mixed kanji+kana real-world sentences ─────────────────────────────
//
// Tests the five sentences from the issue using a mock JMDict that returns the
// correctly-sorted sense (i.e., what the #186/#187 fixes enable). These verify
// that the WordResolver pipeline propagates meanings, readings, and scores
// correctly for each word type: plain kanji, conjugated verb base form,
// adjective, katakana loanword, and grammar word.

describe('WordResolver – #191 mixed kanji+kana real-world cases', { timeout: 15000 }, () => {
  // ── 猫が寝ています ─────────────────────────────────────────────────────────

  it('猫: meaning contains "cat" and reading is ねこ', async () => {
    const dict = makeMockDictionary({
      猫: { meaning: 'cat (esp. the domestic cat)', reading: 'ねこ', meanings: ['cat (esp. the domestic cat)'] },
    });
    const resolver = new WordResolver(dict);
    const result = await resolver.resolve('猫', '猫');
    expect(result.meaning.toLowerCase()).toContain('cat');
    expect(result.reading).toBe('ねこ');
  });

  it('寝る (base form of 寝ています): meaning contains "sleep" when base form is passed', async () => {
    // The tokenizer passes the surface form as wordStr and the Sudachi-normalised
    // base form as baseForm. The resolver must look up the base form in JMDict.
    const dict = makeMockDictionary({
      '寝る': { meaning: 'to sleep', reading: 'ねる', meanings: ['to sleep', 'to go to bed', 'to lie down'] },
    });
    const resolver = new WordResolver(dict);
    const result = await resolver.resolve('寝て', '寝る'); // surface=conjugated, base=dict form
    expect(result.meaning.toLowerCase()).toContain('sleep');
  });

  it('寝る: result has non-Unknown meaning and valid score', async () => {
    const dict = makeMockDictionary({
      '寝る': { meaning: 'to sleep', reading: 'ねる' },
    });
    const resolver = new WordResolver(dict);
    const result = await resolver.resolve('寝る', '寝る');
    expect(result.meaning).not.toBe('Unknown meaning');
    expect(result.score).toBeGreaterThanOrEqual(1);
    expect(result.score).toBeLessThanOrEqual(100);
  });

  // ── 桜がきれいです ─────────────────────────────────────────────────────────

  it('桜: meaning contains "cherry" and reading is さくら', async () => {
    const dict = makeMockDictionary({
      '桜': { meaning: 'cherry blossom', reading: 'さくら', meanings: ['cherry blossom', 'cherry tree'] },
    });
    const resolver = new WordResolver(dict);
    const result = await resolver.resolve('桜', '桜');
    expect(result.meaning.toLowerCase()).toContain('cherry');
    expect(result.reading).toBe('さくら');
  });

  // ── 可愛い猫が好きです ──────────────────────────────────────────────────────

  it('可愛い: meaning contains "cute" or "adorable"', async () => {
    const dict = makeMockDictionary({
      '可愛い': { meaning: 'cute', reading: 'かわいい', meanings: ['cute', 'adorable', 'charming'] },
    });
    const resolver = new WordResolver(dict);
    const result = await resolver.resolve('可愛い', '可愛い');
    expect(result.meaning.toLowerCase()).toMatch(/cute|adorable/);
    expect(result.reading).toBe('かわいい');
  });

  // ── プレゼントをあげました ─────────────────────────────────────────────────

  it('プレゼント: meaning contains "present" or "gift" (katakana loanword)', async () => {
    const dict = makeMockDictionary({
      'プレゼント': { meaning: 'present', reading: 'プレゼント', meanings: ['present', 'gift'] },
    });
    const resolver = new WordResolver(dict);
    const result = await resolver.resolve('プレゼント', 'プレゼント');
    expect(result.meaning.toLowerCase()).toMatch(/present|gift/);
  });

  it('プレゼント: has no JLPT values (katakana, no kanji)', async () => {
    const dict = makeMockDictionary({
      'プレゼント': { meaning: 'present', reading: 'プレゼント' },
    });
    const resolver = new WordResolver(dict);
    const result = await resolver.resolve('プレゼント', 'プレゼント');
    expect(result.breakdown.jlptValues).toHaveLength(0);
    expect(result.breakdown.gradeValues).toHaveLength(0);
  });

  // ── 田中さんはどこですか ────────────────────────────────────────────────────

  it('です: morpheme guard fires before JMDict – returns copula definition not "Desu"', async () => {
    const dict = makeMockDictionary({ 'です': { meaning: 'Desu', reading: 'です' } });
    const resolver = new WordResolver(dict);
    const result = await resolver.resolve('です', 'です');
    expect(result.meaning).toMatch(/copula|to be|polite/i);
    expect(result.meaning).not.toMatch(/^desu$/i);
  });

  // ── All five issue words produce non-Unknown meaning ────────────────────────

  it('all five issue #191 test words resolve to a non-Unknown meaning', async () => {
    const dict = makeMockDictionary({
      '猫':     { meaning: 'cat',            reading: 'ねこ' },
      '桜':     { meaning: 'cherry blossom', reading: 'さくら' },
      '可愛い': { meaning: 'cute',           reading: 'かわいい' },
      'プレゼント': { meaning: 'present',    reading: 'プレゼント' },
      '春':     { meaning: 'spring',         reading: 'はる' },
    });
    const resolver = new WordResolver(dict);
    for (const word of ['猫', '桜', '可愛い', 'プレゼント', '春']) {
      const result = await resolver.resolve(word, word);
      expect(result.meaning, `${word} should have a real meaning`).not.toBe('Unknown meaning');
    }
  });

  // ── Readings are preserved correctly ────────────────────────────────────────

  it('each issue word returns the expected reading from JMDict', async () => {
    const cases: [string, string][] = [
      ['猫',     'ねこ'],
      ['桜',     'さくら'],
      ['春',     'はる'],
    ];
    for (const [word, expectedReading] of cases) {
      const dict = makeMockDictionary({
        [word]: { meaning: 'test', reading: expectedReading },
      });
      const resolver = new WordResolver(dict);
      const result = await resolver.resolve(word, word);
      expect(result.reading, `reading for ${word}`).toBe(expectedReading);
    }
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

// ---------------------------------------------------------------------------
// Morpheme guard – conjugated auxiliary surface forms
//
// The tokenizer deliberately keeps grammatical auxiliaries (たい, ない, です…)
// as separate tokens so learners see their meanings. Sudachi hands back the
// auxiliary's base form (たく→たい, なかっ→ない, でし→です), but the guard in
// resolve() only checked the SURFACE against morphemeDefinitions. The surface
// missed the table, fell through to JMDict, and homograph lookup returned
// nonsense: たく→対 "versus", よう→酔う "to get drunk".
// ---------------------------------------------------------------------------

describe('WordResolver – morpheme guard checks base form for conjugated auxiliaries', () => {
  it('たく (base form たい): returns the desiderative definition, not 対 "versus"', async () => {
    const dict = makeMockDictionary({ たい: { meaning: 'versus', reading: 'たい' } });
    const resolver = new WordResolver(dict);
    const result = await resolver.resolve('たく', 'たい');
    expect(result.meaning).toMatch(/want to/i);
    expect(result.meaning).not.toBe('versus');
  });

  it('なかっ (base form ない): returns the negation definition', async () => {
    const dict = makeMockDictionary({ ない: { meaning: 'nonexistent', reading: 'ない' } });
    const resolver = new WordResolver(dict);
    const result = await resolver.resolve('なかっ', 'ない');
    expect(result.meaning).toMatch(/negat|not/i);
    expect(result.meaning).not.toBe('nonexistent');
  });

  it('なかっ with the KANJI base form 無い (what Sudachi actually emits): still the negation definition', async () => {
    // Sudachi normalizes なかっ to 無い; the kana base-form guard can't fire,
    // so the surface form itself must be in the morpheme table.
    const dict = makeMockDictionary({ 無い: { meaning: 'nonexistent', reading: 'ない' } });
    const resolver = new WordResolver(dict);
    const result = await resolver.resolve('なかっ', '無い');
    expect(result.meaning).toMatch(/negat|not/i);
    expect(result.meaning).not.toBe('nonexistent');
  });

  it('でし (base form です): returns the polite copula definition', async () => {
    const dict = makeMockDictionary({ です: { meaning: 'be', reading: 'です' } });
    const resolver = new WordResolver(dict);
    const result = await resolver.resolve('でし', 'です');
    expect(result.meaning).toMatch(/copula|polite/i);
  });

  it('よう: returns a grammatical definition, not 酔う "to get drunk"', async () => {
    // よう exactly matches 17 JMDict entries (酔う, 用, 様, …); the entry picker
    // tie-broke on database order and returned 酔う. As grammar (〜ように,
    // 〜ようになる) it belongs in the morpheme table like ます/ない/たい.
    const dict = makeMockDictionary({ よう: { meaning: 'to get drunk', reading: 'よう' } });
    const resolver = new WordResolver(dict);
    const result = await resolver.resolve('よう', 'よう');
    expect(result.meaning).not.toBe('to get drunk');
    expect(result.meaning).toMatch(/manner|way|like|so that/i);
  });

  it('surface-form definition still wins over base-form definition when both exist', async () => {
    // ました has its own entry ("polite past form") — the base form ます must
    // not shadow the more specific surface definition.
    const resolver = new WordResolver(null);
    const result = await resolver.resolve('ました', 'ます');
    expect(result.meaning).toMatch(/polite past/i);
  });

  it('kanji base forms are not routed through the morpheme table', async () => {
    // A kanji base form (e.g. 見る for the surface 見) must go through the
    // dictionary waterfall, not the kana morpheme table.
    const dict = makeMockDictionary({ 見る: { meaning: 'to see', reading: 'みる' } });
    const resolver = new WordResolver(dict);
    const result = await resolver.resolve('見', '見る');
    expect(result.meaning).toBe('to see');
  });
});

// ── POS hint pass-through (kana homograph disambiguation) ────────────────────

describe('WordResolver – POS hint reaches the dictionary', () => {
  it('passes the token part-of-speech through to dictionary.lookup', async () => {
    const calls: any[] = [];
    const dict = {
      lookup: async (word: string, hint?: any) => {
        calls.push([word, hint]);
        return { meaning: 'to put', reading: 'おく' };
      },
    };
    const resolver = new WordResolver(dict as any);
    const result = await resolver.resolve('おい', '置く', undefined, '動詞');
    expect(result.meaning).toBe('to put');
    expect(calls.length).toBeGreaterThan(0);
    expect(calls[0][1]).toEqual({ pos: '動詞' });
  });

  it('caches per (word, pos) so a noun lookup cannot poison a verb lookup', async () => {
    let n = 0;
    const dict = { lookup: async () => ({ meaning: `m${n++}`, reading: 'x' }) };
    const resolver = new WordResolver(dict as any);
    const cache = new Map();
    await resolver.resolve('おく', 'おく', cache, '名詞');
    await resolver.resolve('おく', 'おく', cache, '動詞');
    expect(n).toBe(2); // distinct lookups, not a single cached value
  });
});

describe('WordResolver – して resolves as grammar, not a JMDict homograph', () => {
  it('して (base form 為る): returns the する te-form definition', async () => {
    const dict = makeMockDictionary({ 為る: { meaning: 'to become', reading: 'なる' } });
    const resolver = new WordResolver(dict);
    const result = await resolver.resolve('して', '為る');
    expect(result.meaning).toMatch(/to do|te-form/i);
    expect(result.meaning).not.toBe('to become');
  });
});

// ── Reading source for uninflected words ─────────────────────────────────────

describe('WordResolver – uninflected words take the JMDict reading', () => {
  it('餅: reading is もち (JMDict), not the archaic kanji-data variant あも', async () => {
    const dict = makeMockDictionary({ 餅: { meaning: 'mochi', reading: 'もち' } });
    const resolver = new WordResolver(dict);
    const result = await resolver.resolve('餅', '餅');
    expect(result.reading).toBe('もち');
  });

  it('誰: reading is だれ, not the archaic た', async () => {
    const dict = makeMockDictionary({ 誰: { meaning: 'who', reading: 'だれ' } });
    const resolver = new WordResolver(dict);
    const result = await resolver.resolve('誰', '誰');
    expect(result.reading).toBe('だれ');
  });
});

describe('WordResolver – pure-kana surfaces keep their own reading', () => {
  it('ことば (normalized to 言葉): reading is ことば, not kanji-data\'s けとば', async () => {
    const dict = makeMockDictionary({ 言葉: { meaning: 'language', reading: 'ことば' } });
    const resolver = new WordResolver(dict);
    const result = await resolver.resolve('ことば', '言葉');
    expect(result.reading).toBe('ことば');
  });
});

// ── Contextual reading from the tokenizer ────────────────────────────────────

describe('WordResolver – tokenizer reading is used for display and lookup', () => {
  it('displays the surface reading when the tokenizer provides one', async () => {
    const dict = makeMockDictionary({ 読む: { meaning: 'to read', reading: 'よむ' } });
    const resolver = new WordResolver(dict);
    const result = await resolver.resolve('読みました', '読む', undefined, '動詞', 'よみました');
    expect(result.reading).toBe('よみました');
  });

  it('passes the reading hint to the dictionary for non-conjugating tokens', async () => {
    const calls: any[] = [];
    const dict = {
      lookup: async (word: string, hint?: any) => { calls.push(hint); return { meaning: 'head', reading: 'かしら' }; },
    };
    const resolver = new WordResolver(dict as any);
    await resolver.resolve('かしら', '頭', undefined, '名詞', 'かしら');
    expect(calls[0]).toEqual({ pos: '名詞', reading: 'かしら' });
  });

  it('does NOT pass a reading hint for conjugating tokens (surface reading ≠ base reading)', async () => {
    const calls: any[] = [];
    const dict = {
      lookup: async (word: string, hint?: any) => { calls.push(hint); return { meaning: 'to read', reading: 'よむ' }; },
    };
    const resolver = new WordResolver(dict as any);
    await resolver.resolve('読みました', '読む', undefined, '動詞', 'よみました');
    expect(calls[0]).toEqual({ pos: '動詞' });
  });
});

// ---------------------------------------------------------------------------
// #257 – Compositional fallback + supplementary dictionary
//
// 0.117% of word-occurrences in the resolved artifacts were "Unknown
// meaning". The dominant classes are fully derivable: transparent compounds
// (試合後, ご利用), compound verbs (入れ直す, 動き始める), mimetics whose
// JMDict entry carries a と (ぎゅっ→ぎゅっと), and story character names
// (なつき resolved to the WRONG entry, "summer season"). See the issue for
// the measured breakdown.
// ---------------------------------------------------------------------------

describe('WordResolver – #257 compositional fallback', { timeout: 30000 }, () => {
  it('試合後: suffix 後 composes with 試合 "match"', async () => {
    const dict = makeMockDictionary({ 試合: { meaning: 'match', reading: 'しあい' } });
    const resolver = new WordResolver(dict);
    const result = await resolver.resolve('試合後', '試合後', undefined, '名詞');
    expect(result.meaning).toMatch(/match/);
    expect(result.meaning).toMatch(/after/);
  });

  it('ご利用: honorific prefix strips and composes with 利用 "use"', async () => {
    const dict = makeMockDictionary({ 利用: { meaning: 'use', reading: 'りよう' } });
    const resolver = new WordResolver(dict);
    const result = await resolver.resolve('ご利用', 'ご利用', undefined, '名詞');
    expect(result.meaning).toMatch(/use/);
    expect(result.meaning).toMatch(/polite|honorific/i);
  });

  it('チーム内: suffix 内 composes with the katakana stem', async () => {
    const dict = makeMockDictionary({ チーム: { meaning: 'team', reading: 'チーム' } });
    const resolver = new WordResolver(dict);
    const result = await resolver.resolve('チーム内', 'チーム内', undefined, '名詞');
    expect(result.meaning).toMatch(/team/);
    expect(result.meaning).toMatch(/within|inside/);
  });

  it('入れ直した (base 入れ直す): compound verb splits into 入れる + 直す "re-do"', async () => {
    const dict = makeMockDictionary({ 入れる: { meaning: 'to put in', reading: 'いれる' } });
    const resolver = new WordResolver(dict);
    const result = await resolver.resolve('入れ直した', '入れ直す', undefined, '動詞');
    expect(result.meaning).toMatch(/put in/);
    expect(result.meaning).toMatch(/again|re-?do/i);
  });

  it('動き始めました (base 動き始める): godan stem 動き maps back to 動く', async () => {
    const dict = makeMockDictionary({ 動く: { meaning: 'to move', reading: 'うごく' } });
    const resolver = new WordResolver(dict);
    const result = await resolver.resolve('動き始めました', '動き始める', undefined, '動詞');
    expect(result.meaning).toMatch(/move/);
    expect(result.meaning).toMatch(/begin|start/i);
  });

  it('ぎゅっ: mimetic retries as ぎゅっと', async () => {
    const dict = makeMockDictionary({ ぎゅっと: { meaning: 'tightly', reading: 'ぎゅっと' } });
    const resolver = new WordResolver(dict);
    const result = await resolver.resolve('ぎゅっ', 'ぎゅっ');
    expect(result.meaning).toMatch(/tight/);
  });

  it('compositional fallback does NOT fire when a direct lookup succeeded', async () => {
    // 食後 has its own JMDict entry — must use it, not compose 食+後.
    const dict = makeMockDictionary({ 食後: { meaning: 'after a meal', reading: 'しょくご' } });
    const resolver = new WordResolver(dict);
    const result = await resolver.resolve('食後', '食後', undefined, '名詞');
    expect(result.meaning).toBe('after a meal');
  });
});

describe('WordResolver – #257 supplementary dictionary', { timeout: 30000 }, () => {
  it('なつき: resolves as the story protagonist name, not 夏季 "summer season"', async () => {
    const dict = makeMockDictionary({ なつき: { meaning: 'summer season', reading: 'なつき' } });
    const resolver = new WordResolver(dict);
    const result = await resolver.resolve('なつき', 'なつき', undefined, '名詞');
    expect(result.meaning).toMatch(/natsuki/i);
    expect(result.meaning).not.toBe('summer season');
  });

  it('雪童: Miyazawa coinage gets its curated gloss', async () => {
    const resolver = new WordResolver(makeMockDictionary({}));
    const result = await resolver.resolve('雪童', '雪童', undefined, '名詞');
    expect(result.meaning).toMatch(/snow/i);
  });

  it('ヤーレン: folk-song chant is labeled as such instead of Unknown', async () => {
    const resolver = new WordResolver(makeMockDictionary({}));
    const result = await resolver.resolve('ヤーレン', 'ヤーレン');
    expect(result.meaning).toMatch(/chant|call/i);
  });
});

describe('WordResolver – #257 refinements', { timeout: 30000 }, () => {
  it('次の日: の-compound composes 次 + 日', async () => {
    const dict = makeMockDictionary({
      次: { meaning: 'next', reading: 'つぎ' },
      日: { meaning: 'day', reading: 'ひ' },
    });
    const result = await new WordResolver(dict).resolve('次の日', '次の日', undefined, '名詞');
    expect(result.meaning).toMatch(/next/);
    expect(result.meaning).toMatch(/day/);
  });

  it('ギュッ (katakana mimetic): retries as hiragana ぎゅっと', async () => {
    const dict = makeMockDictionary({ ぎゅっと: { meaning: 'tightly', reading: 'ぎゅっと' } });
    const result = await new WordResolver(dict).resolve('ギュッ', 'ギュッ');
    expect(result.meaning).toMatch(/tight/);
  });

  it('実習室: suffix 室 composes with 実習 "practical training"', async () => {
    const dict = makeMockDictionary({ 実習: { meaning: 'practical training', reading: 'じっしゅう' } });
    const result = await new WordResolver(dict).resolve('実習室', '実習室', undefined, '名詞');
    expect(result.meaning).toMatch(/training/);
    expect(result.meaning).toMatch(/room/);
  });
});

// ---------------------------------------------------------------------------
// #257 follow-up — the remaining 150 unknown occurrences.
//
// Scan of the committed artifacts (2026-07-17) found 118 distinct unknowns.
// Classes, with the probe-verified Sudachi (surface, baseForm, pos) triples:
//   1. Honorific-prefix HOLE: Sudachi normalizes お財布→御財布, ご自分→御自分,
//      so /^[おご]/ on the base form never fires. Actual bug in the #257 fix.
//   2. Compound verbs the aux table misses: base forms use kanji aux
//      (傾き掛ける not 傾きかける) or non-aux second verbs (掴み殺す, 流し入れる).
//      Needs a generalized V1-stem + V2 split, not a bigger aux table.
//   3. Passives: base 揺られる — needs base-candidate stripping (揺られる→揺る).
//   4. Noun-noun compounds (largest class, ~55 words): ガラスケース, 変更点,
//      子兎, 東京都渋谷区 — needs a generic split with recursion for addresses.
//   5. Reduplicated onomatopoeia: パチパチパチ — JMDict has the doubled unit
//      (ぱちぱち); needs a reduplication retry, then an honest generic label.
//   6. Verbal nouns: 振り返り — the masu-stem used as a noun (→振り返る).
// ---------------------------------------------------------------------------

describe('WordResolver – #257 follow-up: honorific-prefix hole (御-normalized base forms)', { timeout: 30000 }, () => {
  it('お財布 (base 御財布): honorific rule fires despite Sudachi normalizing お→御', async () => {
    const dict = makeMockDictionary({ 財布: { meaning: 'wallet', reading: 'さいふ' } });
    const result = await new WordResolver(dict).resolve('お財布', '御財布', undefined, '名詞');
    expect(result.meaning).toMatch(/wallet/);
    expect(result.meaning).toMatch(/polite|honorific/i);
  });

  it('ご自分 (base 御自分): honorific rule fires for ご+御 too', async () => {
    const dict = makeMockDictionary({ 自分: { meaning: 'oneself', reading: 'じぶん' } });
    const result = await new WordResolver(dict).resolve('ご自分', '御自分', undefined, '名詞');
    expect(result.meaning).toMatch(/oneself/);
    expect(result.meaning).toMatch(/polite|honorific/i);
  });
});

describe('WordResolver – #257 follow-up: generalized compound verbs', { timeout: 30000 }, () => {
  it('流し入れました (base 流し入れる): splits into 流す + 入れる even though 入れる is not an aux', async () => {
    const dict = makeMockDictionary({
      流す: { meaning: 'to pour', reading: 'ながす' },
      入れる: { meaning: 'to put in', reading: 'いれる' },
    });
    const result = await new WordResolver(dict).resolve('流し入れました', '流し入れる', undefined, '動詞');
    expect(result.meaning).toMatch(/pour/);
    expect(result.meaning).toMatch(/put in/);
  });

  it('傾きかけている (base 傾き掛ける): kanji aux 掛ける still gets the かける gloss', async () => {
    const dict = makeMockDictionary({
      傾く: { meaning: 'to lean', reading: 'かたむく' },
      掛ける: { meaning: 'to hang', reading: 'かける' },
    });
    const result = await new WordResolver(dict).resolve('傾きかけている', '傾き掛ける', undefined, '動詞');
    expect(result.meaning).toMatch(/lean/);
    expect(result.meaning).toMatch(/verge|partially/i);
  });

  it('つかみ殺してしまう (base 掴み殺す): generic V2 uses its own dictionary gloss', async () => {
    const dict = makeMockDictionary({
      掴む: { meaning: 'to grab', reading: 'つかむ' },
      殺す: { meaning: 'to kill', reading: 'ころす' },
    });
    const result = await new WordResolver(dict).resolve('つかみ殺してしまう', '掴み殺す', undefined, '動詞');
    expect(result.meaning).toMatch(/grab/);
    expect(result.meaning).toMatch(/kill/);
  });

  it('揺られていた (base 揺られる): passive strips to 揺る', async () => {
    const dict = makeMockDictionary({ 揺る: { meaning: 'to shake', reading: 'ゆる' } });
    const result = await new WordResolver(dict).resolve('揺られていた', '揺られる', undefined, '動詞');
    expect(result.meaning).toMatch(/shake/);
    expect(result.meaning).toMatch(/passive|potential/i);
  });
});

describe('WordResolver – #257 follow-up: noun compounds', { timeout: 30000 }, () => {
  it('ガラスケース: katakana compound splits into ガラス + ケース', async () => {
    const dict = makeMockDictionary({
      ガラス: { meaning: 'glass', reading: 'がらす' },
      ケース: { meaning: 'case', reading: 'けーす' },
    });
    const result = await new WordResolver(dict).resolve('ガラスケース', 'ガラスケース', undefined, '名詞');
    expect(result.meaning).toMatch(/glass/);
    expect(result.meaning).toMatch(/case/);
  });

  it('子うさぎ (base 子兎): prefix 子 composes with 兎 "rabbit"', async () => {
    const dict = makeMockDictionary({ 兎: { meaning: 'rabbit', reading: 'うさぎ' } });
    const result = await new WordResolver(dict).resolve('子うさぎ', '子兎', undefined, '名詞');
    expect(result.meaning).toMatch(/child|young/i);
    expect(result.meaning).toMatch(/rabbit/);
  });

  it('ある夜: prenominal ある glosses as "a certain", not the verb "to exist"', async () => {
    const dict = makeMockDictionary({
      ある: { meaning: 'to exist', reading: 'ある' },
      夜: { meaning: 'night', reading: 'よる' },
    });
    const result = await new WordResolver(dict).resolve('ある夜', 'ある夜', undefined, '名詞');
    expect(result.meaning).toMatch(/certain|one/i);
    expect(result.meaning).toMatch(/night/);
    expect(result.meaning).not.toMatch(/exist/);
  });

  it('東京都渋谷区: address recurses into 東京都 + 渋谷 + 区', async () => {
    const dict = makeMockDictionary({
      東京都: { meaning: 'Tokyo Metropolis', reading: 'とうきょうと' },
      渋谷: { meaning: 'Shibuya', reading: 'しぶや' },
      区: { meaning: 'ward', reading: 'く' },
    });
    const result = await new WordResolver(dict).resolve('東京都渋谷区', '東京都渋谷区', undefined, '名詞');
    expect(result.meaning).toMatch(/Tokyo/);
    expect(result.meaning).toMatch(/Shibuya/);
    expect(result.meaning).toMatch(/ward/);
  });

  it('変更点: new suffix 点 composes with 変更 "change"', async () => {
    const dict = makeMockDictionary({ 変更: { meaning: 'change', reading: 'へんこう' } });
    const result = await new WordResolver(dict).resolve('変更点', '変更点', undefined, '名詞');
    expect(result.meaning).toMatch(/change/);
    expect(result.meaning).toMatch(/point/);
  });

  it('出し方: suffix 方 resolves the stem as a VERB (出す), not the noun だし "broth"', async () => {
    const dict = makeMockDictionary({
      出し: { meaning: 'broth', reading: 'だし' },
      出す: { meaning: 'to put out', reading: 'だす' },
    });
    const result = await new WordResolver(dict).resolve('出し方', '出し方', undefined, '名詞');
    expect(result.meaning).toMatch(/put out/);
    expect(result.meaning).toMatch(/way|how to/i);
    expect(result.meaning).not.toMatch(/broth/);
  });

  it('揚げたて: suffix たて "freshly done" resolves the stem as 揚げる', async () => {
    const dict = makeMockDictionary({ 揚げる: { meaning: 'to deep-fry', reading: 'あげる' } });
    const result = await new WordResolver(dict).resolve('揚げたて', '揚げたて', undefined, '名詞');
    expect(result.meaning).toMatch(/deep-fry/);
    expect(result.meaning).toMatch(/fresh|just/i);
  });

  it('振り返り: verbal noun resolves via its verb 振り返る', async () => {
    const dict = makeMockDictionary({ 振り返る: { meaning: 'to look back', reading: 'ふりかえる' } });
    const result = await new WordResolver(dict).resolve('振り返り', '振り返り', undefined, '名詞');
    expect(result.meaning).toMatch(/look back/);
  });
});

describe('WordResolver – #257 follow-up: onomatopoeia & vocalizations', { timeout: 30000 }, () => {
  it('パチパチパチ (base ぱちぱちぱち): reduplication retries the doubled unit', async () => {
    const dict = makeMockDictionary({ ぱちぱち: { meaning: 'clapping sound', reading: 'ぱちぱち' } });
    const result = await new WordResolver(dict).resolve('パチパチパチ', 'ぱちぱちぱち', undefined, '副詞');
    expect(result.meaning).toMatch(/clap/);
  });

  it('チチチ: unresolvable kana adverb gets an honest onomatopoeia label', async () => {
    const result = await new WordResolver(makeMockDictionary({})).resolve('チチチ', 'ちちち', undefined, '副詞');
    expect(result.meaning).toMatch(/onomatopoeia|sound/i);
    expect(result.meaning).not.toBe('Unknown meaning');
  });

  it('まーー: stretched kana vocalization gets an honest label, not Unknown', async () => {
    const result = await new WordResolver(makeMockDictionary({})).resolve('まーー', 'まーー', undefined, '名詞');
    expect(result.meaning).toMatch(/vocalization|stretched|sound/i);
    expect(result.meaning).not.toBe('Unknown meaning');
  });
});

describe('WordResolver – #257 follow-up: manual-review pins (no false info)', { timeout: 30000 }, () => {
  // These pin garbage compositions found by manually reviewing the first
  // regenerated artifact diff. Every case is a real output that shipped a
  // wrong or nonsense meaning; the rules below must keep them dead.

  it('ガラスケース: picks the balanced split, never ガラ + スケース (JMnedict "Scase")', async () => {
    const dict = makeMockDictionary({
      ガラ: { meaning: 'pattern', reading: 'がら' },
      スケース: { meaning: 'Scase', reading: 'すけーす' },
      ガラス: { meaning: 'glass', reading: 'がらす' },
      ケース: { meaning: 'case', reading: 'けーす' },
    });
    const result = await new WordResolver(dict).resolve('ガラスケース', 'ガラスケース', undefined, '名詞');
    expect(result.meaning).toMatch(/glass/);
    expect(result.meaning).toMatch(/case/);
    expect(result.meaning).not.toMatch(/Scase|pattern/);
  });

  it('おいしさ: suffix さ wins — the honorific rule must not surface JMnedict names for kana remainders', async () => {
    const dict = makeMockDictionary({
      いしさ: { meaning: 'Ishisa', reading: 'いしさ' },
      おいし: { meaning: 'delicious', reading: 'おいし' },
    });
    const result = await new WordResolver(dict).resolve('おいしさ', 'おいしさ', undefined, '名詞');
    expect(result.meaning).not.toMatch(/Ishisa/);
    expect(result.meaning).toMatch(/-ness/);
  });

  it('ニャー: never splits into single-kana parts (ニ + ャー); gets a vocalization label', async () => {
    const dict = makeMockDictionary({
      ニ: { meaning: '4th (in a sequence)', reading: 'に' },
      ャー: { meaning: 'after-look journalizing', reading: 'ゃー' },
    });
    const result = await new WordResolver(dict).resolve('ニャー', 'にゃー', undefined, '名詞');
    expect(result.meaning).not.toMatch(/4th|journal/);
    expect(result.meaning).toMatch(/vocalization|sound/i);
  });

  it('行かす (causative of 行く): resolves via the causative rule, not a bogus 行る+かす split', async () => {
    const dict = makeMockDictionary({
      行る: { meaning: 'to do', reading: 'やる' },
      かす: { meaning: 'to lend', reading: 'かす' },
      行く: { meaning: 'to go', reading: 'いく' },
    });
    const result = await new WordResolver(dict).resolve('行かす', '行かす', undefined, '動詞');
    expect(result.meaning).toMatch(/go/);
    expect(result.meaning).toMatch(/causative/i);
    expect(result.meaning).not.toMatch(/lend/);
  });

  it('解き捨てました (base 解き捨てる): tail must start with kanji — 解き+捨てる, never 解+き捨てる', async () => {
    const dict = makeMockDictionary({
      解る: { meaning: 'to understand', reading: 'わかる' },
      き捨てる: { meaning: 'to spit out', reading: 'きすてる' },
      解く: { meaning: 'to untie', reading: 'とく' },
      捨てる: { meaning: 'to throw away', reading: 'すてる' },
    });
    const result = await new WordResolver(dict).resolve('解き捨てました', '解き捨てる', undefined, '動詞');
    expect(result.meaning).toMatch(/untie/);
    expect(result.meaning).toMatch(/throw away/);
    expect(result.meaning).not.toMatch(/spit/);
  });

  it('同条: single-kanji remainder uses the curated suffix gloss, not a homograph lookup ("muscle")', async () => {
    const dict = makeMockDictionary({ 条: { meaning: 'muscle', reading: 'すじ' } });
    const result = await new WordResolver(dict).resolve('同条', '同条', undefined, '名詞');
    expect(result.meaning).toMatch(/same/);
    expect(result.meaning).toMatch(/article|clause/i);
    expect(result.meaning).not.toMatch(/muscle/);
  });

  it('ぷしゅっ: stretch-stripping never breaks a mora (ゅ stays; only っ/ー strip after kana)', async () => {
    const dict = makeMockDictionary({ ぷし: { meaning: 'physical strength', reading: 'ぷし' } });
    const result = await new WordResolver(dict).resolve('ぷしゅっ', 'ぷしゅっ', undefined, '副詞');
    expect(result.meaning).not.toMatch(/physical/);
    expect(result.meaning).toMatch(/onomatopoeia|sound/i);
  });

  it('女性活躍推進法: trailing known suffix uses its curated gloss, not a JMnedict statute name', async () => {
    const dict = makeMockDictionary({
      女性: { meaning: 'woman', reading: 'じょせい' },
      活躍: { meaning: 'activity', reading: 'かつやく' },
      推進: { meaning: 'promotion', reading: 'すいしん' },
      推進法: { meaning: 'Act for the Promotion of Measures to Prevent Bullying', reading: 'すいしんほう' },
    });
    const result = await new WordResolver(dict).resolve('女性活躍推進法', '女性活躍推進法', undefined, '名詞');
    expect(result.meaning).toMatch(/woman/);
    expect(result.meaning).toMatch(/promotion/);
    expect(result.meaning).toMatch(/law|method/);
    expect(result.meaning).not.toMatch(/Bullying/);
  });

  it('あすだ: pure-hiragana nouns are never split into nonsense (あ + すだ "Suda")', async () => {
    const dict = makeMockDictionary({
      あ: { meaning: 'I', reading: 'あ' },
      すだ: { meaning: 'Suda', reading: 'すだ' },
    });
    const result = await new WordResolver(dict).resolve('あすだ', 'あすだ', undefined, '名詞');
    expect(result.meaning).not.toMatch(/Suda/);
  });
});

describe('WordResolver – #257 follow-up: supplementary additions', { timeout: 30000 }, () => {
  it('入禅: Mimi-nashi Hoichi ritual word gets a curated gloss', async () => {
    const result = await new WordResolver(makeMockDictionary({})).resolve('入禅', '入禅', undefined, '名詞');
    expect(result.meaning).toMatch(/zen|meditation/i);
  });

  it('ポカリ: brand name gets a curated gloss', async () => {
    const result = await new WordResolver(makeMockDictionary({})).resolve('ポカリ', 'ポカリ', undefined, '名詞');
    expect(result.meaning).toMatch(/pocari|drink/i);
  });
});
