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

function filterWords(tokens) {
  const particles = new Set(['は', 'が', 'を', 'に', 'へ', 'と', 'で', 'も', 'か', 'の', 'て', 'な', 'だ']);
  const isPunctuation = (s) => /[、。！？・「」『』（）()[\]a-zA-Z0-9\s]/.test(s);
  const isSingleKana = (s) => s.length === 1 && (particles.has(s) || /[ぁ-ん]/.test(s));

  const validWords = new Set();
  for (const token of tokens) {
    if (token.trim() === '' || isPunctuation(token) || isSingleKana(token)) continue;
    validWords.add(token);
  }
  return validWords;
}

async function testMode(mode) {
  console.log(`\n${'='.repeat(50)}`);
  console.log(`Mode: ${mode} (${mode === 'A' ? 'Shortest path' : mode === 'B' ? 'Moderate' : 'Compound'})`);
  console.log('='.repeat(50));

  const tokenizer = Tokenizer.create();
  const morphemes = tokenizer.run(testText, mode);
  const tokens = morphemes.map((m) => m.surface);
  const filteredWords = filterWords(tokens);

  console.log(`Total morphemes: ${tokens.length}`);
  console.log(`Unique words: ${filteredWords.size}`);
  console.log(`\nAll words: ${Array.from(filteredWords).join(', ')}\n`);

  let score = 0;
  for (const { word, description } of criticalWords) {
    const found = filteredWords.has(word);
    const status = found ? '✓' : '✗';
    console.log(`  ${status} ${word.padEnd(10)} - ${description}`);
    if (found) score++;
  }

  const accuracy = Math.round((score / criticalWords.length) * 100);
  console.log(`\nAccuracy: ${score}/${criticalWords.length} (${accuracy}%)`);
}

async function main() {
  console.log('Testing Sudachi WASM with different tokenization modes\n');
  const wasmBuffer = fs.readFileSync(wasmPath);
  initSync(wasmBuffer);

  for (const mode of ['A', 'B', 'C']) {
    await testMode(mode);
  }
}

main().catch(console.error);
