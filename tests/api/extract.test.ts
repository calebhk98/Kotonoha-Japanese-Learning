import { describe, it, expect } from 'vitest';
import { apiPost, findWord, type WordInfoLike } from './support/client.js';

describe('POST /api/extract', () => {
  it('resolves 猫が好きです。本を読みました。 to sensible per-word meanings', async () => {
    const { status, body } = await apiPost<WordInfoLike[]>('/api/extract', {
      text: '猫が好きです。本を読みました。',
    });
    expect(status).toBe(200);
    expect(Array.isArray(body)).toBe(true);

    // 猫 — primary sense must be "cat", not the archaic/slang senses further
    // down the JMDict entry (issue #187: sense-order fix).
    const neko = findWord(body, '猫');
    expect(neko, `words: ${body.map((w) => w.word).join(', ')}`).toBeTruthy();
    expect(neko!.meaning?.toLowerCase()).toContain('cat');

    // 本 — homograph selection prefers the entry whose primary written form
    // is the searched word, so this is the ほん "book" entry, never the
    // 元/本 もと "origin" entry that index-order ties used to surface.
    const hon = findWord(body, '本');
    expect(hon, `words: ${body.map((w) => w.word).join(', ')}`).toBeTruthy();
    expect(hon!.meaning.toLowerCase()).toContain('book');
    expect(hon!.meaning?.toLowerCase()).not.toBe('unknown meaning');

    // 読みました — conjugated polite-past form of 読む, grouped as a single
    // surface token (issue #189 verb-grouping fix) with a real "read"/"recite"
    // meaning, not "Unknown meaning". ("recite" is JMDict's literal top sense
    // for 読む; "read" is further down the sense list — both are accepted, matching
    // the existing tolerance in integration/test-server-api.ts.)
    const yomimashita = findWord(body, '読みました');
    expect(yomimashita, `words: ${body.map((w) => w.word).join(', ')}`).toBeTruthy();
    expect(yomimashita!.meaning?.toLowerCase()).not.toBe('unknown meaning');
    expect(yomimashita!.meaning?.toLowerCase()).toMatch(/read|recite/);

    // Particles が/です/を surface as grammatical morphemes, not vocabulary
    // words with "Unknown meaning" (issue #188).
    for (const particle of ['が', 'です', 'を']) {
      const tok = findWord(body, particle);
      expect(tok, `expected "${particle}" in: ${body.map((w) => w.word).join(', ')}`).toBeTruthy();
      expect(tok!.isMorpheme).toBe(true);
      expect(tok!.meaning?.toLowerCase()).not.toBe('unknown meaning');
    }
  });

  it('returns 400 when no text is provided', async () => {
    const { status, body } = await apiPost('/api/extract', {});
    expect(status).toBe(400);
    expect(body?.error).toBeTruthy();
  });

  it('returns 400 when the text contains no Japanese characters', async () => {
    const { status, body } = await apiPost('/api/extract', { text: 'hello world' });
    expect(status).toBe(400);
    expect(body?.error).toBeTruthy();
  });
});
