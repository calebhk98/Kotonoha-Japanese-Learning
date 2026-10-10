#!/usr/bin/env tsx
/**
 * Inspect how the app tokenizes and defines a piece of Japanese text,
 * sentence by sentence. Built for eyeballing results (by a human or an
 * agent): definition choice is a judgement call, so this prints everything
 * needed to make that call instead of asserting an answer.
 *
 * It runs the SAME pipeline as resolve-content (resolveContent on the whole
 * text) and then annotates each token with what the pipeline knew and did.
 *
 * Usage:
 *   npx tsx scripts/inspect-text.ts --text "彼は本を読みました。"
 *   npx tsx scripts/inspect-text.ts --file chapter.txt
 *   npx tsx scripts/inspect-text.ts --id <contentId>        # a content folder (comma list or 'all' ok)
 *   cat chapter.txt | npx tsx scripts/inspect-text.ts
 *
 * Options:
 *   --candidates     list every JMDict entry for each word, with pickBestEntry's score (✓ = picked)
 *   --raw            show raw (ungrouped) Sudachi mode-C morphemes per sentence
 *   --modes          show mode A / B / C splits per sentence
 *   --grep <str>     only sentences containing <str>
 *   --sentences a-b  only sentence numbers a..b (1-based)
 *   --flagged        only sentences with at least one flag
 *   --json           machine-readable output (one object per sentence)
 *   --no-context     skip the sentence-translation step (dictionary-only resolution)
 *   --stored         with --id: print the SAVED document the app serves (resolved.json,
 *                    or a saved import from data/imports/) instead of re-resolving;
 *                    --id also accepts import ids
 *   --summary        only per-item flag counts (use with --id a,b,c or --id all)
 *
 * Flags printed per token:
 *   SHARED     the app shows the definition resolved for an EARLIER occurrence
 *              of the same surface, and resolving THIS occurrence with its own
 *              reading/POS gives a different meaning or reading (shown in the flag)
 *   KEY≠       the lookup key (Sudachi normalized_form) and dictionary_form
 *              pick DIFFERENT JMDict entries
 *   UNKNOWN    no definition found
 *   SPLIT≠     tokenizing this sentence on its own gives different tokens
 *              than tokenizing the whole text (checked for every sentence)
 *
 * Needs the same setup as resolve-content (Sudachi WASM + extracted JMDict)
 * and holds the jmdict-db lock: stop the dev server first.
 */

import fs from 'fs';
import path from 'path';
import { createTokenizer, type RawMorpheme } from '../src/lib/tokenizers.js';
import { DictionaryManager } from '../src/lib/dictionary.js';
import { WordResolver, NON_CONJUGATING_POS } from '../src/lib/wordResolver.js';
import { resolveContent, stripFurigana } from '../src/lib/contentResolver.js';
import { listContentEntries, loadResolvedContent } from '../src/lib/storyLoader.js';
import { ImportStore } from '../src/lib/importStore.js';
import { PythonContextModel } from '../src/lib/contextModel.js';
import { ensureJmnedictPrepared } from '../src/lib/jmnedict-utils.js';
import { splitSentences } from '../src/lib/sentenceSplitter.js';

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const opt = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

// User imports (and saved edits of disk content) — same folder the server uses.
const importStore = new ImportStore(process.env.IMPORTS_DIR || path.join(process.cwd(), 'data', 'imports'));

function readInputs(): { label: string; text: string; id?: string }[] {
  const text = opt('--text');
  if (text) return [{ label: 'text', text }];
  const file = opt('--file');
  if (file) return [{ label: file, text: fs.readFileSync(file, 'utf8').trim() }];
  const ids = opt('--id');
  if (ids) {
    const entries = listContentEntries();
    const wanted = ids === 'all' ? entries.map((e) => e.id) : ids.split(',');
    return wanted.map((id) => {
      const saved = importStore.get(id);
      if (saved) return { label: id, id, text: saved.content.text.trim() };
      const entry = entries.find((e) => e.id === id);
      if (!entry) throw new Error(`No content folder or saved import with id "${id}"`);
      const name = entry.type === 'story' ? 'content.md' : 'transcript.md';
      return { label: id, id, text: fs.readFileSync(path.join(entry.dir, name), 'utf8').trim() };
    });
  }
  if (!process.stdin.isTTY) return [{ label: 'stdin', text: fs.readFileSync(0, 'utf8').trim() }];
  throw new Error('Give --text, --file, --id, or pipe text on stdin');
}

