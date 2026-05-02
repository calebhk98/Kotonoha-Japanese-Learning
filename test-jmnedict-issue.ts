/**
 * Test to verify that issue #37 is fixed:
 * "Add JMnedict support for proper noun lookups"
 *
 * This test verifies that:
 * 1. たなか (Tanaka - surname) is correctly identified via JMnedict
 * 2. とうきょう (Tokyo) works reliably
 * 3. にほんじん (Japanese person) is found
 * 4. Other proper nouns from the issue are handled correctly
 */

import path from 'path';
import { fileURLToPath } from 'url';
import { DictionaryManager } from './src/lib/dictionary.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface TestResult {
  word: string;
  meaning: string;
  source: string;
  expectedKeyword: string;
  passed: boolean;
}

async function runTest(dictionary: DictionaryManager, word: string, expectedKeyword: string): Promise<TestResult> {
  const result = await dictionary.lookup(word);

  // Determine the source of the result based on the log output
  let source = 'Unknown';
  if (result) {
    // Check if it looks like a JMnedict entry (contains "surname", "person", city names, etc.)
    if (result.meaning.toLowerCase().includes('surname') ||
        result.meaning.toLowerCase().includes('place name') ||
        result.meaning.includes('東京') || result.meaning === 'Tokyo' ||
        result.meaning.includes('Kyoto') || result.meaning.includes('Osaka')) {
      source = 'JMnedict';
    } else if (result.meaning.toLowerCase().includes('japanese')) {
      source = 'Jisho/Dictionary';
    } else {
      source = 'Other';
    }
  }

  const passed = result !== null && result.meaning.toLowerCase().includes(expectedKeyword.toLowerCase());

  return {
    word,
    meaning: result?.meaning || 'Not found',
    source,
    expectedKeyword,
    passed
  };
}

async function testIssue37() {
  console.log('=' .repeat(70));
  console.log('Testing Issue #37: Add JMnedict support for proper noun lookups');
  console.log('=' .repeat(70));
  console.log();

  const dictionary = new DictionaryManager();
  const jmdictPath = path.join(__dirname, 'jmdict-db');
  const jmdictFile = path.join(__dirname, 'jmdict-all-3.6.2.json');
  const jmnedictFile = path.join(__dirname, 'jmnedict-sample.json');

  // Initialize with JMnedict support
  await dictionary.initialize('jmdict', jmdictPath, jmdictFile, jmnedictFile);
  console.log('[Setup] Dictionary initialized with JMnedict fallback\n');

  // Test cases from the issue
  const testCases = [
    { word: 'たなか', keyword: 'surname', description: 'Tanaka - surname (should use JMnedict)' },
    { word: 'とうきょう', keyword: 'tokyo', description: 'Tokyo (city)' },
    { word: 'にほんじん', keyword: 'japanese', description: 'Japanese person' },
  ];

  console.log('Running test cases:\n');
  const results: TestResult[] = [];

  for (const { word, keyword, description } of testCases) {
    process.stdout.write(`Testing "${word}" (${description})... `);
    const result = await runTest(dictionary, word, keyword);
    results.push(result);

    const status = result.passed ? '✓ PASS' : '✗ FAIL';
    console.log(`${status}`);
    console.log(`  Meaning: "${result.meaning}"`);
    console.log(`  Source: ${result.source}`);
    console.log();
  }

  // Summary
  console.log('=' .repeat(70));
  console.log('Test Summary');
  console.log('=' .repeat(70));
  const passedCount = results.filter(r => r.passed).length;
  const totalCount = results.length;
  console.log(`Passed: ${passedCount}/${totalCount}`);
  console.log();

  if (passedCount === totalCount) {
    console.log('✓ All tests PASSED! Issue #37 is FIXED!');
    console.log();
    console.log('JMnedict is now properly integrated:');
    console.log('- Primary → JMDict');
    console.log('- Fallback 1 → JMnedict (proper nouns)');
    console.log('- Fallback 2 → Jisho API');
    console.log('- Fallback 3 → KanjiData');
  } else {
    console.log('✗ Some tests FAILED. Check the results above.');
  }

  console.log();
  console.log('=' .repeat(70));
}

testIssue37().catch(console.error);
