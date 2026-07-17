import { describe, it, expect } from 'vitest';
import { apiPost } from './support/client.js';

describe('POST /api/update-words', () => {
  it('scores a small words array and returns jlpt/joyo/score/breakdown', async () => {
    const { status, body } = await apiPost<any[]>('/api/update-words', {
      words: [{ word: '猫' }, { word: '本' }],
    });
    expect(status).toBe(200);
    expect(Array.isArray(body)).toBe(true);
    expect(body).toHaveLength(2);

    for (const w of body) {
      expect(typeof w.word).toBe('string');
      expect(typeof w.score).toBe('number');
      expect(typeof w.jlpt).toBe('number');
      expect(typeof w.joyo).toBe('boolean');
      expect(w.breakdown).toBeTruthy();
    }

    // 本's documented score (see CLAUDE.md / word.test.ts) — a stable pin
    // that this endpoint computes scores the same way /api/word does.
    const hon = body.find((w: any) => w.word === '本');
    expect(hon.score).toBe(1);
  });

  it('returns 400 when words is not an array', async () => {
    const { status } = await apiPost('/api/update-words', { words: 'not an array' });
    expect(status).toBe(400);
  });
});