function shorten(s: string | undefined, n = 70): string {
  if (!s) return '';
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

function pad(s: string, n: number): string {
  // CJK characters are double width in a terminal.
  const width = [...s].reduce((w, c) => w + (/[ᄀ-ￜ]/.test(c) ? 2 : 1), 0);
  return s + ' '.repeat(Math.max(1, n - width));
}

const hira = (s?: string) =>
  s ? s.replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60)) : s;

function morphemeSpans(text: string, ms: RawMorpheme[]) {
  let pos = 0;
  return ms.map((m) => {
    const start = text.indexOf(m.surface, pos);
    pos = start >= 0 ? start + m.surface.length : pos;
    return { ...m, start };
  });
}

async function main() {
  const inputs = readInputs();

  // Library chatter goes to stderr so --json stays parseable.
  const log = console.log;
  console.log = (...a: any[]) => console.error(...a);
  const tokenizer: any = await createTokenizer();
  const jmnedictFile = await ensureJmnedictPrepared().catch(() => null);
  const dictionary = new DictionaryManager();
  await dictionary.initialize(
    'jmdict',
    path.join(process.cwd(), 'jmdict-db'),
    path.join(process.cwd(), 'jmdict-all-3.6.2.json'),
    (jmnedictFile as string) ?? undefined
  );
  const resolver = new WordResolver(dictionary);
  console.log = log;
  if (!(await dictionary.usingJmdict())) {
    throw new Error('JMDict did not open (is the dev server or another script holding the jmdict-db lock?). Refusing to print degraded output.');
  }
  if (typeof tokenizer.rawMorphemes !== 'function') {
    throw new Error('inspect-text needs the Sudachi WASM tokenizer (TOKENIZER unset or sudachi-wasm)');
  }

  // The translation context step (npm run setup-context), same as
  // resolve-content uses; --no-context shows the dictionary-only result.
  const context = flag('--no-context') || flag('--stored') ? null : await PythonContextModel.start();
  if (!context && !flag('--no-context') && !flag('--stored')) console.error('[inspect-text] translation context not set up (npm run setup-context): dictionary-only output');
  const totals: Record<string, number> = {};
  for (const input of inputs) {
    console.log = (...a: any[]) => console.error(...a);
    // --stored: print the saved document the app serves (resolved.json or a
    // saved import) instead of re-resolving with the current code.
    let resolved: any;
    if (flag('--stored')) {
      if (!input.id) throw new Error('--stored needs --id');
      resolved = importStore.get(input.id)?.resolved ?? loadResolvedContent(input.id);
      if (!resolved) throw new Error(`No saved resolution for "${input.id}" (run npm run resolve-content)`);
    } else {
      resolved = await resolveContent(input.text, tokenizer, resolver, new Map(), undefined, context ?? undefined);
    }
    console.log = log;
    const out = await inspect(input.text, resolved, tokenizer, dictionary, resolver);
    const counts: Record<string, number> = { sentences: out.length };
    for (const e of out) {
      for (const f of e.flags) counts[f.split('(')[0]] = (counts[f.split('(')[0]] ?? 0) + 1;
      for (const t of e.tokens) for (const f of t.flags) counts[f.split('(')[0]] = (counts[f.split('(')[0]] ?? 0) + 1;
    }
    for (const [k, v] of Object.entries(counts)) totals[k] = (totals[k] ?? 0) + v;
    if (flag('--summary')) {
      console.log(`${input.label}\t${JSON.stringify(counts)}`);
    } else {
      if (inputs.length > 1) console.log(`\n════ ${input.label}`);
      print(out);
    }
  }
  if (inputs.length > 1 || flag('--summary')) console.log(`TOTAL\t${JSON.stringify(totals)}`);
  context?.close();
}

// The same hint WordResolver builds (reading only for non-conjugating POS).
function hintFor(t: { pos?: string; reading?: string }) {
  const reading = t.reading && t.pos && NON_CONJUGATING_POS.has(t.pos) ? t.reading : undefined;
  return { ...(t.pos ? { pos: t.pos } : {}), ...(reading ? { reading } : {}) };
}

function firstGloss(entry: any, senses = 1): string {
  return (entry.sense ?? [])
    .map((x: any) => (x.gloss ?? []).filter((g: any) => g.lang === 'eng').map((g: any) => g.text)[0])
    .filter(Boolean)
    .slice(0, senses)
    .join('; ');
}

