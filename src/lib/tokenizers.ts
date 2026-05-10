import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const TinySegmenter = require('tiny-segmenter');

export interface TokenInfo {
  surface: string;      // The actual word as it appears (with conjugations)
  baseForm: string;     // Dictionary form for lookup (base form)
}

export interface Tokenizer {
  name: string;
  segment(text: string): Promise<TokenInfo[]>;
  ready(): Promise<void>;
}

// TinySegmenter implementation
export class TinySegmenterImpl implements Tokenizer {
  name = 'TinySegmenter';
  private segmenter: InstanceType<typeof TinySegmenter> | null = null;

  async ready(): Promise<void> {
    this.segmenter = new TinySegmenter();
    console.log(`[Tokenizer] ${this.name} ready`);
  }

  async segment(text: string): Promise<TokenInfo[]> {
    if (!this.segmenter) throw new Error('TinySegmenter not ready');
    const segments = this.segmenter.segment(text);
    // TinySegmenter doesn't provide base forms, so use surface form
    return segments.map(surface => ({ surface, baseForm: surface }));
  }
}

/**
 * @deprecated Emergency fallback only. Not supported in production.
 * To re-enable: npm install sudachi-ts
 * Then set TOKENIZER=sudachi-ts before starting the server.
 */
export class SudachiTSImpl implements Tokenizer {
  name = 'Sudachi-TS';
  private dict: any = null;

  async ready(): Promise<void> {
    try {
      const { DictionaryFactory } = await import('sudachi-ts');
      const path = await import('path');
      const configPath = path.join(process.cwd(), 'sudachi.json');

      this.dict = await new DictionaryFactory().create(configPath);
      console.log(`[Tokenizer] ${this.name} ready`);
    } catch (e: any) {
      console.warn(`[Tokenizer] ${this.name} initialization failed:`, e.message);
      throw e;
    }
  }

  async segment(text: string): Promise<TokenInfo[]> {
    if (!this.dict) throw new Error('Sudachi-TS not initialized');
    const morphemes = this.dict.tokenize(text);
    return morphemes.map((m: any) => ({
      surface: m.surface(),
      baseForm: m.dictionaryForm?.() || m.surface(),
    }));
  }
}

/**
 * @deprecated Emergency fallback only. Not supported in production.
 * To re-enable: npm install lindera-nodejs
 * Then set TOKENIZER=lindera before starting the server.
 * Note: lindera-nodejs requires a native binary compatible with your platform.
 */
export class LinderaImpl implements Tokenizer {
  name = 'Lindera';
  private tokenizer: any = null;

  async ready(): Promise<void> {
    try {
      // @ts-expect-error no type declarations for lindera-nodejs
      const lindera = await import('lindera-nodejs');
      this.tokenizer = lindera.tokenizer();
      console.log(`[Tokenizer] ${this.name} ready`);
    } catch (e: any) {
      console.warn(`[Tokenizer] ${this.name} initialization failed:`, e.message);
      throw e;
    }
  }

  async segment(text: string): Promise<TokenInfo[]> {
    if (!this.tokenizer) throw new Error('Lindera not initialized');
    const result = this.tokenizer.tokenize(text);
    return result.map((token: any) => ({
      surface: token.text || token,
      baseForm: token.dictionary_form || token.text || token,
    }));
  }
}

// Hiogawa Sudachi WASM implementation (with built-in dictionary)
export class SudachiWasmImpl implements Tokenizer {
  name = 'Sudachi WASM';
  private tokenizer: any = null;

  async ready(): Promise<void> {
    try {
      const fs = await import('fs');
      const path = await import('path');

      // Load the built WASM module with embedded dictionary
      const wasmPath = (path.default || path).join(process.cwd(), 'sudachi-wasm-built', 'index_bg.wasm');
      const wasmModule = await import('../../sudachi-wasm-built/index.js');
      const { initSync, Tokenizer } = wasmModule;

      const wasmBuffer = (fs.readFileSync as any)(wasmPath);

      // Initialize the WASM module with embedded dictionary
      initSync({ module: wasmBuffer });

      // Create tokenizer (no dictionary needed - it's embedded)
      this.tokenizer = Tokenizer.create();
      console.log(`[Tokenizer] ${this.name} ready`);
    } catch (e: any) {
      console.warn(`[Tokenizer] ${this.name} initialization failed:`, e.message);
      throw e;
    }
  }

