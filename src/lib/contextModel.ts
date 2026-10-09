import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';
import fs from 'fs';
import path from 'path';
import readline from 'readline';

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
}
export interface ContextSentenceIn {
  text: string;
  candidates: ContextCandidate[];
}
export interface ContextSentenceOut {
  translation: string | null;
  /** Per candidate: English words aligned to it, and similarity to each sense. */
  candidates: { aligned: string[]; sims: number[] }[];
}
export interface ContextModel {
  enrich(sentences: ContextSentenceIn[]): Promise<ContextSentenceOut[]>;
}

export const SENSE_MARGIN = 0.12;

/** Index of the sense to show: sense 0 unless another beats it by the margin. */
export function chooseSense(sims: number[]): number {
  if (sims.length < 2) return 0;
  let best = 0;
  for (let k = 1; k < sims.length; k++) if (sims[k] > sims[best]) best = k;
  return best !== 0 && sims[best] - sims[0] > SENSE_MARGIN ? best : 0;
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
    proc.stderr.on('data', () => {}); // model-loading chatter
    const lines = readline.createInterface({ input: proc.stdout })[Symbol.asyncIterator]();
    const first = await lines.next();
    if (first.done || !JSON.parse(first.value).ready) {
      proc.kill();
      return null;
    }
    return new PythonContextModel(proc, lines);
  }

  enrich(sentences: ContextSentenceIn[]): Promise<ContextSentenceOut[]> {
    // One request at a time over the pipe.
    const run = this.queue.then(async () => {
      this.proc.stdin.write(JSON.stringify({ sentences }) + '\n');
      const line = await this.lines.next();
      if (line.done) throw new Error('context helper exited');
      const resp = JSON.parse(line.value);
      if (resp.error) throw new Error(`context helper: ${resp.error}`);
      return resp.sentences as ContextSentenceOut[];
    });
    this.queue = run.catch(() => {});
    return run;
  }

  close(): void {
    this.proc.stdin.end();
    this.proc.kill();
  }
}