async function inspect(
  text: string,
  resolved: any,
  tokenizer: any,
  dictionary: DictionaryManager,
  resolver: WordResolver
): Promise<any[]> {
  const cache = new Map<string, any>();
  // Furigana in the text is stripped before tokenizing (as resolveContent
  // does); positions are mapped back onto the original text.
  const ruby = stripFurigana(text);
  const base = ruby?.stripped ?? text;
  const toOrig = (i: number) => (ruby && i >= 0 ? ruby.map[i] : i);
  const raw = morphemeSpans(base, tokenizer.rawMorphemes(base, 'C')).map((m) => ({ ...m, start: toOrig(m.start) }));
  // Grouped tokenizer output for the whole text, positioned (before
  // contentResolver's merges), to compare with tokenizing a sentence alone.
  let pos = 0;
  const wholeSeg = (await tokenizer.segment(base)).map((t: any) => {
    const start = base.indexOf(t.surface, pos);
    if (start >= 0) pos = start + t.surface.length;
    const end = start >= 0 ? start + t.surface.length : -1;
    return { surface: ruby && start >= 0 ? text.slice(toOrig(start), ruby.map[end - 1] + 1) : t.surface, bare: t.surface, start: toOrig(start) };
  });
  const rawAt = new Map(raw.map((m) => [m.start, m]));

  // Which (reading,pos) each word entry was actually resolved with: the first
  // token pointing at it.
  const resolvedWith = new Map<number, { reading?: string; pos?: string }>();
  for (const t of resolved.tokens as any[]) {
    if (t.wordIndex !== undefined && !resolvedWith.has(t.wordIndex)) {
      resolvedWith.set(t.wordIndex, { reading: t.reading, pos: t.pos });
    }
  }

  let sentences = splitSentences(text).map((s, i) => ({ ...s, n: i + 1 }));
  const range = opt('--sentences');
  if (range) {
    const [a, b] = range.split('-').map(Number);
    sentences = sentences.filter((s) => s.n >= a && s.n <= (b || a));
  }
  const grep = opt('--grep');
  if (grep) sentences = sentences.filter((s) => s.text.includes(grep));

  const out: any[] = [];
  for (const s of sentences) {
    const tokens = (resolved.tokens as any[]).filter((t) => t.startIndex >= s.start && t.startIndex < s.end);
    const crossing = tokens.filter((t) => t.endIndex > s.end).map((t) => t.surface);

    // Same sentence tokenized on its own.
    const alone = (await tokenizer.segment(stripFurigana(s.text)?.stripped ?? s.text)).map((t: any) => t.surface).join('|');
    const inContext = wholeSeg
      .filter((t: any) => t.start >= s.start && t.start < s.end)
      .map((t: any) => t.bare)
      .join('|');

    const rows = [];
    for (const t of tokens) {
      const word = t.wordIndex !== undefined ? resolved.words[t.wordIndex] : undefined;
      const m = rawAt.get(t.startIndex);
      const flags: string[] = [];
      const first = t.wordIndex !== undefined ? resolvedWith.get(t.wordIndex) : undefined;
      if (word && !t.isMorpheme && first && (first.reading !== t.reading || first.pos !== t.pos)) {
        // What this occurrence would get if resolved in its own context.
        const own = await resolver.resolve(t.surface, m?.normalizedForm ?? t.surface, cache, t.pos, t.reading);
        if (own.meaning !== word.meaning || own.reading !== word.reading) {
          flags.push(`SHARED(own context: ${own.reading} "${shorten(own.meaning, 40)}")`);
        }
      }
      if (word && !t.isMorpheme && m?.dictionaryForm && m.normalizedForm !== m.dictionaryForm) {
        const hint = hintFor(t);
        const [byNorm, byDict] = await Promise.all([
          dictionary.candidates(m.normalizedForm, hint),
          dictionary.candidates(m.dictionaryForm, hint),
        ]);
        const pick = (c: any[]) => c.find((x) => x.picked)?.entry;
        const a = pick(byNorm), b = pick(byDict);
        if (b && a?.id !== b.id) {
          const label = (e: any) => `${e.kanji?.[0]?.text ?? e.kana?.[0]?.text} "${shorten(firstGloss(e), 30)}"`;
          flags.push(`KEY≠(${m.normalizedForm}→${a ? label(a) : 'none'} | ${m.dictionaryForm}→${label(b)})`);
        }
      }
      if (word && /Unknown meaning/.test(word.meaning)) flags.push('UNKNOWN');
      if (word?.contextSense) flags.push(`CTX(sense ${word.contextSense + 1} chosen from the translation)`);

      const row: any = {
        surface: t.surface,
        // contentResolver re-joins split expressions; the raw morpheme's key
        // doesn't describe a merged token.
        lookupKey: wholeSeg.some((w: any) => w.start === t.startIndex && w.surface === t.surface)
          ? m?.normalizedForm
          : '(merged)',
        dictionaryForm: m?.dictionaryForm,
        reading: t.reading,
        pos: m?.pos?.filter((p) => p !== '*').join('-'),
        kind: t.isMorpheme ? 'grammar' : word ? 'vocab' : 'punct',
        shownReading: word?.reading,
        meaning: word?.meaning,
        flags,
      };
      if (flag('--candidates') && word && !t.isMorpheme) {
        const hint = hintFor(t);
        let cands = await dictionary.candidates(m?.normalizedForm ?? t.surface, hint);
        if (cands.length === 0) cands = await dictionary.candidates(t.surface, hint);
        row.candidates = cands.slice(0, 8).map((c) => ({
          picked: c.picked,
          score: c.score,
          forms: [...(c.entry.kanji ?? []).map((k: any) => k.text), ...(c.entry.kana ?? []).map((k: any) => k.text)]
            .slice(0, 4)
            .join('/'),
          pos: [...new Set((c.entry.sense ?? []).flatMap((x: any) => x.partOfSpeech ?? []))].slice(0, 4).join(','),
          gloss: firstGloss(c.entry, 3),
        }));
      }
      if (row.kind !== 'punct') rows.push(row);
    }

    const sentenceFlags: string[] = [];
    if (alone !== inContext) sentenceFlags.push('SPLIT≠');
    if (crossing.length) sentenceFlags.push(`CROSSES-BOUNDARY(${crossing.join(',')})`);
    const flagged = sentenceFlags.length > 0 || rows.some((r) => r.flags.length > 0);
    if (flag('--flagged') && !flagged) continue;

    const translation = resolved.sentences?.find((x: any) => x.start === s.start)?.translation;
    const entry: any = { n: s.n, start: s.start, text: s.text, ...(translation ? { translation } : {}), flags: sentenceFlags, tokens: rows };
    if (alone !== inContext) {
      entry.splitAlone = alone;
      entry.inText = inContext;
    }
    if (flag('--raw')) {
      entry.raw = tokenizer.rawMorphemes(s.text, 'C').map(
        (m: RawMorpheme) => `${m.surface}[${m.normalizedForm}/${m.dictionaryForm ?? '?'}|${hira(m.reading) ?? ''}|${m.pos.filter((p) => p !== '*').join('-')}]`
      );
    }
    if (flag('--modes')) {
      entry.modes = Object.fromEntries(
        (['A', 'B', 'C'] as const).map((md) => [md, tokenizer.rawMorphemes(s.text, md).map((m: RawMorpheme) => m.surface).join('|')])
      );
    }
    out.push(entry);
  }
  return out;
}

