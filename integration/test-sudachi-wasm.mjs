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
  { word: 'たなか', description: 'Tanaka (pure hiragana name)' },
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

console.log('🔍 Testing Sudachi WASM (Built with Embedded Dictionary)\n');
console.log('Test text:', testText.substring(0, 50) + '...\n');

try {
  console.log('Initializing Sudachi WASM...');
  const wasmBuffer = fs.readFileSync(wasmPath);
  initSync(wasmBuffer);
  const tokenizer = Tokenizer.create();
  console.log('✅ Sudachi WASM initialized\n');

  const start = Date.now();
  const morphemes = tokenizer.run(testText, 'C');
  const elapsed = Date.now() - start;

  const tokens = morphemes.map((m) => m.surface);
  const filteredWords = filterWords(tokens);

  console.log(`Tokenization time: ${elapsed}ms`);
  console.log(`Total morphemes: ${tokens.length}`);
  console.log(`Filtered unique words: ${filteredWords.size}`);
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
} catch (e) {
  console.error('❌ Error:', e.message);
  console.error('Stack:', e.stack);
}
