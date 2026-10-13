import { describe, it, expect } from 'vitest';
import { buildHeadline } from './dictionary';

const sense = (gloss: string, extra: Record<string, any> = {}) => ({
  gloss: [{ lang: 'eng', text: gloss }],
  misc: [],
  field: [],
  info: [],
  ...extra,
});
const sorted = (...senses: any[]) => senses.map((s, i) => ({ sense: s, commonness: 0 - i * 0 }));

describe('buildHeadline "(also: …)" only shows a plain second sense', () => {
  it('shows an unmarked second sense', () => {
    expect(buildHeadline(sorted(sense('mother'), sense('parent')), ['eng'])).toBe('mother (also: parent)');
  });

  it('skips a colloquial second sense (息子 son / penis)', () => {
    expect(buildHeadline(sorted(sense('son'), sense('penis', { misc: ['col'] })), ['eng'])).toBe('son');
  });

  it('skips a familiar / speaker-dependent second sense (僕 I / you)', () => {
    expect(
      buildHeadline(sorted(sense('I, me', { misc: ['male'] }), sense('you', { misc: ['col'], info: ['when addressing a young boy'] })), ['eng'])
    ).toBe('I, me');
  });

  it('skips an honorific-marked second sense (お母さん mother / wife)', () => {
    expect(buildHeadline(sorted(sense('mother'), sense('wife', { misc: ['hon'] })), ['eng'])).toBe('mother');
  });

  it('skips a second sense carrying a usage note (両手 hands / ten)', () => {
    expect(
      buildHeadline(sorted(sense('both hands'), sense('ten', { info: ['used as secret jargon'] })), ['eng'])
    ).toBe('both hands');
  });

  it('skips an adult gloss even when untagged', () => {
    expect(buildHeadline(sorted(sense('son'), sense('penis')), ['eng'])).toBe('son');
  });

  it('keeps uk-tagged second senses (only a writing-style tag)', () => {
    expect(buildHeadline(sorted(sense('carrot'), sense('turnip', { misc: ['uk'] })), ['eng'])).toBe('carrot (also: turnip)');
  });
});
