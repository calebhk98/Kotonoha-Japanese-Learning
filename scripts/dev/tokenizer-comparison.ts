import TinySegmenter from 'tiny-segmenter';
import { loadDefaultJapaneseParser } from 'budoux';
import kuromoji from 'kuromoji';

const testText = `はじめまして。

わたしのなまえはたなかです。

にほんじんです。

とうきょうにすんでいます。

がくせいです。

どうぞよろしくおねがいします。`;

// Test 0: Kuromoji (current implementation)
console.log("=== Kuromoji (CURRENT) ===");
kuromoji.builder({ dicPath: 'node_modules/kuromoji/dict' }).build((err, tokenizer) => {
  if (err) {
    console.log("Error loading Kuromoji:", err.message);
  } else {
    const tokens = tokenizer.tokenize(testText);
    const kuromojiWords = filterWords(tokens.map((t: any) => t.surface_form));
    console.log("Filtered words:", kuromojiWords);
    checkWords(kuromojiWords, "Kuromoji");
    runOtherTests();
  }
});

function runOtherTests() {
  // Test 1: TinySegmenter
  console.log("\n=== TinySegmenter ===");
  const tinySegmenter = new TinySegmenter();
  const tinyTokens = tinySegmenter.segment(testText);
  const tinyFiltered = filterWords(tinyTokens);
  console.log("Filtered words:", tinyFiltered);
  checkWords(tinyFiltered, "TinySegmenter");

  // Test 2: BudouX (Google's ML model)
  console.log("\n=== BudouX ===");
  try {
    const parser = loadDefaultJapaneseParser();
    const chunks = parser.parse(testText);

    const words = Array.isArray(chunks)
      ? chunks
      : String(chunks)
          .split(/[​\n\s]+/)  // Split on zero-width space (boundary marker) and whitespace
          .filter(s => s.trim() !== '' && !/^[、。！？・「」『』（）()[\]a-zA-Z0-9\s]+$/.test(s));

    console.log("Filtered words:", Array.from(new Set(words)));
    checkWords(Array.from(new Set(words)), "BudouX");
  } catch (e) {
    console.log("Error with BudouX:", (e as any).message);
  }
}

// Helper function to filter tokens like the server does
function filterWords(tokens: string[]) {
  const particles = new Set(["は", "が", "を", "に", "へ", "と", "で", "も", "か", "の", "て", "な", "だ"]);
  const isPunctuation = (s: string) => /[、。！？・「」『』（）()[\]a-zA-Z0-9\s]/.test(s);
  const isSingleKana = (s: string) => s.length === 1 && (particles.has(s) || /[ぁ-ん]/.test(s));

  const validWords = new Set<string>();
  for (const token of tokens) {
    if (token.trim() === '' || isPunctuation(token) || isSingleKana(token)) continue;
    validWords.add(token);
  }
  return Array.from(validWords);
}

function checkWords(words: string[], libraryName: string) {
  const critical = [
    { word: "たなか", description: "Tanaka (issue #1)" },
    { word: "とうきょう", description: "Tokyo (issue #3)" },
    { word: "なまえ", description: "Name (should be together)" },
    { word: "おねがい", description: "Please/request (currently broken as おね + がいし)" },
  ];

  console.log(`\n${libraryName} Critical Word Check:`);
  for (const { word, description } of critical) {
    const found = words.includes(word);
    const status = found ? "✓" : "✗";
    console.log(`  ${status} ${word} (${description})`);
  }
}

console.log("\n\n=== EXPECTED KEY WORDS ===");
console.log("  - なまえ (name)");
console.log("  - たなか (Tanaka - in all hiragana) ← CRITICAL: breaks as た+なか");
console.log("  - にほん (Japan)");
console.log("  - とうきょう (Tokyo) ← CRITICAL: breaks as とう+きょう");
console.log("  - がくせい (student)");
console.log("  - おねがい (request/please) ← CRITICAL: breaks as おね+がいし");
console.log("  - よろしく (nice to meet you)");
