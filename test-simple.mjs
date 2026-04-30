import TinySegmenter from 'tiny-segmenter';

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

console.log('🔍 Quick Tokenizer Test - TinySegmenter\n');
console.log('Test text:', testText.substring(0, 50) + '...\n');

const segmenter = new TinySegmenter();
const tokens = segmenter.segment(testText);
const filteredWords = filterWords(tokens);

console.log(`Total tokens: ${tokens.length}`);
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
