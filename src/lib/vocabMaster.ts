/**
 * Master vocabulary table (prototype, phase 1).
 *
 * A resolved.json document stores a full copy of every word entry it uses.
 * Most of an entry is WORD-level (a function of the dictionary entry and the
 * spelling: reading, jlpt, joyo, score, breakdown, the sense list) and does
 * not depend on the sentence. This module splits a resolved document into
 *
 *   - MASTER entries: one per unique word (shared by every document), and
 *   - a SLIM document: the same tokens/sentences, but each `words[]` entry is
 *     just a master key plus its CONTEXT-level data (surface form, chosen
 *     sense, conjugation note, count) and, for the rare entry the master
 *     cannot reproduce, an explicit `set`/`del` patch.
 *
 * `joinResolved(split(x))` is byte-for-byte `x` (same JSON text), so readers,
 * `buildWordsResponse` and `buildStoryResponse` need no change: the server
 * joins once per content id and caches the result.
 *
 * Pure module (no fs, no dictionary, no scoring import): safe for client and
 * server. The key (`masterKey`) is the part that must change when the
 * resolver starts exposing JMDict entry ids; see
 * eval/vocab-master-design.md for the target design and how far this
 * prototype key is from it.
 */

export const MASTER_FORMAT_VERSION = 1;
/** formatVersion of a slim document (resolved.json itself is version 1). */
export const SLIM_FORMAT_VERSION = 2;

/** Word-level data of one unique word (the shape of a dictionary-form word entry). */
export interface MasterEntry {
  word: string;
  reading: string;
  /** Conjugating word: surface forms of it carry `lemma`/`lemmaReading` = word/reading. */
  inflects?: true;
  pos?: string;
  /** Default headline (sense 1). Contextual headlines are per-token overrides. */
  meaning?: string;
  jlpt: number;
  joyo: boolean;
  score: number;
  breakdown: any;
  isMorpheme?: true;
  /** All senses' glosses in the dictionary's NATIVE sense order. */
  meanings?: string[];
  senseSizes?: number[];
}

/** One `words[]` entry of a slim document: master key + context data. */
export interface SlimWord {
  /** Master key. */
  k: string;
  /** Surface spelling / reading when it differs from the master's. */
  word?: string;
  reading?: string;
  /** Per-context headline when it is not the master's (or the contextSense one). */
  meaning?: string;
  /** Sense chosen from the translation context (rotates the sense list). */
  contextSense?: number;
  /** Conjugation note ("past · -ing"). */
  form?: string;
  frequencyInContent?: number;
  /** Escape hatch: fields of the original entry that differ from the expansion. */
  set?: Record<string, any>;
  del?: string[];
}

export interface SlimDoc {
  formatVersion: typeof SLIM_FORMAT_VERSION;
  /** MASTER_FORMAT_VERSION the keys were made for. */
  master: number;
  /** formatVersion of the resolved document this expands to. */
  resolvedFormat: number;
  sentences?: any[];
  words: SlimWord[];
  tokens: any[];
  /** Entries whose key is not in the shared master yet (imports); win over it. */
  local?: Record<string, MasterEntry>;
}

export type MasterTable = Map<string, MasterEntry> | Record<string, MasterEntry>;

const lookup = (m: MasterTable, k: string): MasterEntry | undefined =>
  m instanceof Map ? m.get(k) : Object.prototype.hasOwnProperty.call(m, k) ? m[k] : undefined;

// ---------------------------------------------------------------------------
// helpers

/** Field order of every word entry the resolver emits (26 observed shapes are all subsets). */
const FIELD_ORDER = [
  'word', 'reading', 'meaning', 'jlpt', 'joyo', 'score', 'breakdown', 'isMorpheme', 'form',
  'lemma', 'lemmaReading', 'meanings', 'senseSizes', 'pos', 'contextSense', 'frequencyInContent',
];

function ordered(o: Record<string, any>): Record<string, any> {
  const out: Record<string, any> = {};
  for (const k of FIELD_ORDER) if (o[k] !== undefined) out[k] = o[k];
  for (const k of Object.keys(o)) if (!(k in out) && o[k] !== undefined) out[k] = o[k];
  return out;
}

