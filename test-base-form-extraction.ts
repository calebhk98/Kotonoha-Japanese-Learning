import { createRequire } from 'module';
const path = await import('path');
const fs = await import('fs');

const wasmPath = (path.default || path).join(process.cwd(), 'sudachi-wasm-built', 'index_bg.wasm');
const wasmModule = await import('./sudachi-wasm-built/index.js');
const { initSync, Tokenizer } = wasmModule;

const wasmBuffer = fs.readFileSync(wasmPath);
initSync(wasmBuffer);

const tokenizer = Tokenizer.create();

// Helper function from tokenizers.ts
function getMorphemeBaseForm(surface: string, pos: string[]): string {
  const partOfSpeech = pos[0];
  const inflectionType = pos[4];
  const inflectionForm = pos[5];

  // For verbs, convert using inflection type and form
  if (partOfSpeech === '動詞' && inflectionType) {
    // 五段 (Godan) verbs - consonant stem
    if (inflectionType.startsWith('五段')) {
      const line = inflectionType.split('-')[1]; // e.g., 'カ行'
      if (inflectionForm === '連用形-一般') {
        // Masu stem: replace final hiragana with dictionary form
        if (line === 'カ行' && surface.endsWith('き')) return surface.slice(0, -1) + 'く';
        if (line === 'ガ行' && surface.endsWith('ぎ')) return surface.slice(0, -1) + 'ぐ';
        if (line === 'サ行' && surface.endsWith('し')) return surface.slice(0, -1) + 'す';
        if (line === 'タ行' && surface.endsWith('ち')) return surface.slice(0, -1) + 'つ';
        if (line === 'ナ行' && surface.endsWith('に')) return surface.slice(0, -1) + 'ぬ';
        if (line === 'ハ行' && surface.endsWith('ひ')) return surface.slice(0, -1) + 'ふ';
        if (line === 'マ行' && surface.endsWith('み')) return surface.slice(0, -1) + 'む';
        if (line === 'ヤ行' && surface.endsWith('い')) return surface.slice(0, -1) + 'う';
        if (line === 'ラ行' && surface.endsWith('り')) return surface.slice(0, -1) + 'る';
        if (line === 'ワ行' && surface.endsWith('い')) return surface.slice(0, -1) + 'う';
      }
      if (inflectionForm === '未然形-一般') {
        // Negative stem: replace with dictionary form
        if (line === 'カ行' && surface.endsWith('か')) return surface.slice(0, -1) + 'く';
        if (line === 'ガ行' && surface.endsWith('が')) return surface.slice(0, -1) + 'ぐ';
        if (line === 'サ行' && surface.endsWith('さ')) return surface.slice(0, -1) + 'す';
        if (line === 'タ行' && surface.endsWith('た')) return surface.slice(0, -1) + 'つ';
        if (line === 'ナ行' && surface.endsWith('な')) return surface.slice(0, -1) + 'ぬ';
        if (line === 'ハ行' && surface.endsWith('は')) return surface.slice(0, -1) + 'ふ';
        if (line === 'マ行' && surface.endsWith('ま')) return surface.slice(0, -1) + 'む';
        if (line === 'ヤ行' && surface.endsWith('や')) return surface.slice(0, -1) + 'う';
        if (line === 'ラ行' && surface.endsWith('ら')) return surface.slice(0, -1) + 'る';
        if (line === 'ワ行' && surface.endsWith('わ')) return surface.slice(0, -1) + 'う';
      }
    }
    // 下一段 (Ichidan) verbs - vowel stem (ア行)
    if (inflectionType === '下一段-ア行') {
      if (inflectionForm === '連用形-一般' && surface.endsWith('え')) {
        return surface.slice(0, -1) + 'える';
      }
      if (inflectionForm === '未然形-一般' && surface.endsWith('え')) {
        return surface.slice(0, -1) + 'える';
      }
    }
    // 上一段 (Ichidan) verbs - vowel stem (エ行)
    if (inflectionType === '上一段-エ行') {
      if ((inflectionForm === '連用形-一般' || inflectionForm === '未然形-一般') && surface.endsWith('い')) {
        return surface.slice(0, -1) + 'いる';
      }
    }
    // サ行変格 (Sa-gyou irregular)
    if (inflectionType === 'サ行変格') {
      if (inflectionForm === '連用形-一般' && surface.endsWith('し')) {
        return surface.slice(0, -1) + 'する';
      }
      if (inflectionForm === '未然形-一般' && surface.endsWith('せ')) {
        return surface.slice(0, -1) + 'する';
      }
    }
    // カ行変格 (Ka-gyou irregular) - くる
    if (inflectionType === 'カ行変格') {
      if (inflectionForm === '連用形-一般' && surface.endsWith('き')) {
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

  // If we can't determine, return surface as-is
  return surface;
}

const testWords = ['描きました', '考えました', '好きです', '買えません'];

console.log("Testing base form extraction:\n");
for (const word of testWords) {
  const morphemes = tokenizer.run(word, 'C');
  console.log(`\n${word}:`);
  const firstMorpheme = morphemes[0];
  if (firstMorpheme) {
    const baseForm = getMorphemeBaseForm(firstMorpheme.surface, firstMorpheme.part_of_speech);
    console.log(`  surface: "${firstMorpheme.surface}"`);
    console.log(`  baseForm: "${baseForm}"`);
    console.log(`  inflectionType: ${firstMorpheme.part_of_speech[4]}`);
    console.log(`  inflectionForm: ${firstMorpheme.part_of_speech[5]}`);
  }
}
