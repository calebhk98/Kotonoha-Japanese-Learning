import { createTokenizer } from '../src/lib/tokenizers.js';
import kanjiData from 'kanji-data';
import { loadStoriesFromDisk } from '../src/lib/storyLoader.js';

async function main() {
  console.log('Loading tokenizer...');
  const tokenizer = await createTokenizer('sudachi-wasm');

  console.log('Loading stories...');
  const stories = loadStoriesFromDisk();

  let totalWords = 0;
  let dictionaryWords = 0;
  let unknownWords = 0;
  let uniqueDictionaryWords = new Set<string>();
  let uniqueUnknownWords = new Set<string>();
  let storiesByCoverage: Array<{ id: string; coverage: number; total: number; unknown: number }> = [];

  for (const story of stories) {
    console.log(`Analyzing: ${story.id}`);
    const tokens = await tokenizer.segment(story.text);
    let storyDictWords = 0;
    let storyUnknownWords = 0;

    for (const token of tokens) {
      const surface = token.surface;

      // Skip punctuation and spaces
      if (surface.trim() === '' || /[、。！？・「」『』（）()[\]a-zA-Z0-9\s]/.test(surface)) continue;

      totalWords++;

      // Check if word is in KanjiData dictionary (local, no API)
      const dictionaryResult = (kanjiData as any).searchWords(surface);
      if (dictionaryResult && dictionaryResult.length > 0) {
        dictionaryWords++;
        storyDictWords++;
        uniqueDictionaryWords.add(surface);
      } else {
        unknownWords++;
        storyUnknownWords++;
        uniqueUnknownWords.add(surface);
      }
    }

    const coverage = storyDictWords > 0 ? Math.round((storyDictWords / (storyDictWords + storyUnknownWords)) * 100) : 0;
    storiesByCoverage.push({
      id: story.id,
      coverage,
      total: storyDictWords + storyUnknownWords,
      unknown: storyUnknownWords
    });
  }

  console.log('\n=== DICTIONARY COVERAGE ANALYSIS ===\n');
  console.log(`Total tokens processed: ${totalWords}`);
  console.log(`Words found in dictionary: ${dictionaryWords} (${Math.round((dictionaryWords / totalWords) * 100)}%)`);
  console.log(`Words NOT in dictionary: ${unknownWords} (${Math.round((unknownWords / totalWords) * 100)}%)`);
  console.log(`\nUnique dictionary words: ${uniqueDictionaryWords.size}`);
  console.log(`Unique unknown words: ${uniqueUnknownWords.size}`);

  // Sort by coverage percentage
  storiesByCoverage.sort((a, b) => a.coverage - b.coverage);

  console.log('\n=== STORIES BY DICTIONARY COVERAGE ===\n');
  console.log('Story ID                              | Coverage | Total Words | Unknown');
  console.log('-------------------------------|----------|-------------|----------');

  for (const story of storiesByCoverage) {
    const id = story.id.padEnd(35);
    const coverage = `${story.coverage}%`.padEnd(10);
    const total = `${story.total}`.padEnd(13);
    console.log(`${id}| ${coverage}| ${total}| ${story.unknown}`);
  }

  console.log('\n=== SUMMARY ===');
  const avgCoverage = Math.round(storiesByCoverage.reduce((a, b) => a + b.coverage, 0) / storiesByCoverage.length);
  const totalUnknown = storiesByCoverage.reduce((a, b) => a + b.unknown, 0);
  console.log(`Average dictionary coverage: ${avgCoverage}%`);
  console.log(`Total unknown words across all stories: ${totalUnknown}`);
  console.log(`Stories with 100% coverage: ${storiesByCoverage.filter(s => s.coverage === 100).length}`);
  console.log(`Stories with <50% coverage: ${storiesByCoverage.filter(s => s.coverage < 50).length}`);
  console.log(`Stories with 0% coverage: ${storiesByCoverage.filter(s => s.coverage === 0).length}`);

  console.log('\n=== TOP 20 UNKNOWN WORDS ===');
  const unknownWordsList = Array.from(uniqueUnknownWords).sort();
  unknownWordsList.slice(0, 20).forEach(word => {
    console.log(`  - ${word}`);
  });
}

main().catch(console.error);
