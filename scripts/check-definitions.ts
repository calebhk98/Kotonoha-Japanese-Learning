import { createTokenizer } from '../src/lib/tokenizers.js';
import { loadStoriesFromDisk } from '../src/lib/storyLoader.js';
import kanjiData from 'kanji-data';

async function main() {
  console.log('=== CHECKING DEFINITION QUALITY ===\n');

  const tokenizer = await createTokenizer('sudachi-wasm');
  const stories = loadStoriesFromDisk();

  // Test with first 3 stories
  const testStories = stories.slice(0, 3);

  // Collect unique pure kana words and their definitions
  const kanaWords = new Map<string, any>();

  for (const story of testStories) {
    const tokens = await tokenizer.segment(story.text);

    for (const token of tokens) {
      const surface = token.surface;
      const isPureHiragana = /^[ぁ-ん]+$/.test(surface);
      const isPureKatakana = /^[ァ-ヴー]+$/.test(surface);

      if ((isPureHiragana || isPureKatakana) && !kanaWords.has(surface)) {
        const result = (kanjiData as any).searchWords(surface);
        if (result && result.length > 0) {
          kanaWords.set(surface, result);
        }
      }
    }
  }

  console.log(`Found ${kanaWords.size} pure kana words in dictionary\n`);

  // Show sample definitions
  console.log('Sample definitions from KanjiData:\n');

  let count = 0;
  for (const [word, entries] of kanaWords.entries()) {
    if (count >= 30) break;

    const entry = entries[0];
    const meanings = entry.meanings?.[0]?.glosses || [];
    const variants = entry.variants || [];
    const reading = variants[0]?.pronounced || word;
    const written = variants[0]?.written || word;

    console.log(`${word} (${reading})`);
    console.log(`  Written: ${written}`);
    console.log(`  Meanings: ${meanings.slice(0, 3).join(', ') || 'No meaning'}`);

    // Check if it's useful
    const isUseful = meanings.length > 0 && meanings[0].length > 0 && !meanings[0].startsWith('[');
    console.log(`  Quality: ${isUseful ? '✓ Good' : '✗ Poor'}`);
    console.log();

    count++;
  }

  // Analyze definition quality
  console.log('\n=== DEFINITION QUALITY ANALYSIS ===\n');

  let goodDefinitions = 0;
  let poorDefinitions = 0;
  let noDefinitions = 0;

  for (const [word, entries] of kanaWords.entries()) {
    const entry = entries[0];
    const meanings = entry.meanings?.[0]?.glosses || [];

    if (meanings.length === 0) {
      noDefinitions++;
    } else {
      const firstMeaning = meanings[0];
      // Check if it looks like a real definition vs technical junk
      if (firstMeaning && firstMeaning.length > 3 && !firstMeaning.match(/^[\[\(]/) && firstMeaning !== word) {
        goodDefinitions++;
      } else {
        poorDefinitions++;
      }
    }
  }

  console.log(`Total words: ${kanaWords.size}`);
  console.log(`Good definitions: ${goodDefinitions} (${Math.round((goodDefinitions / kanaWords.size) * 100)}%)`);
  console.log(`Poor/unclear definitions: ${poorDefinitions} (${Math.round((poorDefinitions / kanaWords.size) * 100)}%)`);
  console.log(`No definitions: ${noDefinitions}`);

  // Show some examples of poor definitions
  const poorExamples = [];
  for (const [word, entries] of kanaWords.entries()) {
    const entry = entries[0];
    const meanings = entry.meanings?.[0]?.glosses || [];
    if (meanings.length > 0) {
      const firstMeaning = meanings[0];
      if (!firstMeaning || firstMeaning.length <= 3 || firstMeaning.match(/^[\[\(]/)) {
        poorExamples.push([word, firstMeaning || '(empty)']);
      }
    }
  }

  if (poorExamples.length > 0) {
    console.log('\nExamples of poor/unclear definitions:');
    poorExamples.slice(0, 10).forEach(([word, meaning]) => {
      console.log(`  ${word}: "${meaning}"`);
    });
  }

  // Check if we should still use the API for kana words with bad definitions
  console.log('\n=== RECOMMENDATION ===');
  if (goodDefinitions / kanaWords.size > 0.8) {
    console.log('✓ Definitions are mostly good - local dictionary is reliable');
  } else {
    console.log('⚠ Some definitions are unclear - might want to verify with API');
  }
}

main().catch(console.error);
