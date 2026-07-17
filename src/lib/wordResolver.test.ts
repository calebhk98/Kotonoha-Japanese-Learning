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
