#!/usr/bin/env tsx
/**
 * Vocab master prototype (phase 1): split every committed resolved.json into
 * a shared master table + slim documents, verify the round trip, measure.
 * Never touches the repo's artifacts; output goes to --out.
 *
 *   npx tsx scripts/vocab-master-split.ts --out <dir> [--rebuild-scores]
 *
 * Verifies, for every artifact: join(split(x)) deep-equals x (and has the
 * same JSON text), and buildWordsResponse / buildStoryResponse give the
 * same output on the joined and the original document.
 *
 * --rebuild-scores additionally recomputes score/jlpt/joyo/breakdown of every
 * master entry from kanji-data with the real scoring code (what a scoring
 * change would have to redo) and reports the time and how many entries
 * reproduce their stored values. It needs no jmdict-db lock.
 */

import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { buildMaster, splitResolved, joinResolved, serializeMaster, deepEqual, type MasterEntry, type SlimDoc } from '../src/lib/vocabMaster.js';
import { buildStoryResponse, buildWordsResponse } from '../src/lib/contentResolver.js';

const args = process.argv.slice(2);
const outDir = args[args.indexOf('--out') + 1];
if (!outDir || args.indexOf('--out') < 0) {
  console.error('usage: vocab-master-split.ts --out <dir> [--rebuild-scores]');
  process.exit(1);
}
const gz = (b: Buffer | string) => zlib.gzipSync(b, { level: 9 }).length;
const ms = (t0: number) => Math.round(performance.now() - t0);

interface Item { id: string; file: string; raw: string; doc: any }
const items: Item[] = [];
for (const type of ['stories', 'music', 'videos']) {
  const root = path.join(process.cwd(), 'src', type);
  for (const d of fs.readdirSync(root).sort()) {
    const file = path.join(root, d, 'resolved.json');
    if (!fs.existsSync(file)) continue;
    const raw = fs.readFileSync(file, 'utf-8');
    items.push({ id: `${type}/${d}`, file, raw, doc: JSON.parse(raw) });
  }
}
console.log(`artifacts: ${items.length}`);

let t0 = performance.now();
const master = buildMaster(items.map((i) => i.doc));
console.log(`master entries: ${master.size} (built in ${ms(t0)} ms)`);

t0 = performance.now();
const slims = items.map((i) => splitResolved(i.doc, master));
const splitMs = ms(t0);
const serialized = slims.map((s) => JSON.stringify(s));

// ---- round trip
t0 = performance.now();
const joined = slims.map((s) => joinResolved(s, master));
const joinMs = ms(t0);
let deepOk = 0, textOk = 0, respOk = 0;
const failures: string[] = [];
items.forEach((it, i) => {
  const j = joined[i];
  const d = deepEqual(j, it.doc);
  const t = JSON.stringify(j) === JSON.stringify(it.doc);
  const r =
    deepEqual(buildWordsResponse(j), buildWordsResponse(it.doc)) && deepEqual(buildStoryResponse(j), buildStoryResponse(it.doc));
  if (d) deepOk++;
  if (t) textOk++;
  if (r) respOk++;
  if (!d || !r) failures.push(it.id);
});
console.log(`round trip: deepEqual ${deepOk}/${items.length}, identical JSON text ${textOk}/${items.length}, builders equal ${respOk}/${items.length}`);
if (failures.length) console.log('FAILED:', failures.slice(0, 10));

// ---- how much of each slim word is patch
let words = 0, withSet = 0, withDel = 0, withMeaning = 0, withCtx = 0;
const setFields = new Map<string, number>();
for (const s of slims) {
  for (const w of s.words) {
    words++;
    if (w.set) { withSet++; for (const f of Object.keys(w.set)) setFields.set(f, (setFields.get(f) ?? 0) + 1); }
    if (w.del) withDel++;
    if (w.meaning !== undefined) withMeaning++;
    if (w.contextSense !== undefined) withCtx++;
  }
}
console.log(`slim words ${words}: meaning override ${withMeaning}, contextSense ${withCtx}, set-patch ${withSet}, del-patch ${withDel}`);
console.log('set-patch fields:', Object.fromEntries([...setFields].sort((a, b) => b[1] - a[1])));

