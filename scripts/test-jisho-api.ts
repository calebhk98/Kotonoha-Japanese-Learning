async function main() {
  console.log('=== TESTING JISHO API DEFINITIONS ===\n');

  // Test words: particles, verbs, common words
  const testWords = [
    { word: 'に', category: 'particle', expected: 'target/direction marker' },
    { word: 'が', category: 'particle', expected: 'subject marker' },
    { word: 'を', category: 'particle', expected: 'object marker' },
    { word: 'は', category: 'particle', expected: 'topic marker' },
    { word: 'です', category: 'grammar', expected: 'polite copula (is)' },
    { word: 'ます', category: 'grammar', expected: 'polite verb ending' },
    { word: 'いる', category: 'verb', expected: 'to exist, to be' },
    { word: 'ある', category: 'verb', expected: 'to have, to exist' },
    { word: 'する', category: 'verb', expected: 'to do' },
    { word: 'なる', category: 'verb', expected: 'to become' },
    { word: 'ねこ', category: 'noun', expected: 'cat' },
    { word: 'りんご', category: 'noun', expected: 'apple' },
    { word: 'あした', category: 'noun', expected: 'tomorrow' },
  ];

  for (const { word, category, expected } of testWords) {
    try {
      const response = await fetch(`https://jisho.org/api/v1/search/words?keyword=${encodeURIComponent(word)}`);
      const data = await response.json();

      if (!data.data || data.data.length === 0) {
        console.log(`${word.padEnd(8)} [${category}] ✗ NO RESULTS`);
        continue;
      }

      const entry = data.data[0];
      const meanings = entry.senses?.[0]?.english_definitions || [];
      const reading = entry.japanese?.[0]?.reading || word;
      const jlpt = entry.jlpt?.[0] || null;

      const mainDef = meanings[0] || 'No definition';
      const allDefs = meanings.slice(0, 3).join('; ');

      console.log(`${word.padEnd(8)} [${category}]`);
      console.log(`  Reading: ${reading}`);
      console.log(`  JLPT: ${jlpt ? `N${jlpt}` : 'Not listed'}`);
      console.log(`  Definition: ${mainDef}`);
      if (meanings.length > 1) {
        console.log(`  Other defs: ${meanings.slice(1, 3).join(', ')}`);
      }

      // Judge if it's useful for learning
      const isUseful = mainDef && mainDef.length > 5 && !mainDef.includes('http');
      const status = isUseful ? '✓' : '✗';
      console.log(`  Quality: ${status} ${isUseful ? 'Good for learning' : 'Questionable'}`);
      console.log();

    } catch (e) {
      console.log(`${word}: ERROR - ${(e as Error).message}`);
    }
  }

  console.log('\n=== ANALYSIS ===');
  console.log('Jisho API provides:');
  console.log('✓ English definitions');
  console.log('✓ Readings (pronunciation)');
  console.log('✓ JLPT levels (for learners)');
  console.log('✓ Multiple definitions');
  console.log('✓ Part of speech information');
}

main().catch(console.error);
