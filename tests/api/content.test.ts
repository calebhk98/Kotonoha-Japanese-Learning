import { describe, it, expect } from 'vitest';
import { apiGet } from './support/client.js';

describe('GET /api/content', () => {
  it('returns every story/music/video item on disk with the expected shape', async () => {
    const { status, body } = await apiGet<any[]>('/api/content');
    expect(status).toBe(200);
    expect(Array.isArray(body)).toBe(true);
    // CLAUDE.md's "163 entries" figure is already stale (this checkout has
    // 607 — the doc explicitly warns content counts drift); just assert the
    // harness's own reasonable floor rather than an exact number.
    expect(body.length).toBeGreaterThan(100);

    for (const item of body) {
      expect(typeof item.id).toBe('string');
      expect(item.id.length).toBeGreaterThan(0);
      expect(typeof item.title).toBe('string');
      expect(item.title.length).toBeGreaterThan(0);
      expect(['story', 'music', 'video']).toContain(item.type);
      expect(typeof item.text).toBe('string');
      expect(item.text.length).toBeGreaterThan(0);
    }
  });
});
