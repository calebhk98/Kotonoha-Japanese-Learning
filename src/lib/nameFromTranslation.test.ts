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

// Graded on 100 random corpus items: kana names (ゆき "snow", すずき "sea
// bass") and kana words Sudachi tagged as names (げんき "Genki").
describe('kana names confirmed by the translation', () => {
  it('spells the name: ゆき → Yuki, すずき in "suzukisan"', async () => {
    const { kanaNameIn } = await import('./nameFromTranslation.js');
    expect(kanaNameIn('ゆき', 'Takuya is 25 and Yuki is 27 years old.')).toBe('Yuki');
    expect(kanaNameIn('すずき', 'suzukisan came before noon.')).toBe('Suzuki');
  });
  it('does not confirm short or absent spellings', async () => {
    const { kanaNameIn } = await import('./nameFromTranslation.js');
    expect(kanaNameIn('げんき', "one way, another way, i'm a widow.")).toBeUndefined();
    expect(kanaNameIn('めい', 'she said, "Mei is here."')).toBeUndefined(); // < 4 letters: too easy to hit by chance
  });
});
