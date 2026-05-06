import { createTokenizer } from '../src/lib/tokenizers.js';
import { loadStoriesFromDisk } from '../src/lib/storyLoader.js';
import kanjiData from 'kanji-data';

async function main() {
  console.log('=== BATCH EXTRACT DIAGNOSTIC ===\n');

  // Tokenize all texts
  console.log('Loading tokenizer...');
  const tokenizer = await createTokenizer('sudachi-wasm');

  console.log('Loading stories...');
  const stories = loadStoriesFromDisk();

  // Sort by text length (as batch-extract does)
  const sortedStories = [...stories].sort((a, b) => (a.text?.length ?? 0) - (b.text?.length ?? 0));

  console.log(`Found ${stories.length} stories, processing in order of length:\n`);

  // Tokenize all texts
  const tokenStart = Date.now();
  console.log('Tokenizing all stories...');
  const tokenizedBatch = await Promise.all(
    sortedStories.map(async (item) => {
      if (!item.text || typeof item.text !== 'string') return { ...item, tokens: [] };
      try {
        const tokens = await tokenizer.segment(item.text);
        return { ...item, tokens };
      } catch (e) {
        return { ...item, tokens: [] };
      }
    })
  );
  const tokenTime = Date.now() - tokenStart;
  console.log(`✓ Tokenization complete in ${tokenTime}ms\n`);

  // Collect unique kana-only words from all texts
  const particles = new Set(['は', 'が', 'を', 'に', 'へ', 'と', 'で', 'も', 'か', 'の', 'て', 'な', 'だ']);
  const isPunctuation = (s: string) => /[、。！？・「」『』（）()[\]a-zA-Z0-9\s]/.test(s);
  const isSingleKana = (s: string) => s.length === 1 && (particles.has(s) || /[ぁ-ん]/.test(s));

  const uniqueKanaWords = new Set<string>();
  const totalTokensProcessed = new Map<string, number>(); // Track how many times each word appears total

  for (const item of tokenizedBatch) {
    if (!item.tokens) continue;
    for (const token of item.tokens) {
      const surface = token.surface;
      if (surface.trim() === '' || isPunctuation(surface) || isSingleKana(surface)) continue;

      const isPureHiragana = /^[ぁ-ん]+$/.test(surface);
      const isPureKatakana = /^[ァ-ヴー]+$/.test(surface);
      if (isPureHiragana || isPureKatakana) {
        uniqueKanaWords.add(surface);
        totalTokensProcessed.set(surface, (totalTokensProcessed.get(surface) ?? 0) + 1);
      }
    }
  }

  console.log(`Found ${uniqueKanaWords.size} unique pure kana words`);
  console.log(`Total kana word tokens: ${Array.from(totalTokensProcessed.values()).reduce((a, b) => a + b, 0)}\n`);

  // Now process each story and track lookups
  const lookupStats = new Map<string, { count: number; foundInDict: boolean }>();
  let totalLookups = 0;
  let dictHits = 0;
  let dictMisses = 0;

  console.log('Processing stories with lookup tracking:\n');

  for (const item of tokenizedBatch) {
    const storyId = item.id;
    if (!item.tokens) continue;

    const storyLookups = new Set<string>();
    const validWords = new Map<string, string>();

    // Collect words for this story
    for (const token of item.tokens) {
      const surface = token.surface;
      if (surface.trim() === '' || isPunctuation(surface)) continue;

      if (!isSingleKana(surface)) {
        validWords.set(surface, token.baseForm);
      }
    }

    // Look up each word (simulating the batch process)
    for (const [wordStr, baseForm] of validWords) {
      if (!storyLookups.has(wordStr)) {
        storyLookups.add(wordStr);
        totalLookups++;

        // Try baseForm first, then wordStr
        let foundInDict = false;
        const baseFormResult = (kanjiData as any).searchWords(baseForm);
        if (baseFormResult && baseFormResult.length > 0) {
          foundInDict = true;
          dictHits++;
        } else {
          const surfaceResult = (kanjiData as any).searchWords(wordStr);
          if (surfaceResult && surfaceResult.length > 0) {
            foundInDict = true;
            dictHits++;
          } else {
            dictMisses++;
          }
        }

        // Track stats
        const stat = lookupStats.get(wordStr);
        if (stat) {
          stat.count++;
        } else {
          lookupStats.set(wordStr, { count: 1, foundInDict });
        }
      }
    }

    console.log(`  ${storyId}: ${storyLookups.size} unique words looked up`);
  }

  console.log(`\n✓ Total unique word lookups: ${totalLookups}`);
  console.log(`  Dictionary hits: ${dictHits} (${Math.round((dictHits / totalLookups) * 100)}%)`);
  console.log(`  Dictionary misses: ${dictMisses} (${Math.round((dictMisses / totalLookups) * 100)}%)\n`);

  // Check for words looked up multiple times across stories
  const multiLookups = Array.from(lookupStats.entries())
    .filter(([_, stat]) => stat.count > 1)
    .sort((a, b) => b[1].count - a[1].count);

  console.log(`Words looked up multiple times across stories: ${multiLookups.length}`);
  if (multiLookups.length > 0) {
    console.log('Top 20 repeated lookups:');
    multiLookups.slice(0, 20).forEach(([word, stat]) => {
      console.log(`  ${word}: ${stat.count} times (${stat.foundInDict ? 'found' : 'not found'})`);
    });
  }

  console.log('\n=== SUMMARY ===');
  console.log(`Tokenization time: ${tokenTime}ms`);
  console.log(`Stories processed in length order: YES`);
  console.log(`Cache efficiency: Words are looked up once per story, repeated across stories`);
  console.log(`Dictionary coverage: ${Math.round((dictHits / totalLookups) * 100)}% can be found locally`);
  console.log(`API calls would be needed: ${dictMisses} (for words not in local dictionary)`);
}

main().catch(console.error);
