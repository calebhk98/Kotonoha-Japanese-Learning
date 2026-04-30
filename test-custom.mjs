import TinySegmenter from 'tiny-segmenter';

const testText = `はじめまして。

わたしのなまえはたなかです。

にほんじんです。

とうきょうにすんでいます。

がくせいです。

どうぞよろしくおねがいします。`;

const expectedWords = [
  "はじめまして",
  "わたし",
  "なまえ",
  "たなか",
  "です",
  "にほんじん",
  "とうきょう",
  "すんでいます",
  "がくせい",
  "どうぞ",
  "よろしく",
  "おねがい",
  "します"
];

const criticalWords = [
  { word: "たなか", importance: "critical" },
  { word: "とうきょう", importance: "critical" },
  { word: "なまえ", importance: "high" },
  { word: "にほんじん", importance: "high" },
  { word: "おねがい", importance: "high" }
];

function filterWords(tokens) {
  const particles = new Set(['は', 'が', 'を', 'に', 'へ', 'と', 'で', 'も', 'か', 'の', 'て', 'な', 'だ']);
  const isPunctuation = (s) => /[、。！？・「」『』（）()[\]a-zA-Z0-9\s]/.test(s);
  const isSingleKana = (s) => s.length === 1 && (particles.has(s) || /[ぁ-ん]/.test(s));

  const validWords = new Set();
  for (const token of tokens) {
    const clean = token.trim();
    if (clean === '' || isPunctuation(clean) || isSingleKana(clean)) continue;
    validWords.add(clean);
  }
  return Array.from(validWords);
}

console.log('╔════════════════════════════════════════════════════════╗');
console.log('║       JAPANESE TOKENIZER TEST - YOUR TEXT             ║');
console.log('╚════════════════════════════════════════════════════════╝\n');

console.log('📝 Input Text:');
console.log(testText);
console.log('\n' + '═'.repeat(58) + '\n');

// Test TinySegmenter
console.log('🔍 TINYSEGMENTER Results\n');
const segmenter = new TinySegmenter();
const tinyTokens = segmenter.segment(testText);
const tinyWords = filterWords(tinyTokens);

console.log(`Raw tokens: ${tinyTokens.length}`);
console.log(`Unique words after filtering: ${tinyWords.length}`);
console.log(`\nWords: ${tinyWords.join(', ')}\n`);

console.log('Critical Words Match:');
let score = 0;
for (const { word, importance } of criticalWords) {
  const found = tinyWords.includes(word);
  const status = found ? '✓' : '✗';
  const icon = importance === 'critical' ? '🔴' : '🟡';
  console.log(`  ${status} ${icon} ${word}`);
  if (found) score++;
}
const accuracy = Math.round((score / criticalWords.length) * 100);
console.log(`\n✅ Accuracy: ${score}/${criticalWords.length} critical words (${accuracy}%)\n`);

console.log('═'.repeat(58));
console.log('\n📊 Summary:');
console.log(`  Tokenizer: TinySegmenter`);
console.log(`  Total words extracted: ${tinyWords.length}`);
console.log(`  Critical word accuracy: ${accuracy}%`);
console.log(`  Status: ${accuracy >= 80 ? '✅ Excellent' : accuracy >= 60 ? '⚠️  Good' : '❌ Needs improvement'}`);
console.log('\n' + '═'.repeat(58) + '\n');

console.log('📚 Expected Words in Text:');
console.log(expectedWords.join(', '));
console.log();
