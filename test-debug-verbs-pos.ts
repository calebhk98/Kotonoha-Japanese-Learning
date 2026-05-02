const path = await import('path');
const fs = await import('fs');

const wasmPath = (path.default || path).join(process.cwd(), 'sudachi-wasm-built', 'index_bg.wasm');
const wasmModule = await import('./sudachi-wasm-built/index.js');
const { initSync, Tokenizer } = wasmModule;

const wasmBuffer = fs.readFileSync(wasmPath);
initSync(wasmBuffer);

const tokenizer = Tokenizer.create();

const testWords = ['食べました', '会いました', '着いて'];

for (const word of testWords) {
  const morphemes = tokenizer.run(word, 'C');
  console.log(`\n${word}:`);
  morphemes.forEach((m, i) => {
    console.log(`  [${i}] surface: "${m.surface}", pos: ${JSON.stringify(m.part_of_speech)}`);
  });
}
