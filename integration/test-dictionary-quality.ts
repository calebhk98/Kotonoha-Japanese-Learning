/**
 * Dictionary Quality Integration Tests (#191)
 *
 * Tests the full pipeline against the real JMDict and Sudachi tokenizer to catch
 * the concrete issues identified in GitHub issues #186, #187, #188, #189.
 *
 * Run:  npx tsx tests/test-dictionary-quality.ts
 *
 * Requirements:
 *   - jmdict-all-3.6.2.json.tgz must be present (auto-extracted by this script)
 *   - sudachi-wasm-built/ must be present (built by npm install / npm run setup-sudachi)
 *
 * Each test section prints PASS / FAIL with the actual result so you can re-run
 * before and after a fix to confirm the fix works.
 */

import path from 'path';
import fs from 'fs';
import * as tar from 'tar';
import { fileURLToPath } from 'url';
import { JmdictDictionary } from '../src/lib/dictionary.js';
import { createTokenizer } from '../src/lib/tokenizers.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let passed = 0;
let failed = 0;

function assert(label: string, condition: boolean, detail?: string) {
  if (condition) {
    console.log(`  ✅ PASS  ${label}`);
    passed++;
  } else {
    console.log(`  ❌ FAIL  ${label}${detail ? `\n         → ${detail}` : ''}`);
    failed++;
  }
}

function assertContains(label: string, value: string, expected: string) {
  assert(label, value.toLowerCase().includes(expected.toLowerCase()),
    `got "${value}", expected it to contain "${expected}"`);
}

function assertNotContains(label: string, value: string, unexpected: string) {
  assert(label, !value.toLowerCase().includes(unexpected.toLowerCase()),
    `got "${value}", but it should NOT contain "${unexpected}"`);
}

function section(title: string) {
  console.log(`\n${'─'.repeat(70)}`);
  console.log(`  ${title}`);
  console.log('─'.repeat(70));
}

// ---------------------------------------------------------------------------
// Setup: extract JMDict if needed
// ---------------------------------------------------------------------------

