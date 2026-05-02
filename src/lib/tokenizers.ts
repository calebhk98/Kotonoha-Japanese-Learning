import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const TinySegmenter = require('tiny-segmenter');

export interface TokenInfo {
  surface: string;      // The actual word as it appears (with conjugations)
  baseForm: string;     // Dictionary form for lookup (base form)
}

// Convert a morpheme to its dictionary form using POS tags and surface form
// POS format: [品詞, 品詞細分類1, 品詞細分類2, 品詞細分類3, 活用型, 活用形]
function getMorphemeBaseForm(surface: string, pos: string[]): string {
  const partOfSpeech = pos[0];
  const inflectionType = pos[4];
  const inflectionForm = pos[5];

  // For verbs, convert using inflection type and form
  if (partOfSpeech === '動詞' && inflectionType) {
    // 五段 (Godan) verbs - consonant stem
    if (inflectionType.startsWith('五段')) {
      const line = inflectionType.split('-')[1]; // e.g., 'カ行'

      // Handle continuative/past forms (連用形, 過去形)
      if (inflectionForm && (inflectionForm.startsWith('連用形') || inflectionForm.startsWith('過去形') || inflectionForm.startsWith('過去分詞形'))) {
        // Past form like "帰った" → "帰る", or continuative like "帰っ" → "帰る"
        if (line === 'カ行') return surface.slice(0, -1) + 'く';
        if (line === 'ガ行') return surface.slice(0, -1) + 'ぐ';
        if (line === 'サ行') return surface.slice(0, -1) + 'す';
        if (line === 'タ行') return surface.slice(0, -1) + 'つ';
        if (line === 'ナ行') return surface.slice(0, -1) + 'ぬ';
        if (line === 'ハ行') return surface.slice(0, -1) + 'ふ';
        if (line === 'マ行') return surface.slice(0, -1) + 'む';
        if (line === 'ヤ行') return surface.slice(0, -1) + 'う';
        if (line === 'ラ行') return surface.slice(0, -1) + 'る';
        if (line === 'ワ行' || line === 'ワア行') return surface.slice(0, -1) + 'う';
      }

      // Handle volitional/presumptive forms (意志形, 推量形, 未然形)
      if (inflectionForm && (inflectionForm.startsWith('意志形') || inflectionForm.startsWith('推量形') || inflectionForm.startsWith('未然形'))) {
        // Volitional like "作ろう" → "作る" (lines like ラ行 ending in ろ)
        if (line === 'ラ行' && surface.endsWith('ろ')) return surface.slice(0, -1) + 'る';
        if (line === 'カ行' && surface.endsWith('こ')) return surface.slice(0, -1) + 'く';
        if (line === 'ガ行' && surface.endsWith('ご')) return surface.slice(0, -1) + 'ぐ';
        if (line === 'サ行' && surface.endsWith('そ')) return surface.slice(0, -1) + 'す';
        if (line === 'タ行' && surface.endsWith('と')) return surface.slice(0, -1) + 'つ';
        if (line === 'ナ行' && surface.endsWith('の')) return surface.slice(0, -1) + 'ぬ';
        if (line === 'ハ行' && surface.endsWith('ほ')) return surface.slice(0, -1) + 'ふ';
        if (line === 'マ行' && surface.endsWith('も')) return surface.slice(0, -1) + 'む';
        if (line === 'ヤ行' && surface.endsWith('よ')) return surface.slice(0, -1) + 'う';
        if ((line === 'ワ行' || line === 'ワア行') && surface.endsWith('お')) return surface.slice(0, -1) + 'う';
      }

      // Masu stem or other forms
      if (inflectionForm && inflectionForm.startsWith('連用形')) {
        if (line === 'カ行' && (surface.endsWith('き') || surface.endsWith('い'))) return surface.slice(0, -1) + 'く';
        if (line === 'ガ行' && (surface.endsWith('ぎ') || surface.endsWith('い'))) return surface.slice(0, -1) + 'ぐ';
        if (line === 'サ行' && surface.endsWith('し')) return surface.slice(0, -1) + 'す';
        if (line === 'タ行' && (surface.endsWith('ち') || surface.endsWith('い'))) return surface.slice(0, -1) + 'つ';
        if (line === 'ナ行' && surface.endsWith('に')) return surface.slice(0, -1) + 'ぬ';
        if (line === 'ハ行' && surface.endsWith('ひ')) return surface.slice(0, -1) + 'ふ';
        if (line === 'マ行' && surface.endsWith('み')) return surface.slice(0, -1) + 'む';
        if (line === 'ヤ行' && surface.endsWith('い')) return surface.slice(0, -1) + 'う';
        if (line === 'ラ行' && surface.endsWith('り')) return surface.slice(0, -1) + 'る';
        if ((line === 'ワ行' || line === 'ワア行') && surface.endsWith('い')) return surface.slice(0, -1) + 'う';
      }
    }

    // 下一段 (Ichidan) verbs - vowel stem (ア行, バ行, ダ行, マ行, ヤ行, ラ行)
    if (inflectionType.startsWith('下一段-')) {
      const line = inflectionType.split('-')[1];
      // For ichidan verbs ending in え, べ, で, め, れ
      if (inflectionForm && (inflectionForm.startsWith('連用形') || inflectionForm.startsWith('未然形') || inflectionForm.startsWith('過去形'))) {
        if (line === 'ア行' && surface.endsWith('え')) return surface.slice(0, -1) + 'える';
        if (line === 'バ行' && surface.endsWith('べ')) return surface.slice(0, -1) + 'べる';
        if (line === 'ダ行' && surface.endsWith('で')) return surface.slice(0, -1) + 'でる';
        if (line === 'マ行' && surface.endsWith('め')) return surface.slice(0, -1) + 'める';
        if (line === 'ヤ行' && surface.endsWith('え')) return surface.slice(0, -1) + 'える';
        if (line === 'ラ行' && surface.endsWith('れ')) return surface.slice(0, -1) + 'れる';
        // Also handle when it ends with け, け for ケ系 (like 出かけ → 出かける)
        if (line === 'ケ行' && surface.endsWith('け')) return surface + 'る';
      }
      // For special patterns like 出かけ which is an ichidan verb
      if (surface.endsWith('け') && !surface.endsWith('える')) {
        return surface + 'る';
      }
    }

    // 上一段 (Ichidan) verbs - vowel stem (エ行, イ行)
    if (inflectionType.startsWith('上一段-')) {
      if (inflectionForm && (inflectionForm.startsWith('連用形') || inflectionForm.startsWith('未然形')) && surface.endsWith('い')) {
        if (inflectionType === '上一段-エ行') return surface.slice(0, -1) + 'える'; // wrong, should be える → いる? No, エ行 is 来る class
        if (inflectionType === '上一段-イ行') return surface.slice(0, -1) + 'いる';
      }
    }

    // サ行変格 (Sa-gyou irregular)
    if (inflectionType === 'サ行変格') {
      if (inflectionForm && (inflectionForm === '連用形-一般' || inflectionForm.startsWith('過去')) && surface.endsWith('し')) {
        return surface.slice(0, -1) + 'する';
      }
      if (inflectionForm === '未然形-一般' && surface.endsWith('せ')) {
        return surface.slice(0, -1) + 'する';
      }
    }

    // カ行変格 (Ka-gyou irregular) - くる
    if (inflectionType === 'カ行変格') {
      if (inflectionForm && (inflectionForm === '連用形-一般' || inflectionForm.startsWith('過去')) && surface.endsWith('き')) {
        return surface.slice(0, -1) + 'る';
      }
      if (inflectionForm === '未然形-一般' && surface.endsWith('こ')) {
        return 'くる';
      }
    }
  }

  // For i-adjectives, remove conjugations
  if (partOfSpeech === '形容詞') {
    if (inflectionForm === '連用形-一般' && surface.endsWith('い')) {
      return surface; // い-adjectives in 連用形 are the base
    }
  }

  // For auxiliary verbs
  if (partOfSpeech === '助動詞' && inflectionType === '助動詞-マス') {
    if (surface === 'ます' || surface === 'まし' || surface === 'ませ') {
      return 'ます'; // Base form of masu auxiliary
    }
  }

  // For na-adjectives (形状詞)
  if (partOfSpeech === '形状詞') {
    return surface; // These are usually already in dictionary form
  }

  // Fallback for verbs: if it ends in o-form (ろ, こ, etc.) and is a verb, convert to dictionary form
  if (partOfSpeech === '動詞') {
    // Volitional forms like 作ろう → 作る
    if (surface.endsWith('ろ')) return surface.slice(0, -1) + 'る';
    if (surface.endsWith('こ')) return surface.slice(0, -1) + 'く';
    if (surface.endsWith('ご')) return surface.slice(0, -1) + 'ぐ';
    if (surface.endsWith('そ')) return surface.slice(0, -1) + 'す';
    if (surface.endsWith('と')) return surface.slice(0, -1) + 'つ';
    if (surface.endsWith('の')) return surface.slice(0, -1) + 'ぬ';
    if (surface.endsWith('ほ')) return surface.slice(0, -1) + 'ふ';
    if (surface.endsWith('も')) return surface.slice(0, -1) + 'む';
    if (surface.endsWith('よ')) return surface.slice(0, -1) + 'う';
    if (surface.endsWith('お')) return surface.slice(0, -1) + 'う';
  }

  // If we can't determine, return surface as-is
  return surface;
}

