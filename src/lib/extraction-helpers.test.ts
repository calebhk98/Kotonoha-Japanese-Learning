import { describe, it, expect } from 'vitest';
import { PARTICLES, isPunctuation, isSingleKana, isHiraganaWord, isKatakanaWord, looksLikePartialStem, getGrammarDefinition } from './extraction-helpers.js';

describe('extraction helpers', () => {
  describe('isPunctuation', () => {
    it('returns true for Japanese punctuation characters', () => {
      for (const ch of ['。', '、', '！', '？', '・', '「', '」', '『', '』', '（', '）']) {
        expect(isPunctuation(ch), `expected isPunctuation('${ch}') to be true`).toBe(true);
      }
    });

    it('returns true for full-width punctuation that slipped through the old regex', () => {
      // These were previously extracted as vocabulary items with "Unknown meaning"
      // because the old regex only covered a limited allowlist of symbols.
      expect(isPunctuation('：')).toBe(true);   // full-width colon
      expect(isPunctuation('…')).toBe(true);    // horizontal ellipsis
      expect(isPunctuation('［')).toBe(true);   // full-width left bracket
      expect(isPunctuation('］')).toBe(true);   // full-width right bracket
      expect(isPunctuation('｜')).toBe(true);   // full-width vertical bar
      expect(isPunctuation('＃')).toBe(true);   // full-width hash
      expect(isPunctuation('②')).toBe(true);   // circled digit
    });

    it('returns true for ASCII alphanumerics and whitespace', () => {
      expect(isPunctuation('a')).toBe(true);
      expect(isPunctuation('Z')).toBe(true);
      expect(isPunctuation('0')).toBe(true);
      expect(isPunctuation(' ')).toBe(true);
    });

    it('returns false for kanji', () => {
      expect(isPunctuation('猫')).toBe(false);
      expect(isPunctuation('食')).toBe(false);
    });

    it('returns false for hiragana words', () => {
      expect(isPunctuation('ねこ')).toBe(false);
      expect(isPunctuation('は')).toBe(false);
    });

    it('returns false for katakana loanwords', () => {
      // Katakana words must NOT be filtered as punctuation; they are real vocabulary.
      expect(isPunctuation('ピクニック')).toBe(false);
      expect(isPunctuation('クレヨン')).toBe(false);
      expect(isPunctuation('ラビット')).toBe(false);
    });
  });

  describe('isSingleKana', () => {
    it('returns true for standard particles', () => {
      for (const p of ['は', 'が', 'を', 'に', 'へ', 'と', 'で', 'も', 'か', 'の', 'て', 'な', 'だ']) {
        expect(isSingleKana(p), `expected isSingleKana('${p}') to be true`).toBe(true);
      }
    });

    it('returns true for single hiragana non-particles', () => {
      expect(isSingleKana('あ')).toBe(true);
      expect(isSingleKana('い')).toBe(true);
      expect(isSingleKana('う')).toBe(true);
    });

    it('returns false for multi-character strings', () => {
      expect(isSingleKana('ねこ')).toBe(false);
      expect(isSingleKana('は　')).toBe(false);
    });

    it('returns false for single kanji', () => {
      expect(isSingleKana('猫')).toBe(false);
      expect(isSingleKana('日')).toBe(false);
    });

    it('returns false for katakana', () => {
      expect(isSingleKana('ア')).toBe(false);
    });
  });

  describe('isHiraganaWord', () => {
    it('returns true for pure hiragana strings', () => {
      expect(isHiraganaWord('ありがとう')).toBe(true);
      expect(isHiraganaWord('ねこ')).toBe(true);
      expect(isHiraganaWord('です')).toBe(true);
      expect(isHiraganaWord('は')).toBe(true);
    });

    it('returns false for mixed strings with kanji', () => {
      expect(isHiraganaWord('食べる')).toBe(false);
      expect(isHiraganaWord('猫は')).toBe(false);
    });

    it('returns false for katakana', () => {
      expect(isHiraganaWord('テスト')).toBe(false);
    });

    it('returns false for empty string', () => {
      expect(isHiraganaWord('')).toBe(false);
    });
  });

  describe('isKatakanaWord', () => {
    it('returns true for pure katakana including long-vowel mark', () => {
      expect(isKatakanaWord('テスト')).toBe(true);
      expect(isKatakanaWord('コーヒー')).toBe(true);
      expect(isKatakanaWord('ヴァイオリン')).toBe(true);
    });

    it('returns false for hiragana', () => {
      expect(isKatakanaWord('ねこ')).toBe(false);
    });

    it('returns false for mixed kanji-katakana', () => {
      expect(isKatakanaWord('日テレ')).toBe(false);
    });
  });

  describe('looksLikePartialStem', () => {
    it('returns true for verb stems ending in small tsu (っ)', () => {
      // These are cut-off conjugation artifacts — no valid Japanese dictionary
      // entry ends in っ. Sending them to Jisho returns geographic junk like
      // "Molazzana" (the original bug in issue #174).
      expect(looksLikePartialStem('もらっ')).toBe(true);
      expect(looksLikePartialStem('走っ')).toBe(true);
      expect(looksLikePartialStem('やっ')).toBe(true);
      expect(looksLikePartialStem('あっ')).toBe(true);
    });

    it('returns false for complete hiragana words', () => {
      expect(looksLikePartialStem('もらう')).toBe(false);
      expect(looksLikePartialStem('ありがとう')).toBe(false);
      expect(looksLikePartialStem('です')).toBe(false);
      expect(looksLikePartialStem('ねこ')).toBe(false);
    });

    it('returns false for words with っ in the middle (valid dictionary entries)', () => {
      // きって (stamp), もって (holding) etc. are valid words
      expect(looksLikePartialStem('きって')).toBe(false);
      expect(looksLikePartialStem('もって')).toBe(false);
      expect(looksLikePartialStem('まって')).toBe(false);
    });

    it('returns false for empty string', () => {
      expect(looksLikePartialStem('')).toBe(false);
    });
  });

  describe('PARTICLES', () => {
    it('contains the standard set of Japanese particles', () => {
      for (const p of ['は', 'が', 'を', 'に', 'へ', 'と', 'で', 'も', 'か', 'の', 'て', 'な', 'だ']) {
        expect(PARTICLES.has(p), `PARTICLES should contain '${p}'`).toBe(true);
      }
    });

    it('does not contain kanji or non-particle strings', () => {
      expect(PARTICLES.has('猫')).toBe(false);
      expect(PARTICLES.has('ありがとう')).toBe(false);
    });
  });
});

