import {
  TinySegmenterImpl,
  SudachiTSImpl,
  LinderaImpl,
  SudachiWasmImpl,
  KuromojiImpl,
  Tokenizer,
} from './src/lib/tokenizers.js';

const testText = `はじめまして。
わたしのなまえはたなかです。
にほんじんです。
とうきょうにすんでいます。
がくせいです。
どうぞよろしくおねがいします。`;

// Critical words we need to get right (from issue #23)
const criticalWords = [
  { word: 'たなか', description: 'Tanaka (pure hiragana name)' },
  { word: 'とうきょう', description: 'Tokyo' },
  { word: 'なまえ', description: 'Name' },
  { word: 'にほん', description: 'Japan' },
  { word: 'おねがい', description: 'Please/request' },
  { word: 'がくせい', description: 'Student' },
];

// Additional words for overall evaluation
const additionalWords = [
  'はじめ',
  'まして',
  'わたし',
  'です',
  'ん',
  'じん',
  'すむ',
  'います',
  'よろしく',
];

function filterWords(tokens: string[]): Set<string> {
  const particles = new Set(['は', 'が', 'を', 'に', 'へ', 'と', 'で', 'も', 'か', 'の', 'て', 'な', 'だ']);
  const isPunctuation = (s: string) => /[、。！？・「」『』（）()[\]a-zA-Z0-9\s]/.test(s);
  const isSingleKana = (s: string) => s.length === 1 && (particles.has(s) || /[ぁ-ん]/.test(s));

  const validWords = new Set<string>();
  for (const token of tokens) {
    if (token.trim() === '' || isPunctuation(token) || isSingleKana(token)) continue;
    validWords.add(token);
  }
  return validWords;
}

async function testTokenizer(tokenizer: Tokenizer): Promise<void> {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Testing ${tokenizer.name}`);
  console.log('='.repeat(60));

  try {
    const start = Date.now();
    const tokens = await tokenizer.segment(testText);
    const elapsed = Date.now() - start;

    const filteredWords = filterWords(tokens);

    console.log(`\nSegmentation time: ${elapsed}ms`);
    console.log(`Total tokens: ${tokens.length}`);
    console.log(`Filtered unique words: ${filteredWords.size}`);
    console.log(`\nAll filtered words: ${Array.from(filteredWords).join(', ')}`);

    // Check critical words
    let criticalScore = 0;
    console.log(`\n📋 Critical Words (Issue #23):`);
    for (const { word, description } of criticalWords) {
      const found = filteredWords.has(word);
      const status = found ? '✓' : '✗';
      console.log(`  ${status} ${word.padEnd(10)} - ${description}`);
      if (found) criticalScore++;
    }
    const criticalAccuracy = Math.round((criticalScore / criticalWords.length) * 100);
    console.log(`\n  Critical word accuracy: ${criticalScore}/${criticalWords.length} (${criticalAccuracy}%)`);

    // Check additional words
    let additionalScore = 0;
    console.log(`\n📊 Additional Words:`);
    for (const word of additionalWords) {
      const found = filteredWords.has(word);
      const status = found ? '✓' : '✗';
      console.log(`  ${status} ${word}`);
      if (found) additionalScore++;
    }
    const additionalAccuracy = Math.round((additionalScore / additionalWords.length) * 100);
    console.log(`\n  Additional word accuracy: ${additionalScore}/${additionalWords.length} (${additionalAccuracy}%)`);

    // Overall score
    const totalScore = criticalScore + additionalScore;
    const totalPossible = criticalWords.length + additionalWords.length;
    const overallAccuracy = Math.round((totalScore / totalPossible) * 100);
    console.log(`\n🎯 Overall Accuracy: ${totalScore}/${totalPossible} (${overallAccuracy}%)`);
  } catch (e: any) {
    console.error(`❌ Error testing ${tokenizer.name}: ${e.message}`);
  }
}

async function main() {
  console.log('🔍 Japanese Tokenizer Comparison Test');
  console.log(`Test text length: ${testText.length} characters\n`);

  const tokenizersToTest: [Tokenizer, string][] = [];

  // Add tokenizers to test (in order of preference)
  console.log('🚀 Initializing tokenizers...\n');

  // TinySegmenter (baseline, should always work)
  try {
    const tiny = new TinySegmenterImpl();
    await tiny.ready();
    tokenizersToTest.push([tiny, 'tinysegmenter']);
  } catch (e) {
    console.warn('⚠️ TinySegmenter failed:', (e as any).message);
  }

  // Lindera (high accuracy, already installed)
  try {
    const lindera = new LinderaImpl();
    await lindera.ready();
    tokenizersToTest.push([lindera, 'lindera']);
  } catch (e) {
    console.warn('⚠️ Lindera failed:', (e as any).message);
  }

  // Sudachi-TS (expected high accuracy if config works)
  try {
    const sudachiTS = new SudachiTSImpl();
    await sudachiTS.ready();
    tokenizersToTest.push([sudachiTS, 'sudachi-ts']);
  } catch (e) {
    console.warn('⚠️ Sudachi-TS failed:', (e as any).message);
  }

  // Sudachi WASM (alternative to sudachi-ts)
  try {
    const sudachiWasm = new SudachiWasmImpl();
    await sudachiWasm.ready();
    tokenizersToTest.push([sudachiWasm, 'sudachi-wasm']);
  } catch (e) {
    console.warn('⚠️ Sudachi WASM failed:', (e as any).message);
  }

  // Kuromoji (reference - current, should be lowest accuracy)
  try {
    const kuromoji = new KuromojiImpl();
    await kuromoji.ready();
    tokenizersToTest.push([kuromoji, 'kuromoji']);
  } catch (e) {
    console.warn('⚠️ Kuromoji failed:', (e as any).message);
  }

  if (tokenizersToTest.length === 0) {
    console.error('❌ No tokenizers could be initialized');
    process.exit(1);
  }

  console.log(`✅ Successfully initialized ${tokenizersToTest.length} tokenizer(s)\n`);

  // Test all tokenizers
  for (const [tokenizer] of tokenizersToTest) {
    await testTokenizer(tokenizer);
  }

  // Summary
  console.log(`\n${'='.repeat(60)}`);
  console.log('📈 Test Complete');
  console.log('='.repeat(60));
  console.log('\nTo use a specific tokenizer in the server, set the TOKENIZER environment variable:');
  console.log('  TOKENIZER=lindera npm run dev');
  console.log('  TOKENIZER=sudachi-ts npm run dev');
}

main().catch(console.error);
