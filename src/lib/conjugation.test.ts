import { describe, it, expect } from 'vitest';
import { conjugationNote } from './conjugation.js';

// Reader test on 9 stories: grouped verbs showed only the dictionary meaning,
// so わかりません read as "to understand" and もう来ません as "already come".
const p = (surface: string, norm: string, pos: string, conj = '*') => ({ surface, norm, pos, conj });

describe('conjugationNote', () => {
  it('polite negative: わかりません → not · polite', () => {
    expect(conjugationNote('終止形-一般', [p('ませ', 'ます', '助動詞'), p('ん', 'ず', '助動詞')])).toBe('not · polite');
  });
  it('polite past and plain past', () => {
    expect(conjugationNote('連用形-一般', [p('まし', 'ます', '助動詞'), p('た', 'た', '助動詞')])).toBe('past · polite');
    expect(conjugationNote('連用形-促音便', [p('た', 'た', '助動詞')])).toBe('past');
  });
  it('-ている is ongoing, -てしまう completed, -てみる try', () => {
    expect(conjugationNote('連用形-促音便', [p('て', 'て', '助詞'), p('い', '居る', '動詞'), p('ます', 'ます', '助動詞')])).toBe('-ing (ongoing) · polite');
    expect(conjugationNote('連用形-一般', [p('て', 'て', '助詞'), p('しまっ', '仕舞う', '動詞'), p('た', 'た', '助動詞')])).toBe('past · completely / regretfully');
    expect(conjugationNote('連用形-一般', [p('て', 'て', '助詞'), p('み', '見る', '動詞'), p('ます', 'ます', '助動詞')])).toBe('try doing · polite');
  });
  it('bare te-form and command / volitional forms on the verb itself', () => {
    expect(conjugationNote('連用形-促音便', [p('て', 'て', '助詞')])).toBe('-te form ("and …" / "-ing")');
    expect(conjugationNote('命令形', [])).toBe('command');
    expect(conjugationNote('意志推量形', [])).toBe("let's / I'll");
  });
  it('plain dictionary form has no note', () => {
    expect(conjugationNote('終止形-一般', [])).toBeUndefined();
    expect(conjugationNote('連体形-一般', [])).toBeUndefined();
  });
});
