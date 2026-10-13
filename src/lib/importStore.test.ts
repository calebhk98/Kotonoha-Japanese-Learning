import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { ImportStore, isValidImportId } from './importStore.js';

const resolved = { formatVersion: 1, words: [{ word: '猫', reading: 'ねこ', meaning: 'cat' }], tokens: [] };
const item = { id: 'custom-1', title: 'Cat', description: 'Imported custom content.', type: 'story' as const, text: '猫です。' };

describe('ImportStore', () => {
  let dir: string;
  let store: ImportStore;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'imports-'));
    store = new ImportStore(dir);
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('saves an import with its resolved document and reads it back', () => {
    store.save(item, resolved);
    const got = store.get('custom-1');
    expect(got?.content).toMatchObject(item);
    expect(got?.resolved).toEqual(resolved);
  });

  it('survives a new store instance (persisted on disk)', () => {
    store.save(item, resolved);
    expect(new ImportStore(dir).get('custom-1')?.resolved).toEqual(resolved);
  });

  it('lists content metadata without the resolved documents', () => {
    store.save(item, resolved);
    store.save({ ...item, id: 'custom-2', title: 'Two' }, resolved);
    const list = store.list();
    expect(list.map((c) => c.id).sort()).toEqual(['custom-1', 'custom-2']);
    expect(list[0]).not.toHaveProperty('resolved');
  });

  it('returns null for unknown ids and removes saved ones', () => {
    expect(store.get('custom-9')).toBeNull();
    store.save(item, resolved);
    expect(store.remove('custom-1')).toBe(true);
    expect(store.get('custom-1')).toBeNull();
    expect(store.remove('custom-1')).toBe(false);
  });

  it('ignores a stored document with an unknown format version', () => {
    store.save(item, { ...resolved, formatVersion: 999 });
    expect(store.get('custom-1')?.resolved).toBeNull();
  });

  it('refuses ids that could escape the store directory', () => {
    expect(() => store.save({ ...item, id: '../evil' }, resolved)).toThrow();
    expect(store.get('../evil')).toBeNull();
    expect(store.remove('../../x')).toBe(false);
  });
});

describe('isValidImportId', () => {
  it('accepts generated and disk-style ids', () => {
    expect(isValidImportId('custom-1712345678901')).toBe(true);
    expect(isValidImportId('Kitsune-to-Tsuru')).toBe(true);
    expect(isValidImportId('nhk_japan_ramen2')).toBe(true);
  });
  it('rejects path segments, separators and empty ids', () => {
    for (const bad of ['', '.', '..', '../x', 'a/b', 'a\\b', 'x'.repeat(200)]) {
      expect(isValidImportId(bad)).toBe(false);
    }
  });
});
