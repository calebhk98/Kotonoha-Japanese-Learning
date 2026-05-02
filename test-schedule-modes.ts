import { createRequire } from 'module';
const path = await import('path');
const fs = await import('fs');

const wasmPath = (path.default || path).join(process.cwd(), 'sudachi-wasm-built', 'index_bg.wasm');
const wasmModule = await import('./sudachi-wasm-built/index.js');
const { initSync, Tokenizer } = wasmModule;

const wasmBuffer = fs.readFileSync(wasmPath);
initSync(wasmBuffer);

const tokenizer = Tokenizer.create();

const testText = "まいあさ、ろくじにおきます。";

console.log("Mode A (short):");
const morphemesA = tokenizer.run(testText, 'A');
morphemesA.forEach((m, i) => {
  console.log(`  [${i}] "${m.surface}" (${m.part_of_speech[0]})`);
});

console.log("\nMode B (basic):");
const morphemesB = tokenizer.run(testText, 'B');
morphemesB.forEach((m, i) => {
  console.log(`  [${i}] "${m.surface}" (${m.part_of_speech[0]})`);
});

console.log("\nMode C (comprehensive):");
const morphemesC = tokenizer.run(testText, 'C');
morphemesC.forEach((m, i) => {
  console.log(`  [${i}] "${m.surface}" (${m.part_of_speech[0]})`);
});