export function deepEqual(a: any, b: any): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) return a.length === b.length && a.every((x, i) => deepEqual(x, b[i]));
  const ka = Object.keys(a).filter((k) => a[k] !== undefined);
  const kb = Object.keys(b).filter((k) => b[k] !== undefined);
  return ka.length === kb.length && ka.every((k) => deepEqual(a[k], b[k]));
}

function groupsOf(meanings: string[], sizes: number[]): string[][] | null {
  const groups: string[][] = [];
  let o = 0;
  for (const n of sizes) {
    groups.push(meanings.slice(o, o + n));
    o += n;
  }
  return o === meanings.length && groups.length > 0 ? groups : null;
}

/** The resolver's context switch: sense `s` first, the others after it. */
export function rotateSenses(meanings: string[], sizes: number[], s: number): { meanings: string[]; sizes: number[] } | null {
  const groups = groupsOf(meanings, sizes);
  if (!groups || s <= 0 || s >= groups.length) return null;
  const order = [groups[s], ...groups.filter((_, k) => k !== s)];
  return { meanings: order.flat(), sizes: order.map((g) => g.length) };
}

/** Inverse of rotateSenses: the native sense order of a switched entry. */
export function unrotateSenses(meanings: string[], sizes: number[], s: number): { meanings: string[]; sizes: number[] } | null {
  const groups = groupsOf(meanings, sizes);
  if (!groups || s <= 0 || s >= groups.length) return null;
  const [first, ...rest] = groups;
  rest.splice(s, 0, first);
  return { meanings: rest.flat(), sizes: rest.map((g) => g.length) };
}

/** Headline of a context-switched sense (mirrors contentResolver.resolveContent). */
function switchedHeadline(native: string[][], s: number): string {
  return `${native[s].slice(0, 2).join(', ')} (also: ${native[0][0]})`;
}

function nativeSenses(w: any): { meanings?: string[]; sizes?: number[] } {
  if (w.contextSense != null && w.meanings && w.senseSizes) {
    const u = unrotateSenses(w.meanings, w.senseSizes, w.contextSense);
    if (u) return { meanings: u.meanings, sizes: u.sizes };
  }
  return { meanings: w.meanings, sizes: w.senseSizes };
}

function headOf(w: any): { head: string; headReading: string } {
  return w.lemma
    ? { head: w.lemma, headReading: w.lemmaReading ?? w.reading }
    : { head: w.word, headReading: w.reading };
}

/**
 * PROTOTYPE master key. Target design: JMDict entry id + written form +
 * reading (+ a synthetic namespace for grammar labels, names, compositions,
 * supplementary and kanji-data entries). The artifacts do not store the
 * entry id, so this derives the closest stable proxy from what they do
 * store: headword (lemma for conjugating words), its reading, the
 * kanji-data variant's priority tags (they tell homographs apart: 愛 / name
 * あい / 藍) and the sense layout (sizes) of the dictionary entry.
 * Grammar morphemes are keyed by surface only (their label is per context).
 */
export function masterKey(w: any): string {
  if (w.isMorpheme) return `g|${w.word}`;
  const { head, headReading } = headOf(w);
  const { sizes } = nativeSenses(w);
  return [head, headReading, (w.breakdown?.priorities ?? []).join(','), sizes ? sizes.join('.') : ''].join('|');
}

// ---------------------------------------------------------------------------
// master construction

interface Template {
  reading: string;
  pos?: string;
  jlpt: number;
  joyo: boolean;
  score: number;
  breakdown: any;
  isMorpheme?: true;
  meanings?: string[];
  senseSizes?: number[];
}

function templateOf(w: any): Template {
  const { meanings, sizes } = nativeSenses(w);
  return {
    reading: headOf(w).headReading,
    ...(w.pos !== undefined ? { pos: w.pos } : {}),
    jlpt: w.jlpt,
    joyo: w.joyo,
    score: w.score,
    breakdown: w.breakdown,
    ...(w.isMorpheme ? { isMorpheme: true as const } : {}),
    ...(meanings ? { meanings } : {}),
    ...(sizes ? { senseSizes: sizes } : {}),
  };
}

/** Accumulates word entries from any number of documents and emits the master. */
export class MasterBuilder {
  private groups = new Map<
    string,
    {
      head: string;
      inflects: boolean;
      templates: Map<string, { n: number; t: Template }>;
      meanings: Map<string, number>;
      switchedFallback?: string;
    }
  >();

