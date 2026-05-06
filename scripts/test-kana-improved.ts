import kanjiData from 'kanji-data';

async function main() {
  console.log('=== TESTING IMPROVED KANA FILTERING ===\n');

  const testWords = [
    'に', 'が', 'を', 'は', 'て',
    'です', 'ます',
    'いる', 'ある', 'する', 'なる',
  ];

  console.log('Word | Exact Matches | Hiragana-Only | Definition Quality');
  console.log('-----|---------------|---------------|-------------------');

  let goodDefs = 0;
  let badDefs = 0;

  for (const word of testWords) {
    // Step 1: Get all results
    let allEntries = (kanjiData as any).searchWords(word);

    // Step 2: Filter to exact matches
    let entries = allEntries.filter((entry: any) => {
      return entry.variants?.some((v: any) => v.written === word || v.pronounced === word);
    });

    const exactCount = entries.length;

    // Step 3: For pure kana, prefer hiragana-only entries
    const isPureKana = /^[ぁ-ん]+$/.test(word);
    if (isPureKana && entries.length > 0) {
      const hiraganaOnly = entries.filter(entry =>
        entry.variants?.some(v => /^[ぁ-ん]+$/.test(v.written))
      );
      if (hiraganaOnly.length > 0) {
        entries = hiraganaOnly;
      }
    }

    const hiraganaCount = entries.length;

    // Step 4: Sort by frequency
    entries.sort((a: any, b: any) => {
      const aFreq = (a.variants?.[0]?.priorities?.includes('ichi1') ? 2 :
                     a.variants?.[0]?.priorities?.includes('news1') ? 2 :
                     a.variants?.[0]?.priorities?.includes('ichi2') ? 1 :
                     a.variants?.[0]?.priorities?.includes('news2') ? 1 : 0);
      const bFreq = (b.variants?.[0]?.priorities?.includes('ichi1') ? 2 :
                     b.variants?.[0]?.priorities?.includes('news1') ? 2 :
                     b.variants?.[0]?.priorities?.includes('ichi2') ? 1 :
                     b.variants?.[0]?.priorities?.includes('news2') ? 1 : 0);
      return bFreq - aFreq;
    });

    const bestEntry = entries[0];
    const def = bestEntry?.meanings?.[0]?.glosses?.[0] || 'NO DEFINITION';

    // Judge quality (is it useful for learning?)
    const isUseful = def && def.length > 5 &&
                     !def.match(/^[A-Z].*\d/) && // Not a school name or technical
                     !def.includes('(') || def.includes('particle') || def.includes('copula');

    if (isUseful) goodDefs++;
    else badDefs++;

    const status = isUseful ? '✓' : '✗';

    console.log(`${word.padEnd(5)} | ${String(exactCount).padEnd(13)} | ${String(hiraganaCount).padEnd(13)} | ${status} ${def.substring(0, 40)}`);
  }

  console.log(`\nGood definitions: ${goodDefs}/${testWords.length}`);
  console.log(`Bad definitions: ${badDefs}/${testWords.length}`);

  console.log('\n=== CONCLUSION ===');
  console.log('With hiragana-only filtering:');
  console.log('- Local dict can handle many pure kana words');
  console.log('- But definitions are still often wrong senses');
  console.log('- Jisho API is still superior for particles/grammar');
  console.log('\nRecommendation:');
  console.log('Keep using Jisho API for pure kana words');
  console.log('But cache heavily so most lookups are instant');
}

main().catch(console.error);
