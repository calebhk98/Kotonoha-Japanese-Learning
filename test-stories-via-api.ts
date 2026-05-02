import { INITIAL_CONTENT } from './src/data/content';
import fs from 'fs';

interface StoryResult {
  id: string;
  title: string;
  totalWords: number;
  wordsWithDefinitions: number;
  wordsWithoutDefinitions: number;
  accuracy: number;
  unknownWords: string[];
}

interface AggregateResults {
  totalStories: number;
  totalWords: number;
  wordsWithDefinitions: number;
  wordsWithoutDefinitions: number;
  overallAccuracy: number;
  uniqueMissingWords: string[];
  storyResults: StoryResult[];
  timestamp: string;
}

async function testStoriesViaAPI(): Promise<void> {
  const API_URL = 'http://localhost:3000/api/extract';

  console.log('🧪 Testing all stories via API (requires running server on port 3000)\n');
  console.log('Make sure to run: npm run dev\n');

  const results: AggregateResults = {
    totalStories: 0,
    totalWords: 0,
    wordsWithDefinitions: 0,
    wordsWithoutDefinitions: 0,
    overallAccuracy: 0,
    uniqueMissingWords: [],
    storyResults: [],
    timestamp: new Date().toISOString(),
  };

  const uniqueMissingSet = new Set<string>();

  // Test each story
  for (const content of INITIAL_CONTENT) {
    if (content.type !== 'story') continue;

    console.log(`📖 Testing: ${content.title}`);

    try {
      const response = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: content.text }),
      });

      if (!response.ok) {
        console.log(`   ❌ API error: ${response.status}`);
        continue;
      }

      const words = await response.json();
      const wordsWithDefs = words.filter((w: any) => w.meaning !== 'Unknown meaning').length;
      const wordsWithoutDefs = words.filter((w: any) => w.meaning === 'Unknown meaning').length;
      const accuracy = (wordsWithDefs / (wordsWithDefs + wordsWithoutDefs)) * 100;

      const unknownWords = words
        .filter((w: any) => w.meaning === 'Unknown meaning')
        .map((w: any) => w.word);

      unknownWords.forEach(w => uniqueMissingSet.add(w));

      const storyResult: StoryResult = {
        id: content.id,
        title: content.title,
        totalWords: wordsWithDefs + wordsWithoutDefs,
        wordsWithDefinitions: wordsWithDefs,
        wordsWithoutDefinitions: wordsWithoutDefs,
        accuracy,
        unknownWords: [...new Set(unknownWords)],
      };

      results.storyResults.push(storyResult);
      results.totalStories++;
      results.totalWords += storyResult.totalWords;
      results.wordsWithDefinitions += wordsWithDefs;
      results.wordsWithoutDefinitions += wordsWithoutDefs;

      console.log(
        `   ✓ ${wordsWithDefs}/${storyResult.totalWords} words with definitions (${accuracy.toFixed(1)}%)`
      );
    } catch (error) {
      console.log(`   ❌ Error: ${(error as any).message}`);
    }
  }

  // Calculate overall accuracy
  if (results.totalWords > 0) {
    results.overallAccuracy = (results.wordsWithDefinitions / results.totalWords) * 100;
  }
  results.uniqueMissingWords = Array.from(uniqueMissingSet).sort();

  // Print summary
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('📊 OVERALL RESULTS');
  console.log('═══════════════════════════════════════════════════════════════\n');
  console.log(`Stories tested: ${results.totalStories}`);
  console.log(`Total words analyzed: ${results.totalWords}`);
  console.log(`Words with definitions: ${results.wordsWithDefinitions}`);
  console.log(`Words missing definitions: ${results.wordsWithoutDefinitions}`);
  console.log(`\n✨ Overall Accuracy: ${results.overallAccuracy.toFixed(1)}%\n`);

  // Print per-story results
  console.log('─────────────────────────────────────────────────────────────');
  console.log('📈 RESULTS BY STORY');
  console.log('─────────────────────────────────────────────────────────────\n');

  results.storyResults
    .sort((a, b) => a.accuracy - b.accuracy)
    .forEach(result => {
      const bar = '█'.repeat(Math.round(result.accuracy / 5)) + '░'.repeat(20 - Math.round(result.accuracy / 5));
      console.log(`${result.title}`);
      console.log(`  [${bar}] ${result.accuracy.toFixed(1)}% (${result.wordsWithDefinitions}/${result.totalWords})`);
    });

  // Print unique missing words
  console.log('\n─────────────────────────────────────────────────────────────');
  console.log('❌ UNIQUE WORDS WITHOUT DEFINITIONS');
  console.log('─────────────────────────────────────────────────────────────\n');

  const missing = results.uniqueMissingWords;
  if (missing.length === 0) {
    console.log('✅ All words have definitions!');
  } else {
    console.log(`Total unique missing words: ${missing.length}\n`);

    // Group by category
    const katakana = missing.filter(w => /^[ァ-ヴー]+$/.test(w));
    const hiragana = missing.filter(w => /^[ぁ-ん]+$/.test(w));
    const kanji = missing.filter(w => /[漢字一-龠々]/.test(w));
    const compound = missing.filter(w =>
      w.length > 2 && !katakana.includes(w) && !hiragana.includes(w) && !kanji.includes(w)
    );

    if (katakana.length > 0) {
      console.log(`🔤 Katakana (${katakana.length}): ${katakana.slice(0, 10).join(', ')}${katakana.length > 10 ? '...' : ''}`);
    }
    if (hiragana.length > 0) {
      console.log(`📝 Hiragana (${hiragana.length}): ${hiragana.slice(0, 10).join(', ')}${hiragana.length > 10 ? '...' : ''}`);
    }
    if (kanji.length > 0) {
      console.log(`🔤 Kanji/Mixed (${kanji.length}): ${kanji.slice(0, 10).join(', ')}${kanji.length > 10 ? '...' : ''}`);
    }
    if (compound.length > 0) {
      console.log(`🔗 Compound/Multi-word (${compound.length}): ${compound.slice(0, 10).join(', ')}${compound.length > 10 ? '...' : ''}`);
    }

    console.log('\n📋 Complete list of missing words:');
    missing.forEach(word => console.log(`  - ${word}`));
  }

  // Save results to file
  const reportPath = `tokenization-report-${Date.now()}.json`;
  fs.writeFileSync(reportPath, JSON.stringify(results, null, 2));
  console.log(`\n📁 Full report saved to: ${reportPath}`);
}

testStoriesViaAPI().catch(console.error);
