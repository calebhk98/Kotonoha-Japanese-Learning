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

async function test5Stories(): Promise<void> {
  const API_URL = 'http://localhost:3000/api/extract';

  console.log('🧪 Quick test: 5 diverse stories (fast benchmark)\n');
  console.log('Make sure server is running: npm run dev\n');

  // Select 5 diverse stories
  const selectedStories = [
    INITIAL_CONTENT.find(c => c.id === "story-2"), // Tokyo Trip - modern/short
    INITIAL_CONTENT.find(c => c.id === "Momotaro"), // Classic folktale - long/traditional
    INITIAL_CONTENT.find(c => c.id === "OmusubiKororin"), // Folktale - medium
    INITIAL_CONTENT.find(c => c.id === "Urashima-Taro"), // Folktale - complex
    INITIAL_CONTENT.find(c => c.id === "content-12"), // Travel - modern
  ].filter((s): s is (typeof INITIAL_CONTENT[0]) => s !== undefined && s.type === 'story');

  if (selectedStories.length === 0) {
    console.error('❌ Could not find selected stories');
    return;
  }

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
  for (const content of selectedStories) {
    console.log(`📖 Testing: ${content.title}`);
    console.log(`   Characters: ${content.text.length}`);

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

      const bar = '█'.repeat(Math.round(accuracy / 5)) + '░'.repeat(20 - Math.round(accuracy / 5));
      console.log(
        `   [${bar}] ${accuracy.toFixed(1)}% (${wordsWithDefs}/${storyResult.totalWords} words with definitions)\n`
      );
    } catch (error) {
      console.log(`   ❌ Error: ${(error as any).message}\n`);
    }
  }

  // Calculate overall accuracy
  if (results.totalWords > 0) {
    results.overallAccuracy = (results.wordsWithDefinitions / results.totalWords) * 100;
  }
  results.uniqueMissingWords = Array.from(uniqueMissingSet).sort();

  // Print summary
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('📊 SUMMARY (5 Stories Benchmark)');
  console.log('═══════════════════════════════════════════════════════════════\n');
  console.log(`Stories tested: ${results.totalStories}`);
  console.log(`Total words analyzed: ${results.totalWords}`);
  console.log(`Words with definitions: ${results.wordsWithDefinitions}`);
  console.log(`Words missing definitions: ${results.wordsWithoutDefinitions}`);
  console.log(`\n✨ Overall Accuracy: ${results.overallAccuracy.toFixed(1)}%\n`);

  // Print per-story breakdown
  console.log('─────────────────────────────────────────────────────────────');
  console.log('📈 BREAKDOWN BY STORY');
  console.log('─────────────────────────────────────────────────────────────\n');

  results.storyResults.forEach(result => {
    console.log(`${result.title}`);
    console.log(`  Accuracy: ${result.accuracy.toFixed(1)}% (${result.wordsWithDefinitions}/${result.totalWords})`);
    if (result.unknownWords.length > 0) {
      console.log(`  Missing: ${result.unknownWords.slice(0, 5).join(', ')}${result.unknownWords.length > 5 ? '...' : ''}`);
    }
    console.log();
  });

  // Print unique missing words
  if (results.uniqueMissingWords.length > 0) {
    console.log('─────────────────────────────────────────────────────────────');
    console.log('❌ UNIQUE MISSING WORDS');
    console.log('─────────────────────────────────────────────────────────────\n');

    const missing = results.uniqueMissingWords;
    console.log(`Total: ${missing.length} unique words\n`);

    // Group by category
    const katakana = missing.filter(w => /^[ァ-ヴー]+$/.test(w));
    const hiragana = missing.filter(w => /^[ぁ-ん]+$/.test(w));
    const compound = missing.filter(w =>
      w.length > 2 && !katakana.includes(w) && !hiragana.includes(w)
    );

    if (katakana.length > 0) console.log(`🔤 Katakana (${katakana.length}): ${katakana.join(', ')}`);
    if (hiragana.length > 0) console.log(`📝 Hiragana (${hiragana.length}): ${hiragana.join(', ')}`);
    if (compound.length > 0) console.log(`🔗 Compound/Multi-word (${compound.length}): ${compound.join(', ')}`);
  } else {
    console.log('\n✅ All words have definitions!');
  }

  // Save results
  const reportPath = `tokenization-report-5stories-${Date.now()}.json`;
  fs.writeFileSync(reportPath, JSON.stringify(results, null, 2));
  console.log(`\n📁 Report saved to: ${reportPath}`);
}

test5Stories().catch(console.error);