describe('getGrammarDefinition', () => {
  it('returns the surface definition for known morphemes (ます, は)', () => {
    expect(getGrammarDefinition('ます', 'ます')).toMatch(/polite/i);
    expect(getGrammarDefinition('は', 'は')).toMatch(/topic/i);
  });

  it('falls back to the base-form definition for conjugated auxiliaries', () => {
    expect(getGrammarDefinition('たく', 'たい')).toMatch(/want to/i);
    expect(getGrammarDefinition('なかっ', 'ない')).toMatch(/negat|not/i);
    expect(getGrammarDefinition('でし', 'です')).toMatch(/copula|polite/i);
  });

  it('prefers the surface definition when both surface and base form are in the table', () => {
    // ました "polite past form" must not be shadowed by ます "polite verb ending"
    expect(getGrammarDefinition('ました', 'ます')).toMatch(/polite past/i);
  });

  it('returns undefined for kanji-containing surfaces', () => {
    expect(getGrammarDefinition('見', '見る')).toBeUndefined();
    expect(getGrammarDefinition('読みました', '読む')).toBeUndefined();
  });

  it('does not consult the table for kanji base forms', () => {
    // し (surface) with base form 為る: 為る is not pure kana, so only the
    // surface entry applies.
    expect(getGrammarDefinition('ゆき', '行く')).toBeUndefined();
  });

  it('returns undefined for ordinary kana vocabulary not in the table', () => {
    expect(getGrammarDefinition('さくら', 'さくら')).toBeUndefined();
  });
});

describe('getGrammarDefinition – Sudachi kanji-normalized grammar verbs', () => {
  it('している (base 為る): progressive of する, not the 成る homograph', () => {
    expect(getGrammarDefinition('している', '為る')).toMatch(/doing|progressive/i);
  });

  it('した / します (base 為る): map to the する definition', () => {
    expect(getGrammarDefinition('した', '為る')).toMatch(/to do/i);
    expect(getGrammarDefinition('します', '為る')).toMatch(/to do/i);
  });

  it('いた / あった (bases 居る / 有る): map to the いる / ある definitions', () => {
    expect(getGrammarDefinition('いた', '居る')).toMatch(/to be/i);
    expect(getGrammarDefinition('あった', '有る')).toMatch(/to be/i);
  });

  it('ついて: the について grammar pattern gets a definition', () => {
    expect(getGrammarDefinition('ついて', 'つく')).toMatch(/about|concerning/i);
  });
});
