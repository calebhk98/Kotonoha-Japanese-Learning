#!/usr/bin/env npx tsx

/**
 * List ALL unique tokens that are being filtered out.
 * Simple output showing complete list.
 */

import { createTokenizer } from '../src/lib/tokenizers';
import { getStories } from '../src/data/content';

async function listFiltered() {
  console.log('\n🚫 ALL FILTERED TOKENS ACROSS ALL STORIES\n');

  const tokenizer = await createTokenizer('sudachi-wasm');
  const stories = getStories();

  // Filter definitions (same as test)
  const particles = new Set(['は', 'が', 'を', 'に', 'へ', 'と', 'で', 'も', 'か', 'の', 'て', 'な', 'だ']);
  const isPunctuation = (s: string) => /[、。！？・「」『』（）()[\]a-zA-Z0-9\s]/.test(s);
  const isSingleKana = (s: string) => s.length === 1 && (particles.has(s) || /[ぁ-ん]/.test(s));

  const filteredTokens = new Map<string, { count: number; type: string }>();

  console.log(`Processing ${stories.length} stories...`);

  for (const story of stories) {
    process.stdout.write('.');
    const tokens = await tokenizer.segment(story.text);

    for (const token of tokens) {
      const surface = token.surface;

      let type = '';
      if (surface.trim() === '') {
        type = 'whitespace';
      } else if (particles.has(surface)) {
        type = 'particle';
      } else if (isPunctuation(surface)) {
        type = 'punctuation';
      } else if (isSingleKana(surface)) {
        type = 'single-kana';
      } else {
        continue; // Not filtered
      }

      if (!filteredTokens.has(surface)) {
        filteredTokens.set(surface, { count: 0, type });
      }

      const entry = filteredTokens.get(surface)!;
      entry.count++;
    }
  }

  console.log(`\n\n📊 TOTAL UNIQUE FILTERED TOKENS: ${filteredTokens.size}\n`);
  console.log('='.repeat(70));

  // Group by type
  const byType = {
    particle: [] as [string, number][],
    'single-kana': [] as [string, number][],
    punctuation: [] as [string, number][],
    whitespace: [] as [string, number][],
  };

  for (const [token, data] of filteredTokens) {
    byType[data.type as keyof typeof byType].push([token, data.count]);
  }

  // Sort each by count
  for (const key of Object.keys(byType)) {
    byType[key as keyof typeof byType].sort((a, b) => b[1] - a[1]);
  }

  // Print particles
  console.log(`\n📍 PARTICLES (${byType.particle.length}):`);
  console.log('-'.repeat(70));
  byType.particle.forEach(([token, count]) => {
    console.log(`  "${token}" — ${count}x`);
  });

  // Print single kana
  console.log(`\n🔤 SINGLE KANA (${byType['single-kana'].length}):`);
  console.log('-'.repeat(70));
  byType['single-kana'].forEach(([token, count]) => {
    console.log(`  "${token}" — ${count}x`);
  });

  // Print punctuation
  console.log(`\n📌 PUNCTUATION (${byType.punctuation.length}):`);
  console.log('-'.repeat(70));
  byType.punctuation.forEach(([token, count]) => {
    console.log(`  "${token}" — ${count}x`);
  });

  // Print whitespace
  if (byType.whitespace.length > 0) {
    console.log(`\n⚪ WHITESPACE (${byType.whitespace.length}):`);
    console.log('-'.repeat(70));
    byType.whitespace.forEach(([token, count]) => {
      console.log(`  (space/newline) — ${count}x`);
    });
  }

  console.log('\n');
}

listFiltered().catch(console.error);