  addWords(words: any[]): void {
    for (const w of words) {
      const key = masterKey(w);
      let g = this.groups.get(key);
      if (!g) {
        g = { head: headOf(w).head, inflects: false, templates: new Map(), meanings: new Map() };
        this.groups.set(key, g);
      }
      if (w.lemma) g.inflects = true;
      const t = templateOf(w);
      const ts = JSON.stringify(t);
      const slot = g.templates.get(ts);
      if (slot) slot.n++;
      else g.templates.set(ts, { n: 1, t });
      if (w.contextSense == null) g.meanings.set(w.meaning, (g.meanings.get(w.meaning) ?? 0) + 1);
    }
  }

  addDocument(doc: { words: any[] }): void {
    this.addWords(doc.words);
  }

  /** Mode of each group (ties: first seen), keys in code-point order. */
  build(): Map<string, MasterEntry> {
    const out = new Map<string, MasterEntry>();
    for (const key of [...this.groups.keys()].sort()) {
      const g = this.groups.get(key)!;
      let best: { n: number; t: Template } | undefined;
      for (const s of g.templates.values()) if (!best || s.n > best.n) best = s;
      const t = best!.t;
      let meaning: string | undefined;
      let bestN = 0;
      for (const [m, n] of g.meanings) if (n > bestN) ((meaning = m), (bestN = n));
      if (meaning === undefined && t.meanings && t.senseSizes) {
        // Every occurrence was context-switched: sense 1's first two glosses.
        const groups = groupsOf(t.meanings, t.senseSizes);
        if (groups) meaning = groups[0].slice(0, 2).join(', ');
      }
      const e: MasterEntry = {
        word: g.head,
        reading: t.reading,
        ...(g.inflects ? { inflects: true as const } : {}),
        ...(t.pos !== undefined ? { pos: t.pos } : {}),
        ...(meaning !== undefined ? { meaning } : {}),
        jlpt: t.jlpt,
        joyo: t.joyo,
        score: t.score,
        breakdown: t.breakdown,
        ...(t.isMorpheme ? { isMorpheme: true as const } : {}),
        ...(t.meanings ? { meanings: t.meanings } : {}),
        ...(t.senseSizes ? { senseSizes: t.senseSizes } : {}),
      };
      out.set(key, e);
    }
    return out;
  }
}

export function buildMaster(docs: Iterable<{ words: any[] }>): Map<string, MasterEntry> {
  const b = new MasterBuilder();
  for (const d of docs) b.addDocument(d);
  return b.build();
}

// ---------------------------------------------------------------------------
// expand / contract one word

/** The word a slim entry expands to BEFORE its set/del patch. */
function expandBase(m: MasterEntry, s: SlimWord): Record<string, any> {
  const word = s.word ?? m.word;
  const reading = s.reading ?? m.reading;
  let meanings = m.meanings;
  let sizes = m.senseSizes;
  let meaning = m.meaning;
  const sense = s.contextSense;
  if (sense != null && meanings && sizes) {
    const native = groupsOf(meanings, sizes);
    const rot = rotateSenses(meanings, sizes, sense);
    if (native && rot) {
      meanings = rot.meanings;
      sizes = rot.sizes;
      meaning = switchedHeadline(native, sense);
    }
  }
  if (s.meaning !== undefined) meaning = s.meaning;
  const out: Record<string, any> = { word, reading, meaning, jlpt: m.jlpt, joyo: m.joyo, score: m.score, breakdown: m.breakdown };
  if (m.isMorpheme) out.isMorpheme = true;
  if (s.form !== undefined) out.form = s.form;
  if (m.inflects && word !== m.word) {
    out.lemma = m.word;
    out.lemmaReading = m.reading;
  }
  if (meanings) out.meanings = meanings;
  if (sizes) out.senseSizes = sizes;
  if (m.pos !== undefined) out.pos = m.pos;
  if (sense !== undefined) out.contextSense = sense;
  if (s.frequencyInContent !== undefined) out.frequencyInContent = s.frequencyInContent;
  return out;
}

export function expandWord(m: MasterEntry, s: SlimWord): any {
  const out = expandBase(m, s);
  if (s.set) Object.assign(out, s.set);
  if (s.del) for (const f of s.del) delete out[f];
  return ordered(out);
}