function print(out: any[]) {
  if (flag('--json')) {
    console.log(JSON.stringify(out, null, 1));
    return;
  }

  for (const e of out) {
    console.log(`\n── S${e.n} @${e.start} ${e.flags.join(' ')}`);
    console.log(e.text);
    if (e.translation) console.log(`EN: ${e.translation}`);
    if (e.splitAlone) {
      console.log(`  in text : ${e.inText}`);
      console.log(`  alone   : ${e.splitAlone}`);
    }
    if (e.modes) for (const [md, v] of Object.entries(e.modes)) console.log(`  mode ${md}  : ${v}`);
    if (e.raw) console.log(`  raw: ${e.raw.join(' ')}`);
    for (const t of e.tokens) {
      const key = t.lookupKey && t.lookupKey !== t.surface ? `→${t.lookupKey}` : '';
      console.log(
        `  ${pad(t.surface + key, 16)}${pad(t.shownReading ?? '', 12)}${pad(shorten(t.pos, 24), 26)}` +
          `${t.kind === 'grammar' ? '[g] ' : ''}${shorten(t.meaning)}${t.flags.length ? '   ⚑ ' + t.flags.join(' ') : ''}`
      );
      for (const c of t.candidates ?? []) {
        console.log(`      ${c.picked ? '✓' : ' '} ${String(c.score).padStart(4)}  ${pad(c.forms, 22)}${pad(c.pos, 18)}${shorten(c.gloss, 60)}`);
      }
    }
  }
  const total = out.length;
  const flaggedCount = out.filter((e) => e.flags.length || e.tokens.some((t: any) => t.flags.length)).length;
  console.log(`\n${total} sentence(s) shown, ${flaggedCount} with flags.`);
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e?.message ?? e);
    process.exit(1);
  }
);
