import { createTokenizer } from '../src/lib/tokenizers.js';
import { DictionaryManager } from '../src/lib/dictionary.js';
import { loadStoriesFromDisk } from '../src/lib/storyLoader.js';

async function main() {
  console.log('Loading dictionary...');
  const dict = new DictionaryManager();
  await dict.initialize();

  console.log('Loading tokenizer...');
  const tokenizer = await createTokenizer('sudachi-wasm');

  console.log('Loading stories...');
  const stories = loadStoriesFromDisk();

  let totalWords = 0;
  let dictionaryWords = 0;
  let apiWords = 0;
  let uniqueDictionaryWords = new Set<string>();
  let uniqueApiWords = new Set<string>();
  let storiesByDictionaryCoverage: Array<{ id: string; coverage: number; total: number; apiNeeded: number }> = [];

  for (const story of stories) {
    const tokens = await tokenizer.segment(story.text);
    let storyDictWords = 0;
    let storyApiWords = 0;

    for (const token of tokens) {
      const surface = token.surface;
      totalWords++;

      // Check if word is in dictionary
      const dictionaryResult = await dict.lookup(surface);
      if (dictionaryResult) {
        dictionaryWords++;
        storyDictWords++;
        uniqueDictionaryWords.add(surface);
      } else {
        // Check if it's pure kana - would need API call
        const isPureKana = /^[ぁ-ん|ァ-ヴー]+$/.test(surface);
        if (isPureKana) {
          apiWords++;
          storyApiWords++;
          uniqueApiWords.add(surface);
        }
      }
    }

    const coverage = storyDictWords > 0 ? Math.round((storyDictWords / (storyDictWords + storyApiWords)) * 100) : 0;
    storiesByDictionaryCoverage.push({
      id: story.id,
      coverage,
      total: storyDictWords + storyApiWords,
      apiNeeded: storyApiWords
    });
  }

  console.log('\n=== DICTIONARY COVERAGE ANALYSIS ===\n');
  console.log(`Total tokens processed: ${totalWords}`);
  console.log(`Words found in dictionary: ${dictionaryWords} (${Math.round((dictionaryWords / totalWords) * 100)}%)`);
  console.log(`Words needing API calls: ${apiWords} (${Math.round((apiWords / totalWords) * 100)}%)`);
  console.log(`\nUnique dictionary words: ${uniqueDictionaryWords.size}`);
  console.log(`Unique API words needed: ${uniqueApiWords.size}`);

  // Sort by coverage percentage
  storiesByDictionaryCoverage.sort((a, b) => a.coverage - b.coverage);

  console.log('\n=== STORIES BY DICTIONARY COVERAGE ===\n');
  console.log('Story ID                              | Coverage | Total Words | API Calls Needed');
  console.log('-------------------------------|----------|-------------|---------------');

  for (const story of storiesByDictionaryCoverage) {
    const id = story.id.padEnd(35);
    const coverage = `${story.coverage}%`.padEnd(10);
    const total = `${story.total}`.padEnd(13);
    console.log(`${id}| ${coverage}| ${total}| ${story.apiNeeded}`);
  }

  console.log('\n=== SUMMARY ===');
  const avgCoverage = Math.round(storiesByDictionaryCoverage.reduce((a, b) => a + b.coverage, 0) / storiesByDictionaryCoverage.length);
  const totalApiCalls = storiesByDictionaryCoverage.reduce((a, b) => a + b.apiNeeded, 0);
  console.log(`Average dictionary coverage: ${avgCoverage}%`);
  console.log(`Total API calls needed for all stories: ${totalApiCalls}`);
  console.log(`Stories with <50% coverage: ${storiesByDictionaryCoverage.filter(s => s.coverage < 50).length}`);
  console.log(`Stories with 0% dictionary coverage: ${storiesByDictionaryCoverage.filter(s => s.coverage === 0).length}`);
}

main().catch(console.error);