/** Smallest SlimWord that expands to `w` under master entry `m`. */
export function contractWord(m: MasterEntry, k: string, w: any): SlimWord {
  const s: SlimWord = { k };
  if (w.word !== m.word) s.word = w.word;
  if (w.reading !== m.reading) s.reading = w.reading;
  if (w.contextSense !== undefined) s.contextSense = w.contextSense;
  if (w.form !== undefined) s.form = w.form;
  if (w.frequencyInContent !== undefined) s.frequencyInContent = w.frequencyInContent;
  const base = expandBase(m, s);
  if (!deepEqual(base.meaning, w.meaning)) s.meaning = w.meaning;
  const cand = expandBase(m, s);
  const set: Record<string, any> = {};
  const del: string[] = [];
  for (const f of new Set([...Object.keys(cand), ...Object.keys(w)])) {
    const a = cand[f];
    const b = w[f];
    if (deepEqual(a, b)) continue;
    if (b === undefined) del.push(f);
    else set[f] = b;
  }
  if (Object.keys(set).length) s.set = set;
  if (del.length) s.del = del;
  return s;
}

// ---------------------------------------------------------------------------
// documents

/**
 * Resolved document -> slim document against `master`. A word whose key is
 * missing from the master is stored in `local` (so the slim doc is
 * self-contained; the next master rebuild promotes it) when
 * `embedMissing` is set, else it throws.
 */
export function splitResolved(doc: any, master: MasterTable, opts: { embedMissing?: boolean } = {}): SlimDoc {
  let local: Record<string, MasterEntry> | undefined;
  const words = doc.words.map((w: any) => {
    const k = masterKey(w);
    let m = local?.[k] ?? lookup(master, k);
    if (!m) {
      if (!opts.embedMissing) throw new Error(`splitResolved: no master entry for key ${k}`);
      const b = new MasterBuilder();
      b.addWords([w]);
      m = b.build().get(k)!;
      (local ??= {})[k] = m;
    }
    return contractWord(m, k, w);
  });
  return {
    formatVersion: SLIM_FORMAT_VERSION,
    master: MASTER_FORMAT_VERSION,
    resolvedFormat: doc.formatVersion,
    ...(doc.sentences ? { sentences: doc.sentences } : {}),
    words,
    tokens: doc.tokens,
    ...(local ? { local } : {}),
  };
}

/** Slim document + master -> the original resolved document. */
export function joinResolved(slim: SlimDoc, master: MasterTable): any {
  const words = slim.words.map((s) => {
    const m = slim.local?.[s.k] ?? lookup(master, s.k);
    if (!m) throw new Error(`joinResolved: no master entry for key ${s.k}`);
    return expandWord(m, s);
  });
  return {
    formatVersion: slim.resolvedFormat,
    ...(slim.sentences ? { sentences: slim.sentences } : {}),
    words,
    tokens: slim.tokens,
  };
}

/** Reader entry point: accepts both on-disk formats (migration path). */
export function toResolved(doc: any, master: MasterTable): any {
  return doc?.formatVersion === SLIM_FORMAT_VERSION ? joinResolved(doc as SlimDoc, master) : doc;
}

/** Convenience for a single document (tests, one-off imports): its own master. */
export function splitStandalone(doc: any): { master: Map<string, MasterEntry>; slim: SlimDoc } {
  const master = buildMaster([doc]);
  return { master, slim: splitResolved(doc, master) };
}

// ---------------------------------------------------------------------------
// shard layout (master on disk)

/** 256 shards by key hash: stable file for a key, ~100 entries each. */
export function shardOf(key: string): string {
  // FNV-1a (no crypto import: this module is client-safe).
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return (h & 0xff).toString(16).padStart(2, '0');
}

/** One entry per line, keys sorted: line-based git diffs show exactly the changed words. */
export function serializeShard(entries: [string, MasterEntry][]): string {
  const sorted = [...entries].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  return '{\n' + sorted.map(([k, e]) => `${JSON.stringify(k)}:${JSON.stringify(e)}`).join(',\n') + '\n}\n';
}

export function serializeMaster(master: Map<string, MasterEntry>): Map<string, string> {
  const shards = new Map<string, [string, MasterEntry][]>();
  for (const [k, e] of master) {
    const s = shardOf(k);
    if (!shards.has(s)) shards.set(s, []);
    shards.get(s)!.push([k, e]);
  }
  return new Map([...shards].sort().map(([s, es]) => [s, serializeShard(es)]));
}
