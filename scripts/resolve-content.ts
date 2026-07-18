#!/usr/bin/env tsx
/**
 * Build-time content resolution (issue #252).
 *
 * Tokenizes and dictionary-resolves every content item on disk and writes a
 * deterministic `resolved.json` next to it. The server serves these instead
 * of re-resolving at runtime, which removes the startup-extraction warmup
 * and makes pipeline changes reviewable as git diffs over the artifacts.
 *
 * Usage:
 *   npm run resolve-content              # resolve items missing resolved.json
 *   npm run resolve-content -- --all     # re-resolve everything (pipeline changed)
 *   npm run resolve-content -- --id <contentId>
 *
 * Run `npm run setup-sudachi` first (needs the WASM + system.dic) and make
 * sure jmdict-all-*.json is extracted (first `npm run dev` does this).
 *
 * Determinism: the dictionary waterfall is entirely local (JMDict -> JMnedict
 * -> kanji-data; see #256) so resolution never depends on network responses.
 * Words none of those can resolve fall back to the generic kana fallback,
 * same as offline runtime behavior.
 */

import fs from 'fs';
import path from 'path';
import { createTokenizer } from '../src/lib/tokenizers.js';
import { DictionaryManager } from '../src/lib/dictionary.js';
import { WordResolver } from '../src/lib/wordResolver.js';
import { resolveContent } from '../src/lib/contentResolver.js';
import { listContentEntries } from '../src/lib/storyLoader.js';
import { ensureJmnedictPrepared } from '../src/lib/jmnedict-utils.js';

async function main() {
  const args = process.argv.slice(2);
  const all = args.includes('--all');
  const idFlag = args.indexOf('--id');
  const onlyId = idFlag >= 0 ? args[idFlag + 1] : null;

  const jmdictFile = path.join(process.cwd(), 'jmdict-all-3.6.2.json');
  if (!fs.existsSync(jmdictFile)) {
    console.error('jmdict-all-3.6.2.json not extracted — run `npm run dev` once (it extracts the .tgz) and retry.');
    process.exit(1);
  }

  console.log('[resolve-content] Loading tokenizer...');
  const tokenizer = await createTokenizer();

  console.log('[resolve-content] Loading dictionaries...');
  const jmnedictFile = await ensureJmnedictPrepared().catch(() => null);
  const dictionary = new DictionaryManager();
  await dictionary.initialize(
    'jmdict',
    path.join(process.cwd(), 'jmdict-db'),
    jmdictFile,
    (jmnedictFile as string) ?? undefined
  );

  const resolver = new WordResolver(dictionary);
  const lookupCache = new Map<string, any>();

  let entries = listContentEntries();
  if (onlyId) entries = entries.filter((e) => e.id === onlyId);
  if (onlyId && entries.length === 0) {
    console.error(`[resolve-content] No content folder found for id "${onlyId}"`);
    process.exit(1);
  }

  let written = 0;
  let skipped = 0;
  let failed = 0;
  const started = Date.now();

  for (const [i, entry] of entries.entries()) {
    const outPath = path.join(entry.dir, 'resolved.json');
    if (!all && !onlyId && fs.existsSync(outPath)) {
      skipped++;
      continue;
    }

    const textFile = entry.type === 'story' ? 'content.md' : 'transcript.md';
    const textPath = path.join(entry.dir, textFile);
    if (!fs.existsSync(textPath)) {
      console.warn(`[resolve-content] ${entry.id}: missing ${textFile}, skipping`);
      skipped++;
      continue;
    }

    try {
      const text = fs.readFileSync(textPath, 'utf-8').trim();
      const resolved = await resolveContent(text, tokenizer, resolver, lookupCache);
      fs.writeFileSync(outPath, JSON.stringify(resolved) + '\n');
      written++;
      if (written % 25 === 0 || i === entries.length - 1) {
        console.log(`[resolve-content] ${written} written, ${skipped} skipped (${i + 1}/${entries.length})`);
      }
    } catch (e: any) {
      failed++;
      console.error(`[resolve-content] ${entry.id}: FAILED — ${e.message}`);
    }
  }

  const secs = ((Date.now() - started) / 1000).toFixed(1);
  console.log(`[resolve-content] Done in ${secs}s: ${written} written, ${skipped} skipped, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error('[resolve-content] Fatal:', e);
  process.exit(1);
});
