import kanjiData from 'kanji-data';

async function main() {
  console.log('=== TESTING LOCAL DICTIONARY (KanjiData) ===\n');

  // Test words that might have multiple entries
  const testWords = [
    { word: '読む', expected: 'to read' },
    { word: '書く', expected: 'to write' },
    { word: '見る', expected: 'to see, to watch' },
    { word: '行く', expected: 'to go' },
    { word: '来る', expected: 'to come' },
    { word: '食べる', expected: 'to eat' },
    { word: '飲む', expected: 'to drink' },
    { word: '学校', expected: 'school' },
    { word: '家', expected: 'house' },
    { word: '本', expected: 'book' },
  ];

  console.log('Word | First Result | Additional Results');
  console.log('-----|--------------|------------------');

  for (const { word, expected } of testWords) {
    try {
      const results = (kanjiData as any).searchWords(word);

      if (!results || results.length === 0) {
        console.log(`${word.padEnd(8)} | NO RESULTS | -`);
        continue;
      }

      const firstResult = results[0];
      const firstDef = firstResult.meanings?.[0]?.glosses?.join(', ') || 'No definition';

      let additionalCount = '';
      if (results.length > 1) {
        additionalCount = `${results.length - 1} more`;
      }

      console.log(`${word.padEnd(8)} | ${firstDef.substring(0, 30).padEnd(30)} | ${additionalCount}`);

      // Show all results if multiple
      if (results.length > 1) {
        console.log(`\n  All results for "${word}":`);
        results.slice(0, 5).forEach((result, idx) => {
          const defs = result.meanings?.[0]?.glosses?.join(', ') || 'No def';
          const variants = result.variants || [];
          const written = variants[0]?.written || word;
          console.log(`    ${idx + 1}. ${written} - ${defs.substring(0, 60)}`);
        });
        console.log();
      }

    } catch (e) {
      console.log(`${word}: ERROR`);
    }
  }

  console.log('\n=== ANALYSIS ===');
  console.log('Does KanjiData return multiple results?');
  console.log('- For some words: YES');
  console.log('- For others: NO, but when it does, we might want the best match');
  console.log('\nWe should pick results by:');
  console.log('1. Exact kanji match (prioritize compounds that use this kanji)');
  console.log('2. Part of speech (verbs for action words, nouns for objects)');
  console.log('3. Frequency/commonness');
}

main().catch(console.error);
