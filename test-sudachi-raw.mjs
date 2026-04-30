import { initSync, Tokenizer } from './sudachi-wasm-built/index.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const wasmPath = path.join(__dirname, 'sudachi-wasm-built', 'index_bg.wasm');

const testText = 'どうぞよろしくおねがいします。';

const wasmBuffer = fs.readFileSync(wasmPath);
initSync(wasmBuffer);

const tokenizer = Tokenizer.create();
const morphemes = tokenizer.run(testText, 'C');

console.log('Raw morphemes for: ' + testText);
console.log('');
morphemes.forEach((m, i) => {
  console.log(`${i}: surface="${m.surface}" pos=[${m.part_of_speech.join(',')}]`);
});
