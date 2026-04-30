import fs from 'fs';
import TinySegmenter from 'tiny-segmenter';
import { loadDefaultJapaneseParser } from 'budoux';
import kuromoji from 'kuromoji';
import { DictionaryFactory } from 'sudachi-ts';
import init, { tokenize as sudachiTokenize, TokenizeMode } from 'sudachi';

// Load test data
const testData = JSON.parse(fs.readFileSync('./test-story.json', 'utf-8'));
const { text, expectedWords, criticalWords } = testData;

interface TokenizerResult {
  name: string;
  words: string[];
  critical: { word: string; found: boolean; importance: string }[];
  score: { correct: number; total: number; percentage: number };
}

const results: TokenizerResult[] = [];

// Helper to filter and clean tokens
function filterWords(tokens: string[]): string[] {
  const particles = new Set(["は", "が", "を", "に", "へ", "と", "で", "も", "か", "の", "て", "な", "だ"]);
  const isPunctuation = (s: string) => /[、。！？・「」『』（）()[\]a-zA-Z0-9\s\n]/.test(s);
  const isSingleKana = (s: string) => s.length === 1 && (particles.has(s) || /[ぁ-ん]/.test(s));

  const validWords = new Set<string>();
  for (const token of tokens) {
    const clean = token.trim();
    if (clean === '' || isPunctuation(clean) || isSingleKana(clean)) continue;
    validWords.add(clean);
  }
  return Array.from(validWords);
}

// Helper to score results
function scoreTokens(words: string[], testCritical: typeof criticalWords): TokenizerResult['critical'] {
  return testCritical.map(({ word, importance }) => ({
    word,
    found: words.includes(word),
    importance,
  }));
}

// Test 1: Kuromoji
console.log('🧪 Testing Kuromoji...');
kuromoji.builder({ dicPath: 'node_modules/kuromoji/dict' }).build((err, tokenizer) => {
  if (err) {
    console.error('Kuromoji error:', err.message);
  } else {
    const tokens = tokenizer.tokenize(text);
    const words = filterWords(tokens.map((t: any) => t.surface_form));
    const critical = scoreTokens(words, criticalWords);
    const correct = critical.filter(c => c.found).length;
    results.push({
      name: 'Kuromoji',
      words,
      critical,
      score: { correct, total: critical.length, percentage: Math.round((correct / critical.length) * 100) },
    });
    runNextTest();
  }
});

function runNextTest() {
  // Test 2: TinySegmenter
  console.log('🧪 Testing TinySegmenter...');
  const tinySegmenter = new TinySegmenter();
  const tinyTokens = tinySegmenter.segment(text);
  const tinyWords = filterWords(tinyTokens);
  const tinyCritical = scoreTokens(tinyWords, criticalWords);
  const tinyCorrect = tinyCritical.filter(c => c.found).length;
  results.push({
    name: 'TinySegmenter',
    words: tinyWords,
    critical: tinyCritical,
    score: { correct: tinyCorrect, total: tinyCritical.length, percentage: Math.round((tinyCorrect / tinyCritical.length) * 100) },
  });

  // Test 3: BudouX
  console.log('🧪 Testing BudouX...');
  try {
    const parser = loadDefaultJapaneseParser();
    const chunks = parser.parse(text);
    // BudouX returns chunks, not individual words - not ideal for this use case
    const budouxWords = Array.isArray(chunks) ? chunks : [chunks];
    const budouxCritical = scoreTokens(budouxWords, criticalWords);
    const budouxCorrect = budouxCritical.filter(c => c.found).length;
    results.push({
      name: 'BudouX',
      words: budouxWords,
      critical: budouxCritical,
      score: { correct: budouxCorrect, total: budouxCritical.length, percentage: Math.round((budouxCorrect / budouxCritical.length) * 100) },
    });
  } catch (e) {
    console.error('BudouX error:', (e as any).message);
  }

  // Test 4: Sudachi-TS (requires DictionaryFactory)
  console.log('🧪 Testing Sudachi-TS...');
  (async () => {
    try {
      const factory = new DictionaryFactory();
      const dict = await factory.create();
      const sudachiTokenizer = dict.create();
      const sudachiTokens = sudachiTokenizer.tokenize(text);
      const sudachiWords = filterWords(
        sudachiTokens.map((t: any) => (typeof t.surface === 'function' ? t.surface() : t.surface_form))
      );
      const sudachiCritical = scoreTokens(sudachiWords, criticalWords);
      const sudachiCorrect = sudachiCritical.filter(c => c.found).length;
      results.push({
        name: 'Sudachi-TS',
        words: sudachiWords,
        critical: sudachiCritical,
        score: { correct: sudachiCorrect, total: sudachiCritical.length, percentage: Math.round((sudachiCorrect / sudachiCritical.length) * 100) },
      });

      // Also test @didmar/sudachi-wasm
      testDidmarSudachi();
    } catch (e) {
      console.error('Sudachi-TS error:', (e as any).message);
      testDidmarSudachi();
    }
  })();
}

async function testDidmarSudachi() {
  console.log('🧪 Testing Sudachi WASM...');
  try {
    await init();
    // Test Mode C (longest units - best for hiragana)
    const sudachiResult = sudachiTokenize(text, TokenizeMode.C);
    const sudachiWords = filterWords(sudachiResult.split('\t'));
    const sudachiCritical = scoreTokens(sudachiWords, criticalWords);
    const sudachiCorrect = sudachiCritical.filter(c => c.found).length;
    results.push({
      name: 'Sudachi WASM (Mode C)',
      words: sudachiWords,
      critical: sudachiCritical,
      score: { correct: sudachiCorrect, total: sudachiCritical.length, percentage: Math.round((sudachiCorrect / sudachiCritical.length) * 100) },
    });
    printResults();
  } catch (e) {
    console.error('Sudachi WASM error:', (e as any).message);
    printResults();
  }
}

function printResults() {
  console.log('\n╔════════════════════════════════════════════════════════╗');
  console.log('║          TOKENIZER COMPARISON RESULTS                  ║');
  console.log('╚════════════════════════════════════════════════════════╝\n');

  // Sort by score
  results.sort((a, b) => b.score.percentage - a.score.percentage);

  for (const result of results) {
    const stars = '★'.repeat(Math.round(result.score.percentage / 20)) + '☆'.repeat(5 - Math.round(result.score.percentage / 20));
    console.log(`\n📊 ${result.name.padEnd(20)} ${result.score.percentage.toString().padStart(3)}% ${stars}`);
    console.log(`   Score: ${result.score.correct}/${result.score.total} critical words found`);

    // Show critical word details
    for (const crit of result.critical) {
      const status = crit.found ? '✓' : '✗';
      const icon = crit.importance === 'critical' ? '🔴' : '🟡';
      console.log(`   ${status} ${icon} ${crit.word}`);
    }
  }

  console.log('\n' + '═'.repeat(58));
  console.log('\n📋 Detailed Word Lists:\n');

  for (const result of results) {
    console.log(`\n${result.name}:`);
    console.log(`  ${result.words.join(', ')}`);
  }

  // Summary
  console.log('\n' + '═'.repeat(58));
  console.log('\n🏆 WINNER: ' + results[0].name);
  console.log(`   ${results[0].score.percentage}% accuracy on critical words\n`);
}