async function ensureJmdict(): Promise<boolean> {
  const jsonFile = path.join(ROOT, 'jmdict-all-3.6.2.json');
  const tgzFile  = path.join(ROOT, 'jmdict-all-3.6.2.json.tgz');

  if (fs.existsSync(jsonFile)) return true;

  if (!fs.existsSync(tgzFile)) {
    console.warn('[Setup] jmdict-all-3.6.2.json.tgz not found — skipping JMDict tests');
    return false;
  }

  console.log('[Setup] Extracting JMDict (this takes ~10 s the first time)…');
  await tar.extract({ file: tgzFile, cwd: ROOT });
  console.log('[Setup] JMDict extracted');
  return true;
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

async function runTests() {
  console.log('='.repeat(70));
  console.log('  Dictionary Quality Tests  (issues #186, #187, #188, #189, #191)');
  console.log('='.repeat(70));

  const jmdictAvailable = await ensureJmdict();

  // -------------------------------------------------------------------------
  // 1. JMDict – #186: No non-English definitions should leak through
  // -------------------------------------------------------------------------
  section('#186 — JMDict lookup returns only English definitions');

  if (!jmdictAvailable) {
    console.log('  ⚠️  SKIP (JMDict not available)');
  } else {
    const jmdict = new JmdictDictionary();
    await jmdict.initialize(path.join(ROOT, 'jmdict-db'), path.join(ROOT, 'jmdict-all-3.6.2.json'));

    if (!jmdict.isInitialized()) {
      console.log('  ⚠️  SKIP (JMDict failed to initialize)');
    } else {
      // Words that have non-English senses in JMDict alongside English ones.
      // Before the fix the fallback `else if (sense.gloss[0]?.text)` could
      // return German / Spanish text for senses with no English glosses.
      const wordsToCheck = ['猫', '桜', '犬', '水', '食べる', 'です', '走る'];

      for (const word of wordsToCheck) {
        const result = await jmdict.lookup(word);
        if (!result) {
          console.log(`  ⚠️  SKIP "${word}" (not found in JMDict)`);
          continue;
        }

        const allDefs = [result.meaning, ...(result.meanings || [])].join(' | ');

        // Spot-check: German words from JMDict ger-lang entries
        assertNotContains(`"${word}" meaning not in German`, allDefs, 'die ');
        assertNotContains(`"${word}" meaning not in Spanish (no "el " prefix)`, allDefs, ' el ');

        // All glosses should be recognisably Latin-script English, not e.g. Japanese
        const hasNonAsciiNonJapanese = /[À-ÿ]/.test(allDefs); // accented Latin chars common in European langs
        assert(`"${word}" definitions use plain ASCII/English characters`, !hasNonAsciiNonJapanese,
          `definitions contain non-ASCII Latin chars: "${allDefs}"`);
      }
    }
  }

  // -------------------------------------------------------------------------
  // 2. JMDict – #187: Common words get their common meaning first
  // -------------------------------------------------------------------------
  section('#187 — Common words return everyday meaning, not rare/slang/archaic');

  if (!jmdictAvailable) {
    console.log('  ⚠️  SKIP (JMDict not available)');
  } else {
    const jmdict = new JmdictDictionary();
    await jmdict.initialize(path.join(ROOT, 'jmdict-db'), path.join(ROOT, 'jmdict-all-3.6.2.json'));

    if (!jmdict.isInitialized()) {
      console.log('  ⚠️  SKIP (JMDict failed to initialize)');
    } else {
      // 猫 (neko) – should be "cat", NOT "submissive partner" (misc:['sl'])
      const neko = await jmdict.lookup('猫');
      assert('猫 (neko) is found', !!neko, 'not found in JMDict');
      if (neko) {
        assertContains('猫 primary meaning contains "cat"', neko.meaning, 'cat');
        assertNotContains('猫 primary meaning is not the slang sense', neko.meaning, 'submissive');
      }

      // 桜 (sakura) – should be "cherry blossom", NOT "hired applauder" (misc:['arch'])
      const sakura = await jmdict.lookup('桜');
      assert('桜 (sakura) is found', !!sakura, 'not found in JMDict');
      if (sakura) {
        assertContains('桜 primary meaning contains "cherry"', sakura.meaning, 'cherry');
        assertNotContains('桜 primary meaning is not the archaic sense', sakura.meaning, 'applaud');
      }

      // 可愛い (kawaii) – "cute/adorable" should beat "dainty/tiny"
      const kawaii = await jmdict.lookup('可愛い');
      assert('可愛い (kawaii) is found', !!kawaii, 'not found in JMDict');
      if (kawaii) {
        // "cute" should appear somewhere in the first few meanings
        const topMeanings = (kawaii.meanings || [kawaii.meaning]).slice(0, 4).join(' ').toLowerCase();
        assert('可愛い top meanings include "cute" or "adorable"',
          topMeanings.includes('cute') || topMeanings.includes('adorable'),
          `top meanings: "${topMeanings}"`);
        // Primary meaning should NOT be "dainty" or "tiny" (those were the wrong results)
        assertNotContains('可愛い primary meaning is not "dainty"', kawaii.meaning, 'dainty');
      }

      // 犬 (inu) – should be "dog"
      const inu = await jmdict.lookup('犬');
      assert('犬 (inu) is found', !!inu, 'not found in JMDict');
      if (inu) {
        assertContains('犬 primary meaning contains "dog"', inu.meaning, 'dog');
      }
    }
  }

  // -------------------------------------------------------------------------
  // 3. JMDict – #188: Common grammar words (です, ます, etc.) are found
  //
  // Before the fix, /api/word/:word only used getCachedDictionaryEntries (kanji-data)
  // and never called the dictionary for kana-only words. This is tested here at
  // the JMDict layer; the full API consistency fix is in server.ts.
  // -------------------------------------------------------------------------
  section('#188 — Grammar words (kana-only) are found in JMDict');

  if (!jmdictAvailable) {
    console.log('  ⚠️  SKIP (JMDict not available)');
  } else {
    const jmdict = new JmdictDictionary();
    await jmdict.initialize(path.join(ROOT, 'jmdict-db'), path.join(ROOT, 'jmdict-all-3.6.2.json'));

    if (!jmdict.isInitialized()) {
      console.log('  ⚠️  SKIP (JMDict failed to initialize)');
    } else {
      const grammarWords: [string, string][] = [
        ['です', 'be'],          // copula – should find "to be" or "is/are"
        ['ます', 'polite'],      // polite form marker
        ['ない', 'not'],         // negative auxiliary
        ['ている', 'progressive'], // te-iru progressive
        ['から', 'from'],        // particle / conjunction
        ['ので', 'because'],     // reason conjunction
      ];

      for (const [word, hint] of grammarWords) {
        const result = await jmdict.lookup(word);
        assert(`"${word}" is found in JMDict`, !!result,
          'not found — this is the root cause of "Unknown meaning" on the word detail page');
        if (result) {
          const allText = [result.meaning, ...(result.meanings || [])].join(' ').toLowerCase();
          assert(`"${word}" definition mentions "${hint}"`,
            allText.includes(hint),
            `got "${result.meaning}"`);
        }
      }
    }
  }

  // -------------------------------------------------------------------------
  // 4. Tokenizer – #189: Sudachi splits sentences and provides base forms
  //
  // This section tokenizes real Japanese sentences and checks:
  //   a) The sentence is split into recognisable morphemes
  //   b) baseForm is the dictionary/citation form (not the conjugated surface)
  //
  // We do NOT assert that dictionary lookup succeeds for conjugated forms here —
  // that depends on whether Sudachi mode C, B, or A is used (see issue #189).
  // Instead we print the tokenization output so you can compare modes visually.
  // -------------------------------------------------------------------------
  section('#189 — Tokenizer produces baseForm for conjugated verbs');

  let tokenizer: any = null;
  try {
    tokenizer = await createTokenizer('sudachi-wasm');
    console.log(`  Tokenizer: ${tokenizer.name}`);
  } catch (e) {
    console.log(`  ⚠️  SKIP (Sudachi WASM not available: ${(e as Error).message})`);
  }

  if (tokenizer) {
    // Sentence: "猫が寝ています。" (The cat is sleeping.)
    const sentence1 = '猫が寝ています。';
    const tokens1 = await tokenizer.segment(sentence1);
    console.log(`\n  Input: "${sentence1}"`);
    console.log('  Tokens:');
    for (const t of tokens1) {
      const baseDiff = t.baseForm !== t.surface ? ` → baseForm: "${t.baseForm}"` : '';
      console.log(`    "${t.surface}"${baseDiff}`);
    }

    // We expect to find 猫 and some form of 寝る
    const surfaces = tokens1.map((t: any) => t.surface);
    const baseForms = tokens1.map((t: any) => t.baseForm);
    assert('sentence 1 contains 猫', surfaces.includes('猫'), `tokens: ${surfaces.join(', ')}`);
    // baseForm of the verb token containing 寝 should be 寝る
    const hasNeruBase = baseForms.some((b: string) => b === '寝る' || b.includes('寝'));
    assert('sentence 1 has a token with baseForm containing 寝る',
      hasNeruBase, `baseForms: ${baseForms.join(', ')}`);

    // Sentence: "田中さんは東京に住んでいます。" (Mr. Tanaka lives in Tokyo.)
    const sentence2 = '田中さんは東京に住んでいます。';
    const tokens2 = await tokenizer.segment(sentence2);
    console.log(`\n  Input: "${sentence2}"`);
    console.log('  Tokens:');
    for (const t of tokens2) {
      const baseDiff = t.baseForm !== t.surface ? ` → baseForm: "${t.baseForm}"` : '';
      console.log(`    "${t.surface}"${baseDiff}`);
    }
    const baseForms2 = tokens2.map((t: any) => t.baseForm);
    const hasSumuBase = baseForms2.some((b: string) => b === '住む' || b.includes('住'));
    assert('sentence 2 has a token with baseForm containing 住む',
      hasSumuBase, `baseForms: ${baseForms2.join(', ')}`);

    // Sentence: "可愛い猫が好きです。" (I like cute cats.)
    const sentence3 = '可愛い猫が好きです。';
    const tokens3 = await tokenizer.segment(sentence3);
    console.log(`\n  Input: "${sentence3}"`);
    console.log('  Tokens:');
    for (const t of tokens3) {
      const baseDiff = t.baseForm !== t.surface ? ` → baseForm: "${t.baseForm}"` : '';
      console.log(`    "${t.surface}"${baseDiff}`);
    }
    const surfaces3 = tokens3.map((t: any) => t.surface);
    assert('sentence 3 contains 猫', surfaces3.includes('猫'),
      `tokens: ${surfaces3.join(', ')}`);
  }

  // -------------------------------------------------------------------------
  // 5. Tokenizer – Sudachi mode comparison (see issue #189)
  //
  // Shows mode A, B, C output side by side for the same sentence so we can
  // evaluate the tradeoff before deciding whether to change the default mode.
  // -------------------------------------------------------------------------
  section('#189 — Sudachi mode A vs B vs C comparison (informational)');

  if (!tokenizer) {
    console.log('  ⚠️  SKIP (Sudachi WASM not available)');
  } else {
    const testSentence = '猫が寝ています。田中さんは走りました。';
    console.log(`\n  Sentence: "${testSentence}"\n`);

    for (const mode of ['A', 'B', 'C'] as const) {
      try {
        const morphemes = (tokenizer as any).tokenizer?.run(testSentence, mode);
        if (!morphemes) { console.log(`  Mode ${mode}: tokenizer.run() returned null`); continue; }

        const tokens = morphemes
          .filter((m: any) => m.part_of_speech[0] !== '補助記号' && !/^\s+$/.test(m.surface))
          .map((m: any) => ({
            surface: m.surface,
            base: m.normalized_form || m.surface,
          }));

        const tokenStr = tokens.map((t: any) =>
          t.base !== t.surface ? `${t.surface}(→${t.base})` : t.surface
        ).join(' | ');

        console.log(`  Mode ${mode}: ${tokenStr}`);
      } catch (e) {
        console.log(`  Mode ${mode}: ERROR — ${(e as Error).message}`);
      }
    }

    console.log(`
  Notes for #189:
    Mode C (current default): groups verb stems + auxiliaries into one token.
      Pro: "寝ています" as one unit is readable / hover-tooltip friendly.
      Con: "寝ています" is not in the dictionary; base form lookup fails.
    Mode A: maximum granularity. Each morpheme is separate with its own base form.
      Pro: every token can be looked up individually.
      Con: beginners see "て" and "い" and "ます" as separate "words" to hover.
    Mode B: intermediate. Worth testing.
  Decision: do NOT change the default mode yet; evaluate after seeing the output above.
`);
  }

  // -------------------------------------------------------------------------
  // Summary
  // -------------------------------------------------------------------------
  console.log('='.repeat(70));
  const total = passed + failed;
  console.log(`  Results: ${passed}/${total} passed, ${failed} failed`);
  console.log('='.repeat(70));

  if (failed > 0) process.exit(1);
}

runTests().catch((e) => {
  console.error('Test runner error:', e);
  process.exit(1);
});
