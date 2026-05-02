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
      initSync(wasmBuffer);

      // Create tokenizer (no dictionary needed - it's embedded)
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

    const result: string[] = [];
    let i = 0;

    while (i < morphemes.length) {
      const m = morphemes[i];
      const pos = m.part_of_speech[0];
      const surface = m.surface;

      // Skip whitespace and punctuation
      if (pos === '補助記号' || /^\s+$/.test(surface)) {
        i++;
        continue;
      }

      // Collect leading adverbs/prefixes only if they're right before a verb/adjective/copular
      let adverbPhrase = '';
      let prefixPhrase = '';
      let tempI = i;
      while (tempI < morphemes.length) {
        const tempPos = morphemes[tempI].part_of_speech[0];
        if (tempPos === '副詞') {
          adverbPhrase += morphemes[tempI].surface;
          tempI++;
        } else if (tempPos === '接頭辞') {
          prefixPhrase += morphemes[tempI].surface;
          tempI++;
        } else {
          break;
        }
      }

      // Check what comes after the adverbs/prefixes
      let phrase = '';
      if (tempI < morphemes.length) {
        const nextPos = morphemes[tempI].part_of_speech[0];
        // Keep adverbs only if followed by verb/adjective
        if (adverbPhrase && ['動詞', '形容詞', '形状詞'].includes(nextPos)) {
          phrase = adverbPhrase;
        } else if (adverbPhrase && nextPos !== '接頭辞') {
          // Don't keep adverbs if followed by noun or other
          // (reset to beginning)
          tempI = i;
          phrase = '';
        } else {
          phrase = adverbPhrase;
        }

        // Always keep prefixes before their main word
        phrase += prefixPhrase;
        i = tempI;
      }

      // Now get the main content word or auxiliary
      if (i < morphemes.length) {
        const m = morphemes[i];
        const mainPos = m.part_of_speech[0];

        // Handle auxiliaries that aren't attached to anything (like でした broken into でし + た)
        if (mainPos === '助動詞' && !phrase) {
          phrase = m.surface;
          i++;
          // Collect any following auxiliaries
          while (i < morphemes.length && morphemes[i].part_of_speech[0] === '助動詞') {
            phrase += morphemes[i].surface;
            i++;
          }
          result.push(phrase);
          continue;
        }

        phrase += m.surface;
        i++;

        // Special case: number + counter (e.g., 六時, 三時)
        if (mainPos === '名詞' && morphemes[i] && morphemes[i].part_of_speech[0] === '名詞' && morphemes[i].part_of_speech[2] === '助数詞可能') {
          phrase += morphemes[i].surface;
          i++;
        }

        // Keep adding morphemes based on what the main word was
        while (i < morphemes.length) {
          const next = morphemes[i];
          const nextPos = next.part_of_speech[0];
          const nextSurface = next.surface;

          // Stop at whitespace and punctuation
          if (nextPos === '補助記号' || /^\s+$/.test(nextSurface)) {
            break;
          }

          // Keep suffixes attached to the main word
          if (nextPos === '接尾辞') {
            phrase += nextSurface;
            i++;
            continue;
          }

          // For verbs/adjectives/copular adjectives: keep conjunction particles and auxiliary chains together
          if (['動詞', '形容詞', '形状詞'].includes(mainPos)) {
            if (nextPos === '助詞' && next.part_of_speech[1] === '接続助詞') {
              phrase += nextSurface;
              i++;
              // After conjunction particle, continue collecting dependent verbs and auxiliaries
              while (i < morphemes.length) {
                const afterConjunction = morphemes[i];
                const afterConPos = afterConjunction.part_of_speech[0];
                const afterConSurface = afterConjunction.surface;

                if (afterConPos === '補助記号' || /^\s+$/.test(afterConSurface)) {
                  break;
                }

                // Collect dependent verbs and auxiliaries after the conjunction
                if ((afterConPos === '動詞' && afterConjunction.part_of_speech[1] === '非自立可能') || afterConPos === '助動詞') {
                  phrase += afterConSurface;
                  i++;
                } else {
                  break;
                }
              }
              continue;
            }

            // Keep auxiliary verbs in verb phrases
            if (nextPos === '助動詞') {
              phrase += nextSurface;
              i++;
              continue;
            }

            // Keep dependent verbs (非自立) - they're part of the verb chain
            if (nextPos === '動詞' && next.part_of_speech[1] === '非自立可能') {
              phrase += nextSurface;
              i++;
              continue;
            }

            // Regular particles end the verb phrase
            if (nextPos === '助詞') {
              break;
            }
          }

          // For nouns: don't attach auxiliary verbs (like です), they should be separate
          if (mainPos === '名詞') {
            // Keep suffixes (already handled above)
            // But don't attach です or other auxiliaries to nouns
            break;
          }

          // Other cases: don't attach
          break;
        }
      }

      if (phrase) {
        result.push(phrase);
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
      tokenizer = new TinySegmenterImpl();
      break;
    default:
      throw new Error(`Unknown tokenizer: ${tokenizerName}`);
  }

  await tokenizer.ready();
  return tokenizer;
}
