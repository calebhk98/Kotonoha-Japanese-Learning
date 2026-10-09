import { describe, it, expect } from 'vitest';
import { apiGet, apiPost, apiSend } from './support/client.js';

// Imported texts are resolved ONCE on the server and saved; the reader
// (/story), the vocab list (/words, /content/words) and the import list all
// read that saved document.
describe('/api/imports', () => {
  const text = '猫が好きです。本を読みました。';

  it('saves an import, then serves its reader tokens and vocab from the saved document', async () => {
    const created = await apiPost('/api/imports', { title: '猫', type: 'story', text });
    expect(created.status).toBe(200);
    const id: string = created.body.id;
    expect(id).toMatch(/^custom-/);

    const list = await apiGet<any[]>('/api/imports');
    expect(list.body.find((c) => c.id === id)).toMatchObject({ title: '猫', text });

    const story = await apiGet<{ tokens: any[]; precomputed: boolean }>(`/api/content/${id}/story`);
    expect(story.status).toBe(200);
    expect(story.body.precomputed).toBe(true);
    expect(story.body.tokens.length).toBeGreaterThan(0);
    for (const t of story.body.tokens) expect(text.slice(t.startIndex, t.endIndex)).toBe(t.surface);

    const words = await apiGet<any[]>(`/api/content/${id}/words`);
    expect(words.body.map((w) => w.word)).toContain('猫');

    const all = await apiGet<Record<string, any[]>>('/api/content/words');
    expect(all.body[id]?.map((w) => w.word)).toContain('猫');
  });

  it('keeps a client-supplied id (migration from browser storage)', async () => {
    const created = await apiPost('/api/imports', { id: 'custom-1700000000000', title: 'x', type: 'story', text });
    expect(created.body.id).toBe('custom-1700000000000');
  });

  it('re-resolves when the text is edited, and deletes', async () => {
    const { body } = await apiPost('/api/imports', { title: 't', type: 'story', text });
    const edited = await apiSend('PUT', `/api/imports/${body.id}`, { title: 't2', text: '犬が走る。' });
    expect(edited.status).toBe(200);
    const words = await apiGet<any[]>(`/api/content/${body.id}/words`);
    expect(words.body.map((w) => w.word)).toContain('犬');
    expect(words.body.map((w) => w.word)).not.toContain('猫');

    expect((await apiSend('DELETE', `/api/imports/${body.id}`)).status).toBe(200);
    expect((await apiGet(`/api/content/${body.id}/story`)).status).toBe(404);
  });

  it('rejects invalid ids, missing Japanese text and oversized text', async () => {
    expect((await apiPost('/api/imports', { id: '../x', title: 'x', type: 'story', text })).status).toBe(400);
    expect((await apiPost('/api/imports', { title: 'x', type: 'story', text: 'hello' })).status).toBe(400);
    expect((await apiPost('/api/imports', { title: 'x', type: 'story', text: '猫'.repeat(50001) })).status).toBe(400);
  });
});