  async segment(text: string): Promise<TokenInfo[]> {
    if (!this.tokenizer) throw new Error('Sudachi WASM not initialized');
    const morphemes = this.tokenizer.run(text, 'C');

    const result: TokenInfo[] = [];

    // Group verb stems with their trailing auxiliaries so that e.g.
    // 走っ+て+い+ます becomes one token {surface:'走っています', baseForm:'走る'}.
    //
    // Only pure conjugation auxiliaries are grouped; semantic auxiliaries
    // (たい "want to", ない "not", られる passive/potential, させる causative)
    // keep their own tokens so their meanings remain visible to learners.
    //
    // Rules (applied in order per morpheme):
    //   - 補助記号 / whitespace                    → flush current group, skip
    //   - 助動詞 with norm in {ます,た,ず} after verb group → append surface only
    //   - て or で (助詞) after verb               → append surface, set tePending
    //   - 動詞 when tePending                      → append surface, clear tePending
    //   - anything else                            → flush current group, start new group
    const GROUPABLE_AUX = new Set(['ます', 'た', 'ず']);

    // Grammaticalized verbs that function as aspectual/benefactive auxiliaries
    // after the te-form (て/で). Content verbs like 食べる or 転ぶ must NOT be
    // included — they start a new clause, not a continuation of the same verb.
    const TE_CONTINUATION_VERBS = new Set([
      '居る',   // ている/ていた — progressive
      '呉れる', // てくれる — giving (someone does for me)
      '貰う',   // てもらう — receiving (I have someone do)
      '仕舞う', // てしまう — completion / regret
      'おく',   // ておく — advance preparation (Sudachi normalizes auxiliary おく to hiragana)
      '見る',   // てみる — try doing
      '有る',   // てある — resultant state
      '行く',   // ていく — receding action
      '来る',   // てくる — approaching action
      '上げる', // てあげる — doing for someone (upward benefactive)
      '為る',   // てする — (catches する after て, e.g. in compound verbs)
    ]);
    let groupSurface = '';
    let groupBaseForm = '';
    let groupIsVerb = false;
    let tePending = false;

    const flush = () => {
      if (groupSurface) {
        result.push({ surface: groupSurface, baseForm: groupBaseForm });
        groupSurface = '';
        groupBaseForm = '';
        groupIsVerb = false;
        tePending = false;
      }
    };

    for (let i = 0; i < morphemes.length; i++) {
      const m = morphemes[i];
      const pos = m.part_of_speech[0];
      const surface = m.surface;

      if (pos === '補助記号' || /^\s+$/.test(surface)) {
        flush();
        continue;
      }

      const baseForm = m.normalized_form || surface;

      if (!groupSurface) {
        groupSurface = surface;
        groupBaseForm = baseForm;
        groupIsVerb = pos === '動詞';
        tePending = false;
      } else if (groupIsVerb && pos === '助動詞' && GROUPABLE_AUX.has(m.normalized_form)) {
        groupSurface += surface;
        tePending = false;
      } else if (groupIsVerb && pos === '助詞' && (surface === 'て' || surface === 'で')) {
        // Conjunctive て/で — attach and wait for the continuation verb (いる, くれる, …)
        groupSurface += surface;
        tePending = true;
      } else if (tePending && pos === '動詞' && TE_CONTINUATION_VERBS.has(m.normalized_form)) {
        // Grammaticalized continuation verb after te-form (いる, くれる, しまう, …)
        // Content verbs (食べる, 走る, …) fall through to flush — they start a new clause.
        groupSurface += surface;
        tePending = false;
      } else {
        flush();
        groupSurface = surface;
        groupBaseForm = baseForm;
        groupIsVerb = pos === '動詞';
        tePending = false;
      }
    }

    flush();
    return result;
  }
}

/**
 * @deprecated Emergency fallback only. Poor hiragana support. Not supported in production.
 * To re-enable: npm install kuromoji
 * Then set TOKENIZER=kuromoji before starting the server.
 */
export class KuromojiImpl implements Tokenizer {
  name = 'Kuromoji';
  private tokenizer: any = null;

  async ready(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        const kuromoji = require('kuromoji');
        kuromoji.builder({ dicPath: 'node_modules/kuromoji/dict' }).build((err: any, tokenizer: any) => {
          if (err) {
            console.warn(`[Tokenizer] ${this.name} initialization failed:`, err.message);
            reject(err);
          } else {
            this.tokenizer = tokenizer;
            console.log(`[Tokenizer] ${this.name} ready`);
            resolve();
          }
        });
      } catch (e: any) {
        console.warn(`[Tokenizer] ${this.name} initialization failed:`, e.message);
        reject(e);
      }
    });
  }

  async segment(text: string): Promise<TokenInfo[]> {
    if (!this.tokenizer) throw new Error('Kuromoji not initialized');
    const tokens = this.tokenizer.tokenize(text);
    return tokens.map((t: any) => ({
      surface: t.surface_form,
      baseForm: t.basic_form || t.surface_form,
    }));
  }
}

export async function createTokenizer(name?: string): Promise<Tokenizer> {
  const tokenizerName = name || process.env.TOKENIZER || 'sudachi-wasm';

  let tokenizer: Tokenizer;

  switch (tokenizerName.toLowerCase()) {
    case 'sudachi-ts':
      tokenizer = new SudachiTSImpl();
      break;
    case 'sudachi-wasm':
      tokenizer = new SudachiWasmImpl();
      break;
    case 'lindera':
      tokenizer = new LinderaImpl();
      break;
    case 'kuromoji':
      tokenizer = new KuromojiImpl();
      break;
    case 'tinysegmenter':
      tokenizer = new TinySegmenterImpl();
      break;
    default:
      throw new Error(`Unknown tokenizer: ${tokenizerName}`);
  }

  await tokenizer.ready();
  return tokenizer;
}
