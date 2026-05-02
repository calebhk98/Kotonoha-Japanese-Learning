import { createRequire } from 'module';
const path = await import('path');
const fs = await import('fs');

const wasmPath = (path.default || path).join(process.cwd(), 'sudachi-wasm-built', 'index_bg.wasm');
const wasmModule = await import('./sudachi-wasm-built/index.js');
const { initSync, Tokenizer } = wasmModule;

const wasmBuffer = fs.readFileSync(wasmPath);
initSync(wasmBuffer);

const tokenizer = Tokenizer.create();

const testText = `むかしむかし、あるところに、おじいさんとおばあさんがいました。`;

const morphemes = tokenizer.run(testText, 'C');

console.log("Raw morphemes:");
morphemes.forEach((m, i) => {
  if (m.part_of_speech[0] !== '補助記号' && !/^\s+$/.test(m.surface)) {
    console.log(`[${i}] surface="${m.surface}" pos=${JSON.stringify(m.part_of_speech)}`);
  }
});
