import { describe, it, expect } from 'vitest';
import { getDisplayProfile, DEFAULT_LANGUAGE } from './registry.js';
import { JAPANESE_PROFILE, katakanaToHiraganaJa } from './japanese.js';
import { isPunctuation, isSingleKana } from '../extraction-helpers.js';

// ---------------------------------------------------------------------------
// #258 – LanguageProfile.
//
// The profile is a MECHANICAL centralization of Japanese knowledge that was
// scattered across ~15 regex call sites. These tests pin two things:
// (1) parity — every profile predicate behaves exactly like the call site it
//     replaced (the committed resolved.json artifacts are the deeper check:
//     regenerating after the rewiring must produce a zero diff);
// (2) the profile-scoping semantics that FIX #258 blocker 2: isPunctuation
//     means "no target-language content", which is only correct per-language.
// ---------------------------------------------------------------------------

describe('language registry (#258)', () => {
  it('defaults to Japanese', () => {
    expect(DEFAULT_LANGUAGE).toBe('ja');
    expect(getDisplayProfile().code).toBe('ja');
    expect(getDisplayProfile('ja')).toBe(JAPANESE_PROFILE);
  });

  it('falls back to Japanese for unknown codes (content without a language field is ja)', () => {
    expect(getDisplayProfile('tlh').code).toBe('ja');
  });
});

describe('Japanese script profile – parity with the call sites it replaces (#258)', () => {
  const script = JAPANESE_PROFILE.script;

  it('isPunctuation matches extraction-helpers for every token class', () => {
    for (const s of ['。', '！', '…', '：', '②', '「', ' ', 'ABC', '123', '猫', 'ねこ', 'ネコ', 'ー', '々', '食べる', 'A猫']) {
      expect(script.isPunctuation(s)).toBe(isPunctuation(s));
    }
  });

  it('isGrammarFragment matches extraction-helpers isSingleKana', () => {
    for (const s of ['は', 'が', 'を', 'ん', 'カ', '猫', 'はは', 'a']) {
      expect(script.isGrammarFragment(s)).toBe(isSingleKana(s));
    }
  });

  it('containsContentChar matches the server request-validation regex', () => {
    expect(script.containsContentChar('猫が好き')).toBe(true);
    expect(script.containsContentChar('ひらがな')).toBe(true);
    expect(script.containsContentChar('カタカナ')).toBe(true);
    expect(script.containsContentChar('Hello world 123!')).toBe(false);
    expect(script.containsContentChar('Hello 猫')).toBe(true);
  });

  it('isPunctuation is per-language semantics: Spanish text is "no ja content" under the JA profile only', () => {
    // The old GLOBAL isPunctuation classified all Spanish/Hindi text as
    // punctuation (#258 blocker 2). Scoping it to a profile is the fix: for
    // the Japanese profile this answer is CORRECT (a Spanish token inside
    // Japanese content is not Japanese vocabulary); a future Spanish profile
    // returns false here.
    expect(script.isPunctuation('hola')).toBe(true);
    expect(script.isPunctuation('¿Cómo estás?')).toBe(true);
  });

  it('needsReadingAid: kanji surfaces yes, kana-only no (ContentReader parity)', () => {
    expect(script.needsReadingAid('食べる')).toBe(true);
    expect(script.needsReadingAid('ねこ')).toBe(false);
    expect(script.needsReadingAid('ネコ')).toBe(false);
  });

  it('normalizeReading converts katakana to hiragana, preserving long-vowel marks', () => {
    expect(script.normalizeReading('カタカナ')).toBe('かたかな');
    expect(script.normalizeReading('ケーキ')).toBe('けーき');
    expect(script.normalizeReading('ひらがな')).toBe('ひらがな');
    expect(katakanaToHiraganaJa('ギュッ')).toBe('ぎゅっ');
  });
});

describe('Japanese POS mapping (#258 blocker 3)', () => {
  it('maps Sudachi POS literals to neutral classes', () => {
    expect(JAPANESE_PROFILE.posClass('名詞')).toBe('noun');
    expect(JAPANESE_PROFILE.posClass('動詞')).toBe('verb');
    expect(JAPANESE_PROFILE.posClass('助詞')).toBe('particle');
    expect(JAPANESE_PROFILE.posClass('助動詞')).toBe('auxiliary');
    expect(JAPANESE_PROFILE.posClass('副詞')).toBe('adverb');
    expect(JAPANESE_PROFILE.posClass('感動詞')).toBe('interjection');
    expect(JAPANESE_PROFILE.posClass('形容詞')).toBe('adjective');
    expect(JAPANESE_PROFILE.posClass('連体詞')).toBe('determiner');
    expect(JAPANESE_PROFILE.posClass('補助記号')).toBe('symbol');
  });

  it('unknown or missing POS maps to other', () => {
    expect(JAPANESE_PROFILE.posClass('謎品詞')).toBe('other');
    expect(JAPANESE_PROFILE.posClass(undefined)).toBe('other');
  });

  it('posLabel is a readable English label', () => {
    expect(JAPANESE_PROFILE.posLabel('名詞')).toBe('noun');
    expect(JAPANESE_PROFILE.posLabel(undefined)).toBe('other');
  });
});

describe('Japanese score breakdown – generic rendering seam (#258 blocker 1)', () => {
  const breakdown = {
    jlptScore: 50,
    joyoPenalty: 20,
    highestGrade: 6,
    freqPenalty: -20,
    jlptValues: [4, 3],
    gradeValues: [2, 6],
    priorities: ['ichi1', 'news1'],
  };

  it('breakdownRows carries every display field with labels — no UI needs field names', () => {
    const rows = JAPANESE_PROFILE.breakdownRows(breakdown);
    const byKey = Object.fromEntries(rows.map((r) => [r.key, r]));
    expect(byKey.jlptScore.value).toBe(50);
    expect(byKey.jlptScore.label).toMatch(/JLPT/);
    expect(byKey.joyoPenalty.value).toBe(20);
    expect(byKey.freqPenalty.value).toBe(-20);
    expect(byKey.priorities.value).toBe('ichi1, news1');
  });

  it('breakdownRows tolerates null/missing breakdowns', () => {
    expect(JAPANESE_PROFILE.breakdownRows(null)).toEqual([]);
    expect(JAPANESE_PROFILE.breakdownRows(undefined)).toEqual([]);
  });

  it('isValidBreakdown matches the localStorage schema check in useContentData', () => {
    expect(JAPANESE_PROFILE.isValidBreakdown(breakdown)).toBe(true);
    // The legacy cache format (pre-jlptScore) must be rejected so stale
    // caches are discarded — same rule useContentData has always applied.
    expect(JAPANESE_PROFILE.isValidBreakdown({ baseScore: 10 })).toBe(false);
    expect(JAPANESE_PROFILE.isValidBreakdown(undefined)).toBe(false);
    expect(JAPANESE_PROFILE.isValidBreakdown(null)).toBe(false);
  });
});