// ---- write output + sizes
fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(path.join(outDir, 'master'), { recursive: true });
let masterRaw = 0, masterGz = 0;
const shards = serializeMaster(master);
for (const [shard, text] of shards) {
  fs.writeFileSync(path.join(outDir, 'master', `${shard}.json`), text);
  masterRaw += Buffer.byteLength(text);
  masterGz += gz(text);
}
let slimRaw = 0, slimGz = 0, origRaw = 0, origGz = 0, origGzTotalInput: Buffer[] = [], slimAll: Buffer[] = [];
items.forEach((it, i) => {
  const dest = path.join(outDir, 'docs', `${it.id}.json`);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, serialized[i] + '\n');
  slimRaw += Buffer.byteLength(serialized[i]) + 1;
  slimGz += gz(serialized[i]);
  origRaw += Buffer.byteLength(it.raw);
  origGz += gz(it.raw);
  slimAll.push(Buffer.from(serialized[i]));
});
const wordsOnlyOrig = items.reduce((n, it) => n + Buffer.byteLength(JSON.stringify(it.doc.words)), 0);
const wordsOnlySlim = slims.reduce((n, s) => n + Buffer.byteLength(JSON.stringify(s.words)), 0);
const mb = (n: number) => (n / 1048576).toFixed(2) + ' MB';
console.log(`shards: ${shards.size}, avg ${(masterRaw / shards.size / 1024).toFixed(1)} KB`);
console.log(`BEFORE  artifacts raw ${mb(origRaw)}  gz(per file) ${mb(origGz)}   [words arrays only: ${mb(wordsOnlyOrig)}]`);
console.log(`AFTER   master raw ${mb(masterRaw)} gz ${mb(masterGz)}; slim docs raw ${mb(slimRaw)} gz ${mb(slimGz)}  [words arrays only: ${mb(wordsOnlySlim)}]`);
console.log(`AFTER   total raw ${mb(masterRaw + slimRaw)}  gz ${mb(masterGz + slimGz)}`);
console.log(`timing: split all ${splitMs} ms, join all ${joinMs} ms (${(joinMs / items.length).toFixed(2)} ms/doc)`);

// load time of the master from disk (what a server does at boot)
t0 = performance.now();
const loaded = new Map<string, MasterEntry>();
for (const shard of fs.readdirSync(path.join(outDir, 'master'))) {
  const obj = JSON.parse(fs.readFileSync(path.join(outDir, 'master', shard), 'utf-8'));
  for (const [k, v] of Object.entries(obj)) loaded.set(k, v as MasterEntry);
}
console.log(`master load from disk: ${loaded.size} entries in ${ms(t0)} ms`);
t0 = performance.now();
let rj = 0;
for (const f of fs.readdirSync(path.join(outDir, 'docs', 'stories')).slice(0, 50)) {
  const s: SlimDoc = JSON.parse(fs.readFileSync(path.join(outDir, 'docs', 'stories', f, ), 'utf-8'));
  joinResolved(s, loaded);
  rj++;
}
console.log(`read+join 50 slim docs from disk: ${ms(t0)} ms`);

