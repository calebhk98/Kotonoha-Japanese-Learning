import { describe, it, expect } from 'vitest';
import { apiPost, findWord, primarySense } from './support/client.js';

// Issue #188 was exactly this class of bug: three independent lookup paths
// (extract / process-story / word-detail) disagreeing about a word's
// reading or meaning because only some of them were routed through
// resolveWordMeaning. This test pins that /api/extract and /api/process-story
// still agree for a representative sentence.
const TEXT = '家の前で本を読みました';
const WORDS_TO_CHECK = ['家', '前', '本', '読みました'];

describe('/api/extract vs /api/process-story consistency', () => {
  it(`agree on reading + meaning for ${TEXT}`, async () => {
    const [extractRes, storyRes] = await Promise.all([
      apiPost<any[]>('/api/extract', { text: TEXT }),
      apiPost<{ tokens: any[] }>('/api/process-story', { text: TEXT }),
    ]);

    expect(extractRes.status).toBe(200);
    expect(storyRes.status).toBe(200);

    const extractWords = extractRes.body;
    const storyWordInfos = storyRes.body.tokens
      .filter((t) => t.wordInfo)
      .map((t) => t.wordInfo);

    for (const word of WORDS_TO_CHECK) {
      const fromExtract = findWord(extractWords, word);
      const fromStory = findWord(storyWordInfos, word);

      expect(fromExtract, `${word} missing from /api/extract`).toBeTruthy();
      expect(fromStory, `${word} missing from /api/process-story`).toBeTruthy();

      expect(fromStory!.reading).toBe(fromExtract!.reading);
      expect(primarySense(fromStory!.meaning)).toBe(primarySense(fromExtract!.meaning));
    }
  });
});
