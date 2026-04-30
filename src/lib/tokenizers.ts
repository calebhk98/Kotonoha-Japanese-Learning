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

// Hiogawa Sudachi WASM implementation
export class SudachiWasmImpl implements Tokenizer {
  name = 'Sudachi WASM';
  private dict: any = null;

  async ready(): Promise<void> {
    try {
      const { initSync, DictionaryFactory } = await import('@hiogawa/sudachi.wasm');
      const fs = await import('fs');
      const path = await import('path');

      // Try to initialize with embedded dictionary
      const systemSmallPath = path.join(process.cwd(), 'sudachi-dictionary-20250129', 'system_small.dic');

      if (fs.existsSync(systemSmallPath)) {
        const wasmBuffer = fs.readFileSync(path.join(process.cwd(), 'node_modules', '@hiogawa', 'sudachi.wasm', 'dist', 'sudachi.wasm'));
        initSync(wasmBuffer);
        this.dict = DictionaryFactory.create({
          dictionaryPath: systemSmallPath,
        });
      } else {
        throw new Error('Dictionary file not found at ' + systemSmallPath);
      }

      console.log(`[Tokenizer] ${this.name} ready`);
    } catch (e: any) {
      console.warn(`[Tokenizer] ${this.name} initialization failed:`, e.message);
      throw e;
    }
  }

  async segment(text: string): Promise<string[]> {
    if (!this.dict) throw new Error('Sudachi WASM not initialized');
    const morphemes = this.dict.tokenize(text);
    return morphemes.map((m: any) => m.surface());
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
  const tokenizerName = name || process.env.TOKENIZER || 'TinySegmenter';

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
