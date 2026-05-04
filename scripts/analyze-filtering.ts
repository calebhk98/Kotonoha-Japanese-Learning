#!/usr/bin/env npx tsx

/**
 * Analyze what tokens are being filtered out across all stories.
 * Shows unfiltered vs filtered token counts and lists filtered tokens.
 *
 * Usage: npx tsx scripts/analyze-filtering.ts
 */

import { createTokenizer } from '../src/lib/tokenizers';
import { getStories } from '../src/data/content';

interface FilterStats {
  story: string;
  totalTokens: number;
  filteredOut: number;
  kept: number;
  filterPercentage: number;
}

async function analyzeFiltering() {
  console.log('\n📊 ANALYZING TOKEN FILTERING ACROSS ALL STORIES\n');
  console.log('='.repeat(70));

  const tokenizer = await createTokenizer('sudachi-wasm');
  const stories = getStories();

  // Filter definitions (same as test)
  const particles = new Set(['は', 'が', 'を', 'に', 'へ', 'と', 'で', 'も', 'か', 'の', 'て', 'な', 'だ']);
  const isPunctuation = (s: string) => /[、。！？・「」『』（）()[\]a-zA-Z0-9\s]/.test(s);
  const isSingleKana = (s: string) => s.length === 1 && (particles.has(s) || /[ぁ-ん]/.test(s));

  const stats: FilterStats[] = [];
  const filteredTokens = new Map<string, number>();
  let grandTotalTokens = 0;
  let grandTotalFiltered = 0;
  let grandTotalKept = 0;

  console.log(`Processing ${stories.length} stories...\n`);

  for (const story of stories) {
    process.stdout.write('.');
    const tokens = await tokenizer.segment(story.text);

    let kept = 0;
    let filtered = 0;

    for (const token of tokens) {
      const surface = token.surface;
      if (surface.trim() === '' || isPunctuation(surface) || isSingleKana(surface)) {
        filtered++;
        filteredTokens.set(surface, (filteredTokens.get(surface) || 0) + 1);
      } else {
        kept++;
      }
    }

    const total = tokens.length;
    const filterPercentage = (filtered / total) * 100;

    stats.push({
      story: story.title,
      totalTokens: total,
      filteredOut: filtered,
      kept: kept,
      filterPercentage,
    });

    grandTotalTokens += total;
    grandTotalFiltered += filtered;
    grandTotalKept += kept;
  }

  console.log('\n\n');

  // Overall statistics
  const overallFilterPercentage = (grandTotalFiltered / grandTotalTokens) * 100;

  console.log('═'.repeat(70));
  console.log('📈 OVERALL STATISTICS');
  console.log('═'.repeat(70));
  console.log(`Total tokens across all stories: ${grandTotalTokens.toLocaleString()}`);
  console.log(`Tokens filtered out: ${grandTotalFiltered.toLocaleString()} (${overallFilterPercentage.toFixed(2)}%)`);
  console.log(`Tokens kept for lookup: ${grandTotalKept.toLocaleString()} (${(100 - overallFilterPercentage).toFixed(2)}%)\n`);

  // Stories with highest filter percentage
  console.log('───────────────────────────────────────────────────────────────');
  console.log('📝 STORIES WITH HIGHEST FILTER %:');
  console.log('───────────────────────────────────────────────────────────────\n');

  stats.sort((a, b) => b.filterPercentage - a.filterPercentage);
  stats.slice(0, 10).forEach((s, i) => {
    console.log(
      `${i + 1}. ${s.story.substring(0, 45).padEnd(45)} ${s.filterPercentage.toFixed(1)}% (${s.filteredOut}/${s.totalTokens})`
    );
  });

  // Filtered tokens breakdown
  console.log('\n───────────────────────────────────────────────────────────────');
  console.log(`🚫 FILTERED TOKENS (${filteredTokens.size} unique types):`);
  console.log('───────────────────────────────────────────────────────────────\n');

  // Categorize filtered tokens
  const categorized = {
    particles: new Map<string, number>(),
    punctuation: new Map<string, number>(),
    singleKana: new Map<string, number>(),
    whitespace: new Map<string, number>(),
  };

  for (const [token, count] of filteredTokens) {
    if (token.trim() === '') {
      categorized.whitespace.set(token, count);
    } else if (particles.has(token)) {
      categorized.particles.set(token, count);
    } else if (isPunctuation(token)) {
      categorized.punctuation.set(token, count);
    } else if (isSingleKana.length === 1) {
      categorized.singleKana.set(token, count);
    }
  }

  // Show each category
  console.log('📍 PARTICLES:');
  const sortedParticles = Array.from(categorized.particles.entries()).sort((a, b) => b[1] - a[1]);
  if (sortedParticles.length > 0) {
    sortedParticles.forEach(([token, count]) => {
      console.log(`  • "${token}" — ${count} times`);
    });
  } else {
    console.log('  (none)');
  }

  console.log('\n📌 PUNCTUATION:');
  const sortedPunctuation = Array.from(categorized.punctuation.entries()).sort((a, b) => b[1] - a[1]);
  if (sortedPunctuation.length > 0) {
    sortedPunctuation.forEach(([token, count]) => {
      console.log(`  • "${token}" — ${count} times`);
    });
  } else {
    console.log('  (none)');
  }

  console.log('\n🔤 SINGLE KANA:');
  const sortedSingleKana = Array.from(categorized.singleKana.entries()).sort((a, b) => b[1] - a[1]);
  if (sortedSingleKana.length > 0) {
    sortedSingleKana.slice(0, 10).forEach(([token, count]) => {
      console.log(`  • "${token}" — ${count} times`);
    });
    if (sortedSingleKana.length > 10) {
      console.log(`  ... and ${sortedSingleKana.length - 10} more`);
    }
  } else {
    console.log('  (none)');
  }

  console.log('\n⚪ WHITESPACE:');
  if (categorized.whitespace.size > 0) {
    console.log(`  • (whitespace) — ${categorized.whitespace.get('') || 0} times`);
  } else {
    console.log('  (none)');
  }

  // Health check
  console.log('\n═'.repeat(70));
  console.log('✅ FILTERING HEALTH CHECK');
  console.log('═'.repeat(70));

  if (overallFilterPercentage > 50) {
    console.log(
      `⚠️  WARNING: ${overallFilterPercentage.toFixed(1)}% of tokens are being filtered. This seems high!`
    );
  } else if (overallFilterPercentage > 35) {
    console.log(`✓ Filtering ${overallFilterPercentage.toFixed(1)}% is reasonable for Japanese.`);
  } else {
    console.log(`✓ Filtering ${overallFilterPercentage.toFixed(1)}% is good - not too aggressive.`);
  }

  console.log(`✓ Keeping ${(100 - overallFilterPercentage).toFixed(1)}% for dictionary lookup.\n`);
}

analyzeFiltering().catch(console.error);
