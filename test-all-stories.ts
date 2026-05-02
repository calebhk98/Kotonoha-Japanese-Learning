import { INITIAL_CONTENT } from './src/data/content';
import { createTokenizer } from './src/lib/tokenizers';
import { DictionaryManager } from './src/lib/dictionary';
import path from 'path';
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
  uniqueMissingWords: Set<string>;
  storyResults: StoryResult[];
  timestamp: string;
}

async function runTokenizationTest(): Promise<void> {
  console.log('🧪 Starting comprehensive tokenization test across all stories...\n');

  // Initialize tokenizer and dictionary
  const tokenizer = await createTokenizer();
  const dictionary = new DictionaryManager();
  const jmdictPath = path.join(process.cwd(), 'jmdict-db');
  const jmdictFile = path.join(process.cwd(), 'jmdict-all-3.6.2.json');

  if (fs.existsSync(jmdictFile)) {
    await dictionary.initialize('jmdict', jmdictPath, jmdictFile);
  } else {
    await dictionary.initialize('jisho');
  }

  const results: AggregateResults = {
    totalStories: 0,
    totalWords: 0,
    wordsWithDefinitions: 0,
    wordsWithoutDefinitions: 0,
    overallAccuracy: 0,
    uniqueMissingWords: new Set(),
    storyResults: [],
    timestamp: new Date().toISOString(),
  };

  // Process each story
  for (const content of INITIAL_CONTENT) {
    if (content.type !== 'story') continue;

    console.log(`📖 Processing: ${content.title}`);
    console.log(`   Text length: ${content.text.length} characters`);

    // Tokenize the text
    const tokens = await tokenizer.segment(content.text);

    // Filter out particles and punctuation
    const particles = new Set(['は', 'が', 'を', 'に', 'へ', 'と', 'で', 'も', 'か', 'の', 'て', 'な', 'だ']);
    const isPunctuation = (s: string) => /[、。！？・「」『』（）()[\]a-zA-Z0-9\s]/.test(s);
    const isSingleKana = (s: string) => s.length === 1 && (particles.has(s) || /[ぁ-ん]/.test(s));

    const validWords = new Map<string, string>(); // Map surface form to baseForm
    for (const token of tokens) {
      const surface = token.surface;
      if (surface.trim() === '' || isPunctuation(surface) || isSingleKana(surface)) continue;
      validWords.set(surface, token.baseForm);
    }

    // Look up each word in dictionary
    let wordsWithDefs = 0;
    let wordsWithoutDefs = 0;
    const unknownWords: string[] = [];

    for (const [wordStr, baseForm] of validWords) {
      // Try baseForm first, then surface form
      let entries = await dictionary.lookup(baseForm);
      if (!entries) {
        entries = await dictionary.lookup(wordStr);
      }

      if (entries) {
        wordsWithDefs++;
      } else {
        wordsWithoutDefs++;
        unknownWords.push(wordStr);
        results.uniqueMissingWords.add(wordStr);
      }
    }

    const accuracy = (wordsWithDefs / (wordsWithDefs + wordsWithoutDefs)) * 100;
    const storyResult: StoryResult = {
      id: content.id,
      title: content.title,
      totalWords: wordsWithDefs + wordsWithoutDefs,
      wordsWithDefinitions: wordsWithDefs,
      wordsWithoutDefinitions: wordsWithoutDefs,
      accuracy,
      unknownWords: [...new Set(unknownWords)], // Unique only
    };

    results.storyResults.push(storyResult);
    results.totalStories++;
    results.totalWords += storyResult.totalWords;
    results.wordsWithDefinitions += wordsWithDefs;
    results.wordsWithoutDefinitions += wordsWithoutDefs;

    console.log(`   ✓ Words: ${storyResult.totalWords} total | ${wordsWithDefs} with definitions | ${wordsWithoutDefs} missing`);
    console.log(`   ✓ Accuracy: ${accuracy.toFixed(1)}%\n`);
  }

  // Calculate overall accuracy
  if (results.totalWords > 0) {
    results.overallAccuracy = (results.wordsWithDefinitions / results.totalWords) * 100;
  }

  // Print summary
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('📊 OVERALL RESULTS');
  console.log('═══════════════════════════════════════════════════════════════\n');
  console.log(`Stories tested: ${results.totalStories}`);
  console.log(`Total words: ${results.totalWords}`);
  console.log(`Words with definitions: ${results.wordsWithDefinitions}`);
  console.log(`Words missing definitions: ${results.wordsWithoutDefinitions}`);
  console.log(`\n✨ Overall Accuracy: ${results.overallAccuracy.toFixed(1)}%\n`);

  // Print per-story results
  console.log('─────────────────────────────────────────────────────────────');
  console.log('📈 RESULTS BY STORY');
  console.log('─────────────────────────────────────────────────────────────\n');

  results.storyResults
    .sort((a, b) => a.accuracy - b.accuracy) // Sort by accuracy ascending
    .forEach((result) => {
      const bar = '█'.repeat(Math.round(result.accuracy / 5)) + '░'.repeat(20 - Math.round(result.accuracy / 5));
      console.log(`${result.title}`);
      console.log(`  [${bar}] ${result.accuracy.toFixed(1)}% (${result.wordsWithDefinitions}/${result.totalWords})`);
    });

  // Print unique missing words
  console.log('\n─────────────────────────────────────────────────────────────');
  console.log('❌ UNIQUE WORDS WITHOUT DEFINITIONS');
  console.log('─────────────────────────────────────────────────────────────\n');

  const sortedMissing = Array.from(results.uniqueMissingWords).sort();
  if (sortedMissing.length === 0) {
    console.log('✅ All words have definitions!');
  } else {
    console.log(`Total unique missing words: ${sortedMissing.length}\n`);

    // Group by category
    const katakana = sortedMissing.filter(w => /^[ァ-ヴー]+$/.test(w));
    const hiragana = sortedMissing.filter(w => /^[ぁ-ん]+$/.test(w));
    const kanji = sortedMissing.filter(w => /[漢字一-龠々]/.test(w));
    const compound = sortedMissing.filter(w =>
      w.length > 2 && !katakana.includes(w) && !hiragana.includes(w) && !kanji.includes(w)
    );
    const other = sortedMissing.filter(w =>
      !katakana.includes(w) && !hiragana.includes(w) && !kanji.includes(w) && !compound.includes(w)
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
    if (other.length > 0) {
      console.log(`❓ Other (${other.length}): ${other.slice(0, 10).join(', ')}${other.length > 10 ? '...' : ''}`);
    }

    console.log('\n📋 Complete list:');
    sortedMissing.forEach(word => console.log(`  - ${word}`));
  }

  // Save results to file
  const reportPath = path.join(process.cwd(), `tokenization-report-${Date.now()}.json`);
  const reportData = {
    ...results,
    uniqueMissingWords: Array.from(results.uniqueMissingWords),
  };
  fs.writeFileSync(reportPath, JSON.stringify(reportData, null, 2));
  console.log(`\n📁 Full report saved to: ${reportPath}`);
}

runTokenizationTest().catch(console.error);