// ---- scoring rebuild
if (args.includes('--rebuild-scores')) {
  const { getWordScoreBreakdown, getCachedDictionaryEntries, findBestVariant } = await import('../src/lib/scoring.js');
  const tIdx = performance.now();
  getCachedDictionaryEntries('猫'); // builds the one-time kanji-data index
  console.log(`kanji-data index build: ${ms(tIdx)} ms (one-time, shared by any scoring rebuild)`);
  // (A) pure rescoring from the STORED scoring inputs (surface + variant
  // priorities): what a scoring-constant/formula change needs once the
  // master records the variant it scored with.
  {
    const ta = performance.now();
    let na = 0, ok = 0;
    for (const e of master.values()) {
      if (e.isMorpheme) continue;
      na++;
      const pr = e.breakdown.priorities ?? [];
      const asVariant = getWordScoreBreakdown(e.word, { written: e.word, pronounced: e.reading, priorities: pr });
      const asNull = getWordScoreBreakdown(e.word, null);
      const hit = (r: any) => r.score === e.score && r.jlpt === e.jlpt && r.joyo === e.joyo && deepEqual(r.breakdown, e.breakdown);
      if (hit(asVariant) || hit(asNull)) ok++;
    }
    console.log(`rescore from stored variant: ${na} entries in ${ms(ta)} ms; reproduced ${ok} (${((ok / na) * 100).toFixed(1)}%)`);
  }
  // (B) full re-derivation from kanji-data (what the resolver does per word).
  const t = performance.now();
  let n = 0, same = 0;
  const diffs: Record<string, number> = {};
  const examples: string[] = [];
  for (const [key, e] of master) {
    if (e.isMorpheme) continue;
    n++;
    let entries = getCachedDictionaryEntries(e.word);
    const { variant } = findBestVariant(e.word, entries);
    const r = getWordScoreBreakdown(e.word, variant);
    if (r.score === e.score && r.jlpt === e.jlpt && r.joyo === e.joyo && deepEqual(r.breakdown, e.breakdown)) same++;
    else {
      const f = ['score', 'jlpt', 'joyo'].filter((x) => (r as any)[x] !== (e as any)[x]);
      if (!deepEqual(r.breakdown.priorities, e.breakdown.priorities)) f.push('priorities');
      const k = f.join('+') || 'breakdown-other';
      diffs[k] = (diffs[k] ?? 0) + 1;
      if (examples.length < 8) examples.push(`${key} stored=${e.score}/${JSON.stringify(e.breakdown.priorities)} recomputed=${r.score}/${JSON.stringify(r.breakdown.priorities)}`);
    }
  }
  console.log(`rebuild scores: ${n} master entries recomputed in ${ms(t)} ms; reproduced exactly ${same} (${((same / n) * 100).toFixed(1)}%)`);
  console.log('differences by field:', diffs);
  console.log(examples.join('\n'));
}
// ---- dictionary-level rebuild (sample): the real WordResolver per master entry.
// Needs the jmdict-db lock (stop any dev server / resolve-content first).
const sampleFlag = args.indexOf('--rebuild-dict');
if (sampleFlag >= 0) {
  const sample = Number(args[sampleFlag + 1] ?? 2000);
  const { DictionaryManager } = await import('../src/lib/dictionary.js');
  const { WordResolver } = await import('../src/lib/wordResolver.js');
  const { ensureJmnedictPrepared } = await import('../src/lib/jmnedict-utils.js');
  const tl = performance.now();
  const jmnedictFile = await ensureJmnedictPrepared().catch(() => null);
  const dictionary = new DictionaryManager();
  await dictionary.initialize('jmdict', path.join(process.cwd(), 'jmdict-db'), path.join(process.cwd(), 'jmdict-all-3.6.2.json'), (jmnedictFile as string) ?? undefined);
  if (!(await dictionary.usingJmdict())) { console.error('JMDict did not open (lock held?)'); process.exit(2); }
  console.log(`dictionary load: ${ms(tl)} ms`);
  const resolver = new WordResolver(dictionary);
  const cache = new Map<string, any>();
  const pool = [...master.values()].filter((e) => !e.isMorpheme);
  const step = Math.max(1, Math.floor(pool.length / sample));
  const picked = pool.filter((_, i) => i % step === 0).slice(0, sample);
  const t = performance.now();
  let i = 0, sameMeaning = 0, sameSenses = 0, sameScore = 0;
  await Promise.all(Array.from({ length: 8 }, async () => {
    while (i < picked.length) {
      const e = picked[i++];
      const r = await resolver.resolve(e.word, e.word, cache, e.pos, e.reading, undefined, { notGrammar: true });
      if (r.meaning === e.meaning) sameMeaning++;
      if (deepEqual(r.meanings, e.meanings) && deepEqual(r.senseSizes, e.senseSizes)) sameSenses++;
      if (r.score === e.score) sameScore++;
    }
  }));
  const el = performance.now() - t;
  console.log(`rebuild-dict sample ${picked.length}/${pool.length}: ${Math.round(el)} ms (${(el / picked.length).toFixed(1)} ms/entry => ~${((el / picked.length) * pool.length / 1000).toFixed(0)} s for all ${pool.length}); same headline ${sameMeaning}, same senses ${sameSenses}, same score ${sameScore}`);
}
process.exit(failures.length ? 1 : 0);