export interface Tokenizer {
  name: string;
  segment(text: string): Promise<TokenInfo[]>;
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

  async segment(text: string): Promise<TokenInfo[]> {
    if (!this.segmenter) throw new Error('TinySegmenter not ready');
    const segments = this.segmenter.segment(text);
    // TinySegmenter doesn't provide base forms, so use surface form
    return segments.map(surface => ({ surface, baseForm: surface }));
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

  async segment(text: string): Promise<TokenInfo[]> {
    if (!this.dict) throw new Error('Sudachi-TS not initialized');
    const morphemes = this.dict.tokenize(text);
    return morphemes.map((m: any) => ({
      surface: m.surface(),
      baseForm: m.dictionaryForm?.() || m.surface(),
    }));
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
      initSync(wasmBuffer);

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

    // Simple approach: process each morpheme individually to avoid stack overflow
    // on large texts. Phrase grouping can be optimized separately if needed.
    for (let i = 0; i < morphemes.length; i++) {
      const m = morphemes[i];
      const pos = m.part_of_speech[0];
      const surface = m.surface;

      // Skip whitespace and punctuation
      if (pos === '補助記号' || /^\s+$/.test(surface)) {
        continue;
      }

      // Extract base form from POS tags
      const baseForm = getMorphemeBaseForm(surface, m.part_of_speech);

      result.push({ surface, baseForm });
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
