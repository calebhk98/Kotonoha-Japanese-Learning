import { describe, it, expect } from 'vitest';
import { splitSentences } from './sentenceSplitter.js';

const texts = (s: string) => splitSentences(s).map((x) => x.text);

describe('splitSentences', () => {
  it('splits on terminators and keeps them attached', () => {
    expect(texts('猫が好きです。本を読みました！どう？')).toEqual(['猫が好きです。', '本を読みました！', 'どう？']);
  });

  it('does not split inside quotes, and keeps closing brackets with the sentence', () => {
    expect(texts('「こんにちは。元気？」と彼は言った。そうだ。')).toEqual([
      '「こんにちは。元気？」と彼は言った。',
      'そうだ。',
    ]);
    expect(texts('「何？！」')).toEqual(['「何？！」']);
  });

  it('treats newlines as boundaries and resets an unclosed quote', () => {
    expect(texts('「開いたまま\n次の行。')).toEqual(['「開いたまま', '次の行。']);
  });

  it('returns offsets into the original text', () => {
    const src = '  一。\n\n二。';
    for (const s of splitSentences(src)) expect(src.slice(s.start, s.end)).toBe(s.text);
  });
});
