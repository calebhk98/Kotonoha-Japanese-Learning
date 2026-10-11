import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';
import fs from 'fs';
import path from 'path';
import readline from 'readline';
import type { SenseInfo } from './dictionary.js';

/**
 * Sentence translation as context for sense choice (step 3 of the
 * translation work). A small local ja->en translation model translates each
 * sentence; the English words it aligned to a token are compared (English
 * embeddings) with each sense of that token's JMDict entry. No LLM.
 *
 * Measured on held-out graded text (Oct 2026): switching to the best sense
 * only when it beats sense 1 by SENSE_MARGIN = 0.12 gave 31 better / 15
 * worse / 8 same over ~3,500 tokens. Lower margins break more (0.05: +15/-14
 * on the tuning set). Variants that scored worse and were rejected: exact
 * gloss-word overlap (+12/-6 tuning), WordNet synonyms, two translation
 * models averaged, and dictionary-anchored POS-aware one-to-one alignment
 * (held-out +20/-18).
 */

export interface ContextCandidate {
  /** Character span of the token within the sentence. */
  start: number;
  end: number;
  /** The token's JMDict senses (glosses per sense), in display order. */
  senses: string[][];
  /** Per sense: JMDict position, misc tags, entry flags (trained scorer input). */
  info?: SenseInfo[];
}
export interface ContextSentenceIn {
  text: string;
  candidates: ContextCandidate[];
}
export interface ContextSentenceOut {
  translation: string | null;
  /** Per candidate: English words aligned to it, and similarity to each sense. */
  candidates: { aligned: string[]; sims: number[]; probs?: number[] }[];
}
export interface ContextModel {
  enrich(sentences: ContextSentenceIn[]): Promise<ContextSentenceOut[]>;
  /** Translations alone (cached by the helper, so enrich reuses them). */
  translate?(sentences: string[]): Promise<(string | null)[]>;
  /** Kana-to-kanji conversion of kana-heavy sentences (kanaConversion.ts). */
  kanaToKanji?(sentences: string[]): Promise<(string | null)[]>;
}

export const SENSE_MARGIN = 0.12;

/**
 * Trained sense scorer (scripts/context/sense_scorer.py): multilingual-e5-small
 * features of the token in its Japanese sentence and of the English
 * translation, scored against each sense's glosses by a small network
 * trained on half the Tanaka corpus. It only picks among the senses of the
 * entry the pipeline already chose: switching ENTRIES was graded 3 better /
 * 63 worse on kana words. On 100 unseen corpus items, switches at
 * p >= MODEL_CONFIDENCE went 92 better / 29 worse / 29 same.
 */
export const MODEL_CONFIDENCE = 0.8;

/** Index of the sense to show from the scorer's probabilities (0 = keep). */
export function chooseSenseByModel(probs: number[], threshold = MODEL_CONFIDENCE): number {
  let best = 0;
  for (let k = 1; k < probs.length; k++) if (probs[k] > probs[best]) best = k;
  return best !== 0 && probs[best] >= threshold ? best : 0;
}
/**
 * Only the first MAX_SENSES senses compete. Graded on genre text (stories,
 * lyrics, poems, web fiction), switches to sense 5+ were wrong 4 times in 5
 * (金 "Friday", 行く "to stream", もの "cause of", 出る "to assume an
 * attitude"); switching to another ENTRY of the same spelling went 0 for 4
 * and was removed.
 */
export const MAX_SENSES = 4;

const STOP = new Set('a an the of to be is are was were it in on at by for with from as and or but not no that this he she they i you'.split(' '));
const stem = (w: string) => {
  const x = w.toLowerCase();
  return x.length > 4 ? x.replace(/(ing|ed|es|s)$/, '') : x;
};
const contentWords = (texts: string[]) =>
  new Set(texts.flatMap((t) => t.toLowerCase().match(/[a-z]+/g) ?? []).filter((w) => !STOP.has(w)).map(stem));

/**
 * Index of the sense to show: sense 0 unless another of the first
 * MAX_SENSES beats it by the margin, and never when an aligned English word
 * already appears in sense 0's glosses (星 aligned to "stars" stays "star"
 * even if "star (actor, player)" embeds closer).
 */
export function chooseSense(sims: number[], aligned: string[] = [], senses: string[][] = []): number {
  const n = Math.min(sims.length, MAX_SENSES);
  if (n < 2) return 0;
  let best = 0;
  for (let k = 1; k < n; k++) if (sims[k] > sims[best]) best = k;
  if (best === 0 || sims[best] - sims[0] <= SENSE_MARGIN) return 0;
  if (senses[0] && aligned.length > 0) {
    const first = contentWords(senses[0]);
    if (aligned.some((w) => first.has(stem(w)))) return 0;
  }
  return best;
}

/**
 * The Python helper (scripts/context/enrich.py) as a long-running child
 * process speaking JSON lines. Created by `start()`, which returns null when
 * the optional setup (npm run setup-context) hasn't been done, so callers
 * fall back to dictionary-only resolution.
 */
export class PythonContextModel implements ContextModel {
  private queue: Promise<unknown> = Promise.resolve();

  private constructor(
    private readonly proc: ChildProcessWithoutNullStreams,
    private readonly lines: AsyncIterator<string>
  ) {}

  static async start(root = process.cwd()): Promise<PythonContextModel | null> {
    const python = process.env.KOTONOHA_CONTEXT_PYTHON || path.join(root, '.venv-context', 'bin', 'python');
    const script = path.join(root, 'scripts', 'context', 'enrich.py');
    if (process.env.KOTONOHA_CONTEXT === 'off' || !fs.existsSync(python) || !fs.existsSync(script)) return null;
    const proc = spawn(python, ['-I', script], { stdio: ['pipe', 'pipe', 'pipe'] });
    // Model-loading chatter is dropped, but the helper's own warnings
    // (e.g. the trained sense scorer failing to load) are shown once.
    let warned = false;
    proc.stderr.on('data', (d: Buffer) => {
      const m = /\{"warning": "([^"]*)"\}/.exec(d.toString());
      if (m && !warned) {
        warned = true;
        console.warn(`[context] ${m[1]}`);
      }
    });
    const lines = readline.createInterface({ input: proc.stdout })[Symbol.asyncIterator]();
    const first = await lines.next();
    if (first.done || !JSON.parse(first.value).ready) {
      proc.kill();
      return null;
    }
    return new PythonContextModel(proc, lines);
  }

  private request(body: object): Promise<any> {
    // One request at a time over the pipe.
    const run = this.queue.then(async () => {
      this.proc.stdin.write(JSON.stringify(body) + '\n');
      const line = await this.lines.next();
      if (line.done) throw new Error('context helper exited');
      const resp = JSON.parse(line.value);
      if (resp.error) throw new Error(`context helper: ${resp.error}`);
      return resp;
    });
    this.queue = run.catch(() => {});
    return run;
  }

  enrich(sentences: ContextSentenceIn[]): Promise<ContextSentenceOut[]> {
    return this.request({ sentences }).then((r) => r.sentences as ContextSentenceOut[]);
  }

  kanaToKanji(sentences: string[]): Promise<(string | null)[]> {
    return this.request({ kana2kanji: sentences }).then((r) => r.converted as (string | null)[]);
  }

  translate(sentences: string[]): Promise<(string | null)[]> {
    return this.enrich(sentences.map((text) => ({ text, candidates: [] }))).then((r) => r.map((s) => s.translation));
  }

  close(): void {
    this.proc.stdin.end();
    this.proc.kill();
  }
}
