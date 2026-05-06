import kanjiData from 'kanji-data';

async function main() {
  console.log('=== DEFINITION QUALITY ISSUE ===\n');

  // Test words that appear frequently
  const testWords = [
    { kana: 'に', expected: 'marks target/direction' },
    { kana: 'が', expected: 'marks subject' },
    { kana: 'を', expected: 'marks object' },
    { kana: 'です', expected: 'polite copula (is)' },
    { kana: 'ます', expected: 'polite verb marker' },
    { kana: 'いる', expected: 'to be, to exist' },
    { kana: 'ある', expected: 'to be, to have, to exist' },
    { kana: 'する', expected: 'to do' },
    { kana: 'なる', expected: 'to become' },
    { kana: 'いく', expected: 'to go' },
  ];

  console.log('Word | KanjiData Returns | What We Need');
  console.log('-----|------------------|------------');

  let correctCount = 0;
  let wrongCount = 0;

  for (const { kana, expected } of testWords) {
    const result = (kanjiData as any).searchWords(kana);
    const kanjiDataDef = result && result.length > 0 ? result[0].meanings?.[0]?.glosses?.[0] : 'NOT FOUND';

    const isCorrect = kanjiDataDef && kanjiDataDef.length < 50 && !kanjiDataDef.includes('一') && !kanjiDataDef.includes('第');

    if (isCorrect) correctCount++;
    else wrongCount++;

    const status = isCorrect ? '✓' : '✗';
    console.log(`${kana} | ${kanjiDataDef.substring(0, 30).padEnd(30)} | ${expected}`);
  }

  console.log(`\n${correctCount}/${testWords.length} have usable definitions`);
  console.log(`${wrongCount}/${testWords.length} are compound word definitions (not useful for learning)`);

  console.log('\n=== THE PROBLEM ===');
  console.log(`KanjiData treats pure kana as search terms and returns compound words.`);
  console.log(`For example, searching "に" returns "一日か二日" (1-2 days)`);
  console.log(`But students need: "に" = particle marking target/direction\n`);

  console.log('=== RECOMMENDATION ===');
  console.log('✓ Keep local dictionary for KANJI words (they work fine)');
  console.log('✗ Do NOT use local dictionary for pure kana (wrong definitions)');
  console.log('✓ Use Jisho API for pure kana words (has proper grammar definitions)');
  console.log('\nBut only ~4% of kana words (onomatopoeia, proper names) are not in');
  console.log('the API anyway, so just look up all kana words via API!');
}

main().catch(console.error);
