import { createTokenizer } from '../src/lib/tokenizers.js';
import { loadStoriesFromDisk } from '../src/lib/storyLoader.js';
import kanjiData from 'kanji-data';

async function main() {
  console.log('=== LOOKUP INVESTIGATION ===\n');

  const tokenizer = await createTokenizer('sudachi-wasm');
  const stories = loadStoriesFromDisk();

  // Test with a few stories
  const testStories = stories.slice(0, 3);

  console.log('Question 1: Are words looked up multiple times WITHIN a story?\n');

  for (const story of testStories) {
    const tokens = await tokenizer.segment(story.text);

    // Count how many times each word appears
    const wordFrequency = new Map<string, number>();
    const particles = new Set(['は', 'が', 'を', 'に', 'へ', 'と', 'で', 'も', 'か', 'の', 'て', 'な', 'だ']);
    const isSingleKana = (s: string) => s.length === 1 && (particles.has(s) || /[ぁ-ん]/.test(s));

    for (const token of tokens) {
      const surface = token.surface;
      if (surface.trim() === '' || /[、。！？・「」『』（）()[\]a-zA-Z0-9\s]/.test(surface)) continue;
      if (!isSingleKana(surface)) {
        wordFrequency.set(surface, (wordFrequency.get(surface) ?? 0) + 1);
      }
    }

    const uniqueWords = wordFrequency.size;
    const totalWords = Array.from(wordFrequency.values()).reduce((a, b) => a + b, 0);
    const repeatedWords = Array.from(wordFrequency.entries()).filter(([_, count]) => count > 1);

    console.log(`  ${story.id}:`);
    console.log(`    Total word tokens: ${totalWords}`);
    console.log(`    Unique words: ${uniqueWords}`);
    console.log(`    Words repeated 2+ times: ${repeatedWords.length}`);
    if (repeatedWords.length > 0) {
      console.log(`    Most repeated: ${repeatedWords.sort((a, b) => b[1] - a[1])[0][0]} (${repeatedWords[0][1]} times)`);
    }
    console.log();
  }

  console.log('\nQuestion 2: Can pure kana words be found in the local dictionary?\n');

  // Collect all pure kana words from test stories
  const pureKanaWords = new Map<string, { inDict: boolean; count: number }>();

  for (const story of testStories) {
    const tokens = await tokenizer.segment(story.text);

    for (const token of tokens) {
      const surface = token.surface;
      const isPureHiragana = /^[ぁ-ん]+$/.test(surface);
      const isPureKatakana = /^[ァ-ヴー]+$/.test(surface);

      if (isPureHiragana || isPureKatakana) {
        if (!pureKanaWords.has(surface)) {
          // Check if it's in the dictionary
          const result = (kanjiData as any).searchWords(surface);
          pureKanaWords.set(surface, {
            inDict: result && result.length > 0,
            count: 1
          });
        } else {
          const entry = pureKanaWords.get(surface)!;
          entry.count++;
        }
      }
    }
  }

  const uniquePureKana = pureKanaWords.size;
  const inDict = Array.from(pureKanaWords.values()).filter(v => v.inDict).length;
  const notInDict = uniquePureKana - inDict;

  console.log(`  Total unique pure kana words: ${uniquePureKana}`);
  console.log(`  Found in local dictionary: ${inDict} (${Math.round((inDict / uniquePureKana) * 100)}%)`);
  console.log(`  NOT in dictionary (would need API): ${notInDict} (${Math.round((notInDict / uniquePureKana) * 100)}%)\n`);

  if (notInDict > 0) {
    console.log('  Words NOT in dictionary (need API):');
    Array.from(pureKanaWords.entries())
      .filter(([_, v]) => !v.inDict)
      .slice(0, 20)
      .forEach(([word, v]) => {
        console.log(`    - ${word} (appears ${v.count} times)`);
      });
  }

  console.log('\n=== CONCLUSION ===');
  console.log(`Within stories: Words are deduplicated (each unique word looked up once)`);
  console.log(`Across stories: Cache should prevent repeating the same lookups`);
  console.log(`Kana words: ${Math.round((notInDict / uniquePureKana) * 100)}% need API, could skip the rest!`);
}

main().catch(console.error);
