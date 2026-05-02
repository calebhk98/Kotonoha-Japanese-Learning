import { createRequire } from 'module';
import { createTokenizer } from './src/lib/tokenizers.js';
import { JmdictDictionary, JishoApiDictionary } from './src/lib/dictionary.js';

const require = createRequire(import.meta.url);
const kanjiData = require('kanji-data');

const testText = `はじめまして。

わたしのなまえはたなかです。

にほんじんです。

とうきょうにすんでいます。

がくせいです。

どうぞよろしくおねがいします。`;

interface TestResult {
  word: string;
  jmdict: string | null;
  jisho: string | null;
  found: number;
}

async function runTest() {
  console.log('=== Dictionary Accuracy Test ===\n');
  console.log('Test text (pure hiragana):\n', testText, '\n');

  // Initialize tokenizer
  const tokenizer = await createTokenizer();
  console.log('✓ Tokenizer ready\n');

  // Initialize JMDict
  const jmdict = new JmdictDictionary();
  await jmdict.initialize('jmdict-db', 'jmdict-all-3.6.2.json');
  console.log(`✓ JMDict initialized: ${jmdict.isInitialized() ? 'ready' : 'failed'}\n`);

  // Initialize Jisho API
  const jisho = new JishoApiDictionary();
  await jisho.initialize();
  console.log(`✓ Jisho API initialized: ${jisho.isInitialized() ? 'ready' : 'failed'}\n`);

  // Tokenize text
  const tokens = await tokenizer.segment(testText);

  // Extract hiragana-only words
  const particles = new Set(['は', 'が', 'を', 'に', 'へ', 'と', 'で', 'も', 'か', 'の', 'て', 'な', 'だ']);
  const isPunctuation = (s: string) => /[、。！？・「」『』（）()[\]a-zA-Z0-9\s]/.test(s);
  const isSingleKana = (s: string) => s.length === 1 && (particles.has(s) || /[ぁ-ん]/.test(s));

  const uniqueWords = new Set<string>();
  for (const token of tokens) {
    const surface = token.surface;
    if (surface.trim() === '' || isPunctuation(surface) || isSingleKana(surface)) continue;

    const isPureHiragana = /^[ぁ-ん]+$/.test(surface);
    if (isPureHiragana) {
      uniqueWords.add(surface);
    }
  }

  console.log(`Found ${uniqueWords.size} unique hiragana words\n`);
  console.log('Testing each dictionary...\n');

  // Test each word
  const results: TestResult[] = [];
  for (const word of uniqueWords) {
    const jmdictResult = await jmdict.lookup(word);
    const jishoResult = await jisho.lookup(word);

    const found = (jmdictResult ? 1 : 0) + (jishoResult ? 1 : 0);
    results.push({
      word,
      jmdict: jmdictResult?.meaning || null,
      jisho: jishoResult?.meaning || null,
      found
    });
  }

  // Sort by found count
  results.sort((a, b) => b.found - a.found);

  // Display results
  console.log('Word | JMDict | Jisho API | Found');
  console.log('-'.repeat(80));

  for (const result of results) {
    const jmdictMeaning = result.jmdict || '❌';
    const jishoMeaning = result.jisho || '❌';
    const found = result.found === 2 ? '✅ Both' : result.found === 1 ? '⚠️  One' : '❌ None';

    console.log(`${result.word.padEnd(12)} | ${jmdictMeaning.padEnd(20)} | ${jishoMeaning.padEnd(20)} | ${found}`);
  }

  // Statistics
  console.log('\n' + '='.repeat(80));
  const jmdictFound = results.filter(r => r.jmdict).length;
  const jishoFound = results.filter(r => r.jisho).length;
  const bothFound = results.filter(r => r.found === 2).length;
  const noneFound = results.filter(r => r.found === 0).length;

  console.log('\nAccuracy Statistics:');
  console.log(`JMDict:     ${jmdictFound}/${results.length} (${Math.round(jmdictFound / results.length * 100)}%)`);
  console.log(`Jisho API:  ${jishoFound}/${results.length} (${Math.round(jishoFound / results.length * 100)}%)`);
  console.log(`Both found: ${bothFound}/${results.length} (${Math.round(bothFound / results.length * 100)}%)`);
  console.log(`None found: ${noneFound}/${results.length} (${Math.round(noneFound / results.length * 100)}%)`);

  if (noneFound > 0) {
    console.log(`\nWords not found in either dictionary:`);
    results.filter(r => r.found === 0).forEach(r => {
      console.log(`  - ${r.word}`);
    });
  }

  process.exit(0);
}

runTest().catch(e => {
  console.error('Test failed:', e);
  process.exit(1);
});
