import path from 'path';
import { fileURLToPath } from 'url';
import { DictionaryManager } from './src/lib/dictionary.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function testJMnedict() {
  console.log('[Test] Starting JMnedict tests...\n');

  const dictionary = new DictionaryManager();
  const jmdictPath = path.join(__dirname, 'jmdict-db');
  const jmdictFile = path.join(__dirname, 'jmdict-all-3.6.2.json');
  const jmnedictFile = path.join(__dirname, 'jmnedict-sample.json');

  // Initialize with JMnedict support
  await dictionary.initialize('jmdict', jmdictPath, jmdictFile, jmnedictFile);

  // Test cases for proper nouns
  const testCases = [
    'たなか',      // Tanaka (surname)
    'とうきょう',  // Tokyo
    'にほんじん',  // Japanese person
    'さとう',      // Sato (surname)
    'すずき',      // Suzuki (surname)
    'きょうと',    // Kyoto
    'おおさか',    // Osaka
  ];

  console.log('[Test] Testing proper noun lookups:\n');
  for (const word of testCases) {
    const result = await dictionary.lookup(word);
    if (result) {
      console.log(`✓ "${word}": ${result.meaning}`);
      if (result.meanings && result.meanings.length > 1) {
        console.log(`  Alternative meanings: ${result.meanings.slice(1).join(', ')}`);
      }
    } else {
      console.log(`✗ "${word}": No result found`);
    }
  }

  console.log('\n[Test] JMnedict tests complete!');
}

testJMnedict().catch(console.error);
