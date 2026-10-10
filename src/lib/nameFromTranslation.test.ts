import { describe, it, expect } from 'vitest';
import { romanizeKatakana, namesInTranslations, matchName } from './nameFromTranslation.js';

describe('romanizeKatakana', () => {
  it('handles long vowels, small kana and sokuon', () => {
    expect(romanizeKatakana('ゾルタン')).toBe('zorutan');
    expect(romanizeKatakana('ルーティ')).toBe('ruuti');
    expect(romanizeKatakana('レッド')).toBe('reddo');
    expect(romanizeKatakana('シャーロット')).toBe('shaarotto');
  });
});

describe('names from translations', () => {
  const tr = [
    'Zoltan was a quiet town.',
    'Ruti laughed and Red drew his sword.',
    'Then Red smiled at Ella.',
    'The red flower bloomed.',
  ];
  const names = namesInTranslations(tr);
  it('collects capitalized words that occur mid-sentence (sentence starts alone do not count)', () => {
    expect(names).toContain('Red');
    expect(names).toContain('Ella');
    expect(names).not.toContain('The');
    expect(names).not.toContain('Then');
  });
  it('a sentence-initial capital counts once the same word appears mid-sentence elsewhere', () => {
    expect(namesInTranslations(['Zoltan is far.', 'We went to Zoltan.'])).toContain('Zoltan');
    expect(namesInTranslations(['Zoltan is far.'])).not.toContain('Zoltan');
  });
  it('matches katakana spellings loosely (l/r, doubled letters, epenthetic vowels)', () => {
    const n = ['Zoltan', 'Ruti', 'Red', 'Ella', 'London'];
    expect(matchName('ゾルタン', n)).toBe('Zoltan');
    expect(matchName('ルーティ', n)).toBe('Ruti');
    expect(matchName('レッド', n)).toBe('Red');
    expect(matchName('エラ', n)).toBe('Ella');
    expect(matchName('ロンドン', n)).toBe('London');
    expect(matchName('ドア', n)).toBeUndefined();
    // Same consonants, different first vowel: ギルド "guild" is not "Guard".
    expect(matchName('ギルド', ['Guard'])).toBeUndefined();
  });
});
