import { initSync, Tokenizer } from './sudachi-wasm-built/index.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const wasmPath = path.join(__dirname, 'sudachi-wasm-built', 'index_bg.wasm');

const testText = `はじめまして。
わたしのなまえはたなかです。
にほんじんです。
とうきょうにすんでいます。
がくせいです。
どうぞよろしくおねがいします。`;

const criticalWords = [
  { word: 'たなか', description: 'Tanaka' },
  { word: 'とうきょう', description: 'Tokyo' },
  { word: 'なまえ', description: 'Name' },
  { word: 'にほん', description: 'Japan' },
  { word: 'おねがい', description: 'Please/request' },
  { word: 'がくせい', description: 'Student' },
];

// Better filtering: combine prefixes/suffixes with adjacent words
function filterWordsV2(morphemes) {
  const particles = new Set(['は', 'が', 'を', 'に', 'へ', 'と', 'で', 'も', 'か', 'の', 'て', 'な', 'だ']);
  const isPunctuation = (s) => /[、。！？・「」『』（）()[\]a-zA-Z0-9\s]/.test(s);

  const validWords = [];
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
      validWords.push(word);
    }
  }

  return new Set(validWords);
}

const wasmBuffer = fs.readFileSync(wasmPath);
initSync(wasmBuffer);

const tokenizer = Tokenizer.create();
const morphemes = tokenizer.run(testText, 'C');

console.log('🔍 Sudachi WASM with Improved Filtering\n');

const filteredWords = filterWordsV2(morphemes);

console.log(`Total morphemes: ${morphemes.length}`);
console.log(`Unique words: ${filteredWords.size}`);
console.log(`\nAll words: ${Array.from(filteredWords).join(', ')}\n`);

console.log('📋 Critical Words Check:');
let score = 0;
for (const { word, description } of criticalWords) {
  const found = filteredWords.has(word);
  const status = found ? '✓' : '✗';
  console.log(`  ${status} ${word.padEnd(10)} - ${description}`);
  if (found) score++;
}

const accuracy = Math.round((score / criticalWords.length) * 100);
console.log(`\n✅ Critical word accuracy: ${score}/${criticalWords.length} (${accuracy}%)`);
