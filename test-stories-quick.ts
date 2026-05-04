import fs from 'fs';
import path from 'path';
import { createTokenizer } from './src/lib/tokenizers';
import { DictionaryManager } from './src/lib/dictionary';
import { INITIAL_CONTENT } from './src/data/content';

interface StoryResult {
  title: string;
  accuracy: number;
  total: number;
  withDefs: number;
  missing: number;
}

interface TestResult {
  timestamp: string;
  totalStories: number;
  totalWords: number;
  totalWithDefs: number;
  totalMissing: number;
  overallAccuracy: number;
  stories: StoryResult[];
  missingWords: Map<string, number>;
}

async function main() {
  const startTime = Date.now();
  const tokenizer = await createTokenizer('sudachi-wasm');
  const dictionary = new DictionaryManager();

  const jmdictFile = path.join(process.cwd(), 'jmdict-all-3.6.2.json');
  if (fs.existsSync(jmdictFile)) {
    await dictionary.initialize('jmdict', path.join(process.cwd(), 'jmdict-db'), jmdictFile);
  } else {
    await dictionary.initialize('jisho');
  }

  const stories = INITIAL_CONTENT;
  const results: StoryResult[] = [];
  const missingWordsMap = new Map<string, number>();

  let totalWords = 0;
  let totalWithDefs = 0;
  let totalMissing = 0;

  console.log(`\n📖 Testing ${stories.length} stories (quiet mode)...\n`);

  // Filter out particles and punctuation
  const particles = new Set(['は', 'が', 'を', 'に', 'へ', 'と', 'で', 'も', 'か', 'の', 'て', 'な', 'だ']);
  const isPunctuation = (s: string) => /[、。！？・「」『』（）()[\]a-zA-Z0-9\s]/.test(s);
  const isSingleKana = (s: string) => s.length === 1 && (particles.has(s) || /[ぁ-ん]/.test(s));

  for (const story of stories) {
    if (story.type !== 'story') continue;
    process.stdout.write('.');
    const tokens = await tokenizer.segment(story.text);
    let storyWithDefs = 0;
    let storyMissing = 0;

    for (const token of tokens) {
      const surface = token.surface;
      // Skip filtered words
      if (surface.trim() === '' || isPunctuation(surface) || isSingleKana(surface)) continue;

      totalWords++;
      let def = await dictionary.lookup(token.baseForm);
      // Try surface form if base form didn't work
      if (!def) {
        def = await dictionary.lookup(surface);
      }

      if (def) {
        storyWithDefs++;
        totalWithDefs++;
      } else {
        storyMissing++;
        totalMissing++;
        missingWordsMap.set(
          token.baseForm,
          (missingWordsMap.get(token.baseForm) || 0) + 1
        );
      }
    }

    const accuracy = tokens.length > 0 ? (storyWithDefs / tokens.length) * 100 : 100;
    results.push({
      title: story.title,
      accuracy,
      total: tokens.length,
      withDefs: storyWithDefs,
      missing: storyMissing,
    });
  }

  console.log('\n');

  // Calculate stats
  const overallAccuracy = totalWords > 0 ? (totalWithDefs / totalWords) * 100 : 100;
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  // Sort stories by accuracy (worst first)
  results.sort((a, b) => a.accuracy - b.accuracy);

  // Print summary
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('📊 TEST RESULTS SUMMARY');
  console.log('═══════════════════════════════════════════════════════════════\n');
  console.log(`⏱️  Duration: ${elapsed}s`);
  console.log(`📖 Stories: ${stories.length}`);
  console.log(`📝 Total words: ${totalWords.toLocaleString()}`);
  console.log(`✅ Words with definitions: ${totalWithDefs.toLocaleString()}`);
  console.log(`❌ Words missing definitions: ${totalMissing.toLocaleString()}`);
  console.log(`\n✨ Overall Accuracy: ${overallAccuracy.toFixed(2)}%\n`);

  // Show worst performers
  console.log('───────────────────────────────────────────────────────────────');
  console.log('📈 Stories needing most attention (lowest accuracy):');
  console.log('───────────────────────────────────────────────────────────────\n');

  results.slice(0, 5).forEach((r, i) => {
    const bar = '█'.repeat(Math.round(r.accuracy / 5)) + '░'.repeat(20 - Math.round(r.accuracy / 5));
    console.log(`${i + 1}. ${r.title.substring(0, 40).padEnd(40)} [${bar}] ${r.accuracy.toFixed(1)}%`);
    if (r.missing > 0) {
      console.log(`   Missing: ${r.missing} words\n`);
    }
  });

  // Show missing words
  if (missingWordsMap.size > 0) {
    console.log('───────────────────────────────────────────────────────────────');
    console.log(`❌ ${missingWordsMap.size} UNIQUE WORDS WITHOUT DEFINITIONS:`);
    console.log('───────────────────────────────────────────────────────────────\n');

    const sorted = Array.from(missingWordsMap.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20);

    sorted.forEach(([word, count]) => {
      console.log(`   • ${word} (appears ${count}x)`);
    });

    if (missingWordsMap.size > 20) {
      console.log(`\n   ... and ${missingWordsMap.size - 20} more`);
    }
  }

  // Save detailed JSON results
  const jsonResults: TestResult = {
    timestamp: new Date().toISOString(),
    totalStories: stories.length,
    totalWords,
    totalWithDefs,
    totalMissing,
    overallAccuracy: parseFloat(overallAccuracy.toFixed(2)),
    stories: results,
    missingWords: Object.fromEntries(missingWordsMap),
  };

  const reportPath = `/tmp/test-results-${Date.now()}.json`;
  fs.writeFileSync(reportPath, JSON.stringify(jsonResults, null, 2));
  console.log(`\n📁 Full results saved to: ${reportPath}\n`);
}

main().catch(console.error);
