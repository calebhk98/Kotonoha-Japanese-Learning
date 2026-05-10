import { describe, it, expect } from 'vitest';
import { PARTICLES, isPunctuation, isSingleKana, isHiraganaWord, isKatakanaWord } from './extraction-helpers.js';

describe('extraction helpers', () => {
  describe('isPunctuation', () => {
    it('returns true for Japanese punctuation characters', () => {
      for (const ch of ['。', '、', '！', '？', '・', '「', '」', '『', '』', '（', '）']) {
        expect(isPunctuation(ch), `expected isPunctuation('${ch}') to be true`).toBe(true);
      }
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
