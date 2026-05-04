#!/usr/bin/env npx tsx

/**
 * Analyze tokenization and dictionary lookups for a specific story.
 * Usage: npx tsx scripts/analyze-story.ts --story "art-class"
 */

import { createTokenizer } from '../src/lib/tokenizers';
import { DictionaryManager } from '../src/lib/dictionary';
import { getStories } from '../src/data/content';
import path from 'path';
import fs from 'fs';

interface AnalysisEntry {
  surface: string;
  baseForm: string;
  hasDefinition: boolean;
  definition?: string;
}

async function analyzeStory(storyName: string) {
  const stories = getStories();
  const story = stories.find(s => s.title.toLowerCase().includes(storyName.toLowerCase()));

  if (!story) {
    console.error(`❌ Story not found: ${storyName}`);
    console.log(`\nAvailable stories:`);
    stories.slice(0, 10).forEach(s => console.log(`  - ${s.title}`));
    process.exit(1);
  }

  console.log(`\n📖 Analyzing: ${story.title}\n`);
  console.log(`${'='.repeat(70)}`);

  const tokenizer = await createTokenizer('sudachi-wasm');
  const dictionary = new DictionaryManager();

  const jmdictFile = path.join(process.cwd(), 'jmdict-all-3.6.2.json');
  if (fs.existsSync(jmdictFile)) {
    await dictionary.initialize('jmdict', path.join(process.cwd(), 'jmdict-db'), jmdictFile);
  } else {
    await dictionary.initialize('jisho');
  }

  // Tokenize
  const tokens = await tokenizer.segment(story.text);

  // Filter out particles and punctuation (same as test)
  const particles = new Set(['は', 'が', 'を', 'に', 'へ', 'と', 'で', 'も', 'か', 'の', 'て', 'な', 'だ']);
  const isPunctuation = (s: string) => /[、。！？・「」『』（）()[\]a-zA-Z0-9\s]/.test(s);
  const isSingleKana = (s: string) => s.length === 1 && (particles.has(s) || /[ぁ-ん]/.test(s));

  const analysis: AnalysisEntry[] = [];
  const missingWords = new Map<string, number>();

  for (const token of tokens) {
    const surface = token.surface;
    if (surface.trim() === '' || isPunctuation(surface) || isSingleKana(surface)) {
      continue;
    }

    let def = await dictionary.lookup(token.baseForm);
    if (!def) {
      def = await dictionary.lookup(surface);
    }

    analysis.push({
      surface,
      baseForm: token.baseForm,
      hasDefinition: !!def,
      definition: def ? (Array.isArray(def) ? def[0] : def) : undefined,
    });

    if (!def) {
      missingWords.set(token.baseForm, (missingWords.get(token.baseForm) || 0) + 1);
    }
  }

  // Statistics
  const withDef = analysis.filter(a => a.hasDefinition).length;
  const missingDef = analysis.filter(a => !a.hasDefinition).length;
  const accuracy = (withDef / analysis.length) * 100;

  console.log(`\n📊 STATISTICS`);
  console.log(`${'='.repeat(70)}`);
  console.log(`Total words (filtered): ${analysis.length}`);
  console.log(`Words with definitions: ${withDef}`);
  console.log(`Words missing definitions: ${missingDef}`);
  console.log(`Accuracy: ${accuracy.toFixed(2)}%\n`);

  // Show missing words
  if (missingWords.size > 0) {
    console.log(`❌ MISSING WORDS (${missingWords.size} unique)`);
    console.log(`${'='.repeat(70)}\n`);

    const sorted = Array.from(missingWords.entries()).sort((a, b) => b[1] - a[1]);

    for (const [word, count] of sorted) {
      // Find examples
      const examples = analysis.filter(a => a.baseForm === word);
      const surfaces = examples.map(e => e.surface);
      const uniqueSurfaces = [...new Set(surfaces)].slice(0, 3);

      console.log(`Word: "${word}" (appears ${count}x)`);
      console.log(`  Surfaces: ${uniqueSurfaces.join(', ')}`);
      console.log(`  Type: ${categorizeWord(word)}`);
      console.log();
    }
  }

  // Show sample words with definitions
  console.log(`✅ SAMPLE WORDS WITH DEFINITIONS`);
  console.log(`${'='.repeat(70)}\n`);

  const withDefinitions = analysis.filter(a => a.hasDefinition);
  withDefinitions.slice(0, 15).forEach(entry => {
    console.log(`"${entry.surface}" → "${entry.baseForm}"`);
    console.log(`  Definition: ${entry.definition || 'N/A'}\n`);
  });
}

function categorizeWord(word: string): string {
  // Onomatopoeia patterns
  if (/[あ-ん]{2,}/.test(word) && word.match(/([あ-ん])\1/)) {
    return '🔊 Onomatopoeia (repetition)';
  }

  // Check if it's hiragana only (might be verb/adjective stem)
  if (/^[あ-ん]+$/.test(word)) {
    // Common verb/adjective endings
    if (word.endsWith('う') || word.endsWith('る') || word.endsWith('い')) {
      return '📝 Likely verb/adjective stem';
    }
    return '📝 Hiragana-only word';
  }

  // Has kanji
  if (/[一-龯]/.test(word)) {
    return '🔤 Kanji compound';
  }

  return '❓ Unknown type';
}

const args = process.argv.slice(2);
const storyArg = args.find(arg => arg.startsWith('--story=') || (arg === '--story' && args[args.indexOf(arg) + 1]))
  ?.split('=')[1] ||
  args[args.indexOf('--story') + 1] ||
  'art-class';

analyzeStory(storyArg).catch(console.error);
