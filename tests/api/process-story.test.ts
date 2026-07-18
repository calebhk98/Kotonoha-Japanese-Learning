import { describe, it, expect } from 'vitest';
import { apiPost } from './support/client.js';

// Any token whose surface contains at least one kana/kanji character (i.e.
// it's not pure punctuation/whitespace) should have been enriched with
// wordInfo + isVocabWord: true by /api/process-story — including single-kana
// particles like は/ね which the reader still needs to show a gloss for.
const JAPANESE_CHAR = /[ぁ-んァ-ヶ一-龠]/;

describe('POST /api/process-story', () => {
  it('enriches every Japanese token in 猫は魚が好きですね。 with wordInfo', async () => {
    const { status, body } = await apiPost<{ tokens: any[] }>('/api/process-story', {
      text: '猫は魚が好きですね。',
    });
    expect(status).toBe(200);
    expect(Array.isArray(body.tokens)).toBe(true);
    expect(body.tokens.length).toBeGreaterThan(0);

    const japaneseTokens = body.tokens.filter((t) => JAPANESE_CHAR.test(t.surface));
    // Sanity check: the particles we care about should actually show up as
    // their own tokens, not get silently merged/dropped.
    const surfaces = japaneseTokens.map((t) => t.surface);
    expect(surfaces).toContain('は');
    expect(surfaces).toContain('ね');

    for (const token of japaneseTokens) {
      expect(token.isVocabWord, `token "${token.surface}" should be isVocabWord`).toBe(true);
      expect(token.wordInfo, `token "${token.surface}" should have wordInfo`).toBeTruthy();
      expect(token.wordInfo.meaning).toBeTruthy();
    }
  });

  it('returns 400 when no text is provided', async () => {
    const { status } = await apiPost('/api/process-story', {});
    expect(status).toBe(400);
  });
});
