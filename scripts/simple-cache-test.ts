import { createTokenizer } from '../src/lib/tokenizers.js';
import { loadStoriesFromDisk } from '../src/lib/storyLoader.js';
import kanjiData from 'kanji-data';

async function main() {
  console.log('=== SIMPLE CACHING TEST ===\n');

  const tokenizer = await createTokenizer('sudachi-wasm');
  const stories = loadStoriesFromDisk();

  // Just test with first 5 stories
  const testStories = stories.slice(0, 5);

  console.log(`Testing caching with ${testStories.length} sample stories\n`);

  // Simulated cache like in real batch extract
  const wordsCache = new Map<string, boolean>();

  // Simulate batch extract behavior
  const tokenStart = Date.now();
  let totalTokens = 0;
  let uniqueWordsAcrossAllStories = new Set<string>();

  console.log('Step 1: Tokenize all stories');
  for (const story of testStories) {
    const tokens = await tokenizer.segment(story.text);
    totalTokens += tokens.length;

    for (const token of tokens) {
      if (!/[、。！？・「」『』（）()[\]a-zA-Z0-9\s]/.test(token.surface)) {
        uniqueWordsAcrossAllStories.add(token.surface);
      }
    }
  }
  const tokenTime = Date.now() - tokenStart;
  console.log(`  ${totalTokens} total tokens in ${tokenTime}ms`);
  console.log(`  ${uniqueWordsAcrossAllStories.size} unique words across all stories\n`);

  // Now process each story
  console.log('Step 2: Process each story and look up words');
  let totalLookups = 0;
  let cacheHits = 0;
  let cacheMisses = 0;

  for (const story of testStories) {
    const tokens = await tokenizer.segment(story.text);
    const storyWords = new Set<string>();

    // Collect unique words in this story
    for (const token of tokens) {
      const surface = token.surface;
      if (surface.trim() === '' || /[、。！？・「」『』（）()[\]a-zA-Z0-9\s]/.test(surface)) continue;
      storyWords.add(surface);
    }

    // Look up each word (simulating processTextWithTokens)
    for (const word of storyWords) {
      totalLookups++;

      if (wordsCache.has(word)) {
        cacheHits++;
      } else {
        // Simulate dictionary lookup
        const result = (kanjiData as any).searchWords(word);
        wordsCache.set(word, result && result.length > 0);
        cacheMisses++;
      }
    }

    console.log(`  ${story.id}: ${storyWords.size} words (${cacheHits}/${totalLookups} cache hits so far)`);
  }

  console.log(`\n=== RESULTS ===`);
  console.log(`Tokenization: ${tokenTime}ms for ${totalTokens} tokens`);
  console.log(`Unique words across batch: ${uniqueWordsAcrossAllStories.size}`);
  console.log(`Total word lookups: ${totalLookups}`);
  console.log(`Cache hits: ${cacheHits} (${Math.round((cacheHits / totalLookups) * 100)}%)`);
  console.log(`Cache misses: ${cacheMisses} (${Math.round((cacheMisses / totalLookups) * 100)}%)`);
  console.log(`Cache efficiency: First lookup might be slow, subsequent lookups hit cache`);

  // Now show the REAL issue - kana words are NEVER cached!
  console.log(`\n=== THE ISSUE ===`);
  console.log('In batch-extract, pure kana words are looked up via API but NOT saved to wordsCache!');
  console.log('So if a kana word appears in multiple stories, it gets looked up multiple times.\n');

  // Count pure kana words
  let pureKanaWords = 0;
  for (const word of uniqueWordsAcrossAllStories) {
    const isPureHiragana = /^[ぁ-ん]+$/.test(word);
    const isPureKatakana = /^[ァ-ヴー]+$/.test(word);
    if (isPureHiragana || isPureKatakana) {
      pureKanaWords++;
    }
  }
  console.log(`Pure kana words in sample: ${pureKanaWords} / ${uniqueWordsAcrossAllStories.size}`);
  console.log(`These would need API lookups and should be cached!`);
}

main().catch(console.error);
