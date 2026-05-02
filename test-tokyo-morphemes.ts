import { createRequire } from 'module';
const path = await import('path');
const fs = await import('fs');

const wasmPath = (path.default || path).join(process.cwd(), 'sudachi-wasm-built', 'index_bg.wasm');
const wasmModule = await import('./sudachi-wasm-built/index.js');
const { initSync, Tokenizer } = wasmModule;

const wasmBuffer = fs.readFileSync(wasmPath);
initSync(wasmBuffer);

const tokenizer = Tokenizer.create();

const testText = `昨日、新幹線で東京に行きました。東京はとても人が多くて賑やかでした。`;

const morphemes = tokenizer.run(testText, 'C');

console.log("Raw morphemes:");
morphemes.forEach((m, i) => {
  console.log(`[${i}] surface="${m.surface}" pos=${JSON.stringify(m.part_of_speech)}`);
});
