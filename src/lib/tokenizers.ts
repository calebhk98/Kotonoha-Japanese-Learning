import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const TinySegmenter = require('tiny-segmenter');

export interface Tokenizer {
  name: string;
  segment(text: string): Promise<string[]>;
  ready(): Promise<void>;
}

// TinySegmenter implementation
export class TinySegmenterImpl implements Tokenizer {
  name = 'TinySegmenter';
  private segmenter: TinySegmenter | null = null;

  async ready(): Promise<void> {
    this.segmenter = new TinySegmenter();
    console.log(`[Tokenizer] ${this.name} ready`);
  }

  async segment(text: string): Promise<string[]> {
    if (!this.segmenter) throw new Error('TinySegmenter not ready');
    return this.segmenter.segment(text);
  }
}

// Sudachi-TS implementation
export class SudachiTSImpl implements Tokenizer {
  name = 'Sudachi-TS';
  private dict: any = null;

  async ready(): Promise<void> {
    try {
      const { DictionaryFactory } = await import('sudachi-ts');
      const path = await import('path');
      const systemSmallPath = path.join(process.cwd(), 'sudachi-dictionary-20250129', 'system_small.dic');

      this.dict = await DictionaryFactory.create({
        configPath: path.join(process.cwd(), 'sudachi.json'),
        userDict: undefined,
      });
      console.log(`[Tokenizer] ${this.name} ready`);
    } catch (e: any) {
      console.warn(`[Tokenizer] ${this.name} initialization failed:`, e.message);
      throw e;
    }
  }

  async segment(text: string): Promise<string[]> {
    if (!this.dict) throw new Error('Sudachi-TS not initialized');
    const morphemes = this.dict.tokenize(text);
    return morphemes.map((m: any) => m.surface());
  }
}

// Lindera implementation
export class LinderaImpl implements Tokenizer {
  name = 'Lindera';
  private tokenizer: any = null;

  async ready(): Promise<void> {
    try {
      const lindera = await import('lindera-nodejs');
      this.tokenizer = lindera.tokenizer();
      console.log(`[Tokenizer] ${this.name} ready`);
    } catch (e: any) {
      console.warn(`[Tokenizer] ${this.name} initialization failed:`, e.message);
      throw e;
    }
  }

  async segment(text: string): Promise<string[]> {
    if (!this.tokenizer) throw new Error('Lindera not initialized');
    const result = this.tokenizer.tokenize(text);
    return result.map((token: any) => token.text || token);
  }
}

// Hiogawa Sudachi WASM implementation (with built-in dictionary)
export class SudachiWasmImpl implements Tokenizer {
  name = 'Sudachi WASM (Built)';
  private tokenizer: any = null;

  async ready(): Promise<void> {
    try {
      const { initSync, Tokenizer } = await import('../../sudachi-wasm-built/index.js');
      const fs = await import('fs');
      const path = await import('path');

      // Load and initialize the WASM module
      const wasmPath = path.join(process.cwd(), 'sudachi-wasm-built', 'index_bg.wasm');
      const wasmBuffer = fs.readFileSync(wasmPath);
      initSync(wasmBuffer);

      // Create tokenizer
      this.tokenizer = Tokenizer.create();
      console.log(`[Tokenizer] ${this.name} ready`);
    } catch (e: any) {
      console.warn(`[Tokenizer] ${this.name} initialization failed:`, e.message);
      throw e;
    }
  }

  async segment(text: string): Promise<string[]> {
    if (!this.tokenizer) throw new Error('Sudachi WASM not initialized');
    const morphemes = this.tokenizer.run(text, 'C');

    // Combine prefixes/suffixes with adjacent words
    const particles = new Set(['は', 'が', 'を', 'に', 'へ', 'と', 'で', 'も', 'か', 'の', 'て', 'な', 'だ']);
    const isPunctuation = (s: string) => /[、。！？・「」『』（）()[\]a-zA-Z0-9\s]/.test(s);

    const result: string[] = [];
    let i = 0;

    while (i < morphemes.length) {
      const m = morphemes[i];
      const surface = m.surface;
      const pos = m.part_of_speech[0];

      // Skip punctuation and particles
      if (isPunctuation(surface) || particles.has(surface)) {
        i++;
        continue;
      }

      // Start building a word unit
      let word = '';

      // Collect leading prefixes
      while (i < morphemes.length && morphemes[i].part_of_speech[0] === '接頭辞') {
        word += morphemes[i].surface;
        i++;
      }

      // Add the main word
      if (i < morphemes.length && !isPunctuation(morphemes[i].surface) && !particles.has(morphemes[i].surface)) {
        word += morphemes[i].surface;
        i++;
      }

      // Collect trailing suffixes
      while (i < morphemes.length && morphemes[i].part_of_speech[0] === '接尾辞') {
        word += morphemes[i].surface;
        i++;
      }

      if (word) {
        result.push(word);
      }
    }

    return result;
  }
}

// Kuromoji implementation (for reference/fallback)
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

  async segment(text: string): Promise<string[]> {
    if (!this.tokenizer) throw new Error('Kuromoji not initialized');
    const tokens = this.tokenizer.tokenize(text);
    return tokens.map((t: any) => t.surface_form);
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
    default:
      tokenizer = new TinySegmenterImpl();
      break;
  }

  await tokenizer.ready();
  return tokenizer;
}
