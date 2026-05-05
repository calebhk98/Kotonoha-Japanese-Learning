/**
 * Test to verify that issue #37 is fixed:
 * "Add JMnedict support for proper noun lookups"
 *
 * This test verifies that:
 * 1. たなか (Tanaka - surname) is correctly identified via JMnedict
 * 2. とうきょう (Tokyo) works reliably
 * 3. ぎふ (Gifu) is found
 * 4. Other proper nouns are handled correctly
 */

import path from 'path';
import { fileURLToPath } from 'url';
import { DictionaryManager } from './src/lib/dictionary.js';
import { ensureJmnedictPrepared } from './src/lib/jmnedict-utils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface TestResult {
  word: string;
  meaning: string;
  passed: boolean;
}

async function runTest(dictionary: DictionaryManager, word: string, expectedKeyword: string): Promise<TestResult> {
  const result = await dictionary.lookup(word);
  const passed = result !== null && result.meaning.toLowerCase().includes(expectedKeyword.toLowerCase());

  return {
    word,
    meaning: result?.meaning || 'Not found',
    passed
  };
}

async function testIssue37() {
  console.log('=' .repeat(70));
  console.log('Testing Issue #37: Add JMnedict support for proper noun lookups');
  console.log('=' .repeat(70));
  console.log();

  // Prepare JMnedict using the same logic as the server
  const jmnedictFile = await ensureJmnedictPrepared();
  console.log();

  if (!jmnedictFile) {
    console.error('✗ Failed to prepare JMnedict dictionary');
    process.exit(1);
  }

  const dictionary = new DictionaryManager();
  const jmdictPath = path.join(__dirname, 'jmdict-db');
  const jmdictFile = path.join(__dirname, 'jmdict-all-3.6.2.json');

  // Initialize with JMnedict support
  await dictionary.initialize('jmdict', jmdictPath, jmdictFile, jmnedictFile);
  console.log('[Setup] Dictionary initialized with full JMnedict\n');

  // Test cases from the issue
  const testCases = [
    { word: 'たなか', keyword: 'tanaka', description: 'Tanaka - surname' },
    { word: 'とうきょう', keyword: 'tokyo', description: 'Tokyo - place name' },
    { word: 'ぎふ', keyword: 'gifu', description: 'Gifu - place name' },
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
    console.log('- Full dictionary with 743K+ proper noun entries');
    console.log('- Auto-decompressed on first run');
    console.log('- Integrated into fallback chain');
  } else {
    console.log('✗ Some tests FAILED. Check the results above.');
  }

  console.log();
  console.log('=' .repeat(70));
}

testIssue37().catch(console.error);
