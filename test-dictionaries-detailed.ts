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

interface DetailedTestResult {
  word: string;
  jmdictAll: string[];
  jmdictFirst: string | null;
  jishoAll: string[];
  jishoFirst: string | null;
  correct: string; // What the word should mean
}

const expectedMeanings: Record<string, string> = {
  'はじめまして': 'first time / nice to meet you',
  'わたし': 'I / me',
  'なまえ': 'name',
  'たなか': 'Tanaka (name) / name',
  'です': 'to be / copula',
  'にほん': 'Japan',
  'じん': 'person / people',
  'とうきょう': 'Tokyo',
  'すん': 'sun (unit) / live / be located',
  'ます': 'increase / polite auxiliary',
  'がく': 'frame / study / learning',
  'せい': 'surname / voice / nature',
  'どうぞ': 'please / go ahead',
  'よろしく': 'well / sincerely / please',
  'ねがい': 'wish / request / desire'
};

async function runTest() {
  console.log('=== DETAILED Dictionary Accuracy Test ===\n');
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
  console.log('Testing each dictionary (showing all definitions)...\n');

  // Test each word
  const results: DetailedTestResult[] = [];
  for (const word of uniqueWords) {
    const jmdictResult = await jmdict.lookup(word);
    const jishoResult = await jisho.lookup(word);

    const jmdictAll = jmdictResult?.meanings ? jmdictResult.meanings : [];
    const jishoAll = jishoResult?.meanings ? jishoResult.meanings : [];

    results.push({
      word,
      jmdictAll: jmdictAll as string[],
      jmdictFirst: jmdictResult?.meaning || null,
      jishoAll: jishoAll as string[],
      jishoFirst: jishoResult?.meaning || null,
      correct: expectedMeanings[word] || '?'
    });
  }

  // Sort by word
  results.sort((a, b) => a.word.localeCompare(b.word));

  // Display results
  console.log('DETAILED DEFINITION COMPARISON');
  console.log('='.repeat(100));

  for (const result of results) {
    console.log(`\n📝 ${result.word} (should mean: ${result.correct})`);
    console.log('-'.repeat(100));

    // JMDict
    if (result.jmdictAll.length > 0) {
      console.log(`  JMDict (${result.jmdictAll.length} definitions):`);
      result.jmdictAll.slice(0, 3).forEach((def, i) => {
        const marker = i === 0 ? '→ FIRST:' : `  Alt ${i}:`;
        console.log(`    ${marker} ${def}`);
      });
      if (result.jmdictAll.length > 3) {
        console.log(`    ... and ${result.jmdictAll.length - 3} more`);
      }
    } else {
      console.log(`  JMDict: ❌ NOT FOUND`);
    }

    // Jisho API
    if (result.jishoAll.length > 0) {
      console.log(`  Jisho API (${result.jishoAll.length} definitions):`);
      result.jishoAll.slice(0, 3).forEach((def, i) => {
        const marker = i === 0 ? '→ FIRST:' : `  Alt ${i}:`;
        console.log(`    ${marker} ${def}`);
      });
      if (result.jishoAll.length > 3) {
        console.log(`    ... and ${result.jishoAll.length - 3} more`);
      }
    } else {
      console.log(`  Jisho API: ❌ NOT FOUND`);
    }

    // Accuracy assessment
    const jmdictAccurate = result.jmdictAll.some(d =>
      result.correct.toLowerCase().includes(d.toLowerCase().split('(')[0].trim()) ||
      d.toLowerCase().includes(result.correct.toLowerCase().split('/')[0].trim())
    );
    const jishoAccurate = result.jishoAll.some(d =>
      result.correct.toLowerCase().includes(d.toLowerCase().split('(')[0].trim()) ||
      d.toLowerCase().includes(result.correct.toLowerCase().split('/')[0].trim())
    );

    if (jmdictAccurate) console.log(`  ✅ JMDict has accurate definition`);
    else if (result.jmdictAll.length > 0) console.log(`  ⚠️  JMDict definition may be inaccurate`);

    if (jishoAccurate) console.log(`  ✅ Jisho has accurate definition`);
    else if (result.jishoAll.length > 0) console.log(`  ⚠️  Jisho definition may be inaccurate`);
  }

  // Summary
  console.log('\n' + '='.repeat(100));
  console.log('\n📊 SUMMARY');

  const jmdictComplete = results.filter(r => r.jmdictAll.length > 0).length;
  const jishoComplete = results.filter(r => r.jishoAll.length > 0).length;

  const jmdictAccurate = results.filter(r =>
    r.jmdictAll.some(d =>
      r.correct.toLowerCase().includes(d.toLowerCase().split('(')[0].trim()) ||
      d.toLowerCase().includes(r.correct.toLowerCase().split('/')[0].trim())
    )
  ).length;

  const jishoAccurate = results.filter(r =>
    r.jishoAll.some(d =>
      r.correct.toLowerCase().includes(d.toLowerCase().split('(')[0].trim()) ||
      d.toLowerCase().includes(r.correct.toLowerCase().split('/')[0].trim())
    )
  ).length;

  console.log(`\nCoverage (finds the word):`);
  console.log(`  JMDict: ${jmdictComplete}/${results.length} (${Math.round(jmdictComplete / results.length * 100)}%)`);
  console.log(`  Jisho:  ${jishoComplete}/${results.length} (${Math.round(jishoComplete / results.length * 100)}%)`);

  console.log(`\nAccuracy (has a correct definition in list):`);
  console.log(`  JMDict: ${jmdictAccurate}/${results.length} (${Math.round(jmdictAccurate / results.length * 100)}%)`);
  console.log(`  Jisho:  ${jishoAccurate}/${results.length} (${Math.round(jishoAccurate / results.length * 100)}%)`);

  process.exit(0);
}

runTest().catch(e => {
  console.error('Test failed:', e);
  process.exit(1);
});
