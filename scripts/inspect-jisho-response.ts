async function main() {
  console.log('=== INSPECTING JISHO API RESPONSE ===\n');

  // Test with "に" which returned wrong definition
  const word = 'に';
  console.log(`Fetching all definitions for "${word}":\n`);

  const response = await fetch(`https://jisho.org/api/v1/search/words?keyword=${encodeURIComponent(word)}`);
  const data = await response.json();

  if (!data.data || data.data.length === 0) {
    console.log('No results');
    return;
  }

  // Show first 5 results
  console.log(`Found ${data.data.length} results\n`);

  for (let i = 0; i < Math.min(5, data.data.length); i++) {
    const entry = data.data[i];
    const japanese = entry.japanese?.[0];
    const senses = entry.senses || [];

    console.log(`Result ${i + 1}:`);
    console.log(`  Word: ${japanese?.word || '(no word)'} (${japanese?.reading})`);
    console.log(`  Senses: ${senses.length}`);

    senses.slice(0, 2).forEach((sense, idx) => {
      const defs = sense.english_definitions?.join('; ') || 'No definition';
      const pos = sense.parts_of_speech?.join(', ') || 'unknown';
      console.log(`    ${idx + 1}. [${pos}] ${defs}`);
    });

    console.log();
  }

  console.log('\n=== THE ISSUE ===');
  console.log('Jisho returns MULTIPLE results for each word.');
  console.log('The first result might be the wrong sense!');
  console.log('\nFor best results, we should:');
  console.log('1. Look for entries matching the word exactly');
  console.log('2. Prioritize by part of speech');
  console.log('3. Use the first sense of the best match');
}

main().catch(console.error);
