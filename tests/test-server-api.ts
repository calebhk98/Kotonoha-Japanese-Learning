/**
 * Server API Integration Tests
 *
 * Tests the real Express server endpoints against the 10 known failure cases
 * identified in the GitHub issues. Run after starting the server:
 *
 *   npm run dev   (in a separate terminal)
 *   npx tsx tests/test-server-api.ts
 *
 * Each test prints PASS / FAIL with the actual result received from the server.
 */

import { execSync } from 'child_process';

const SERVER_URL = process.env.SERVER_URL || 'http://localhost:3000';

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
  assert(
    label,
    value.toLowerCase().includes(expected.toLowerCase()),
    `got "${value}", expected it to contain "${expected}"`
  );
}

function assertNotContains(label: string, value: string, unexpected: string) {
  assert(
    label,
    !value.toLowerCase().includes(unexpected.toLowerCase()),
    `got "${value}", but it should NOT contain "${unexpected}"`
  );
}

function section(title: string) {
  console.log(`\n${'─'.repeat(70)}`);
  console.log(`  ${title}`);
  console.log('─'.repeat(70));
}

function curlPost(path: string, body: Record<string, string>): any {
  const bodyJson = JSON.stringify(body).replace(/'/g, "'\\''");
  const cmd = `curl -sf --max-time 30 -X POST '${SERVER_URL}${path}' -H 'Content-Type: application/json' -d '${bodyJson}'`;
  try {
    const out = execSync(cmd, { encoding: 'utf8', timeout: 35000 });
    return JSON.parse(out);
  } catch (e: any) {
    throw new Error(`Request to ${path} failed: ${e.message}`);
  }
}

function curlGet(path: string): any {
  const cmd = `curl -sf --max-time 15 '${SERVER_URL}${path}'`;
  try {
    const out = execSync(cmd, { encoding: 'utf8', timeout: 20000 });
    return JSON.parse(out);
  } catch (e: any) {
    throw new Error(`Request to ${path} failed: ${e.message}`);
  }
}

function serverIsUp(): boolean {
  try {
    execSync(`curl -sf --max-time 3 '${SERVER_URL}/'`, { stdio: 'pipe', timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

function findWord(words: any[], target: string): any | undefined {
  return words.find((w: any) => w.word === target);
}

function allMeanings(word: any): string {
  const parts: string[] = [];
  if (word.meaning) parts.push(word.meaning);
  if (Array.isArray(word.meanings)) parts.push(...word.meanings);
  return parts.join(' | ');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function runTests() {
  console.log('='.repeat(70));
  console.log('  Server API Tests — known failure cases');
  console.log('='.repeat(70));

  if (!serverIsUp()) {
    console.log(`\n⚠️  Server is not running at ${SERVER_URL}`);
    console.log('   Start it with:  npm run dev');
    console.log('   Then re-run:   npx tsx tests/test-server-api.ts\n');
    process.exit(0);
  }

  console.log(`\n  Connected to server at ${SERVER_URL}\n`);

  // -----------------------------------------------------------------------
  // 1. 猫 → "cat", not slang sense (issue #187)
  // -----------------------------------------------------------------------
  section('#187 — 猫 primary meaning is "cat", not slang "submissive partner"');
  {
    const words = curlPost('/api/extract', { text: '猫が寝ています。' });
    const neko = findWord(words, '猫');
    assert('猫 is returned by /api/extract', !!neko, 'word not found in response');
    if (neko) {
      assertContains('猫 primary meaning contains "cat"', neko.meaning, 'cat');
      assertNotContains('猫 primary meaning is not the slang sense', neko.meaning, 'submissive');
      assertNotContains('猫 primary meaning is not the slang sense', neko.meaning, 'homosexual');
    }
  }

  // -----------------------------------------------------------------------
  // 2. 寝る → "to sleep", not "to ferment" (issue #187 ordering)
  // -----------------------------------------------------------------------
  section('#187 — 寝 primary meaning is "to sleep", not "to ferment"');
  {
    const words = curlPost('/api/extract', { text: '猫が寝ています。' });
    const ne = words.find((w: any) => w.word === '寝' || w.word === '寝る');
    assert('寝/寝る is returned by /api/extract', !!ne,
      `words returned: ${words.map((w: any) => w.word).join(', ')}`);
    if (ne) {
      assertContains('寝る primary meaning contains "sleep"', ne.meaning, 'sleep');
      assertNotContains('寝る primary meaning is not "to ferment"', ne.meaning, 'ferment');
    }
  }

  // -----------------------------------------------------------------------
  // 3. 桜 → "cherry blossom", not "hired applauder" (issue #187)
  // -----------------------------------------------------------------------
  section('#187 — 桜 primary meaning is "cherry blossom", not "hired applauder"');
  {
    const words = curlPost('/api/extract', { text: '桜が咲いています。' });
    const sakura = findWord(words, '桜');
    assert('桜 is returned by /api/extract', !!sakura, 'word not found in response');
    if (sakura) {
      assertContains('桜 primary meaning contains "cherry"', sakura.meaning, 'cherry');
      assertNotContains('桜 primary meaning is not archaic "applaud" sense', sakura.meaning, 'applaud');
      assertNotContains('桜 primary meaning is not "horse meat"', sakura.meaning, 'horse meat');
    }
  }

  // -----------------------------------------------------------------------
  // 4. 買い → "to buy", not "paying for a prostitute" (issue #187 ordering)
  // -----------------------------------------------------------------------
  section('#187 — 買い primary meaning is "to buy", not "paying for a prostitute"');
  {
    const words = curlPost('/api/extract', { text: '本を買いました。' });
    const kai = words.find((w: any) => w.word === '買い' || w.word === '買う');
    assert('買い/買う is returned by /api/extract', !!kai,
      `words returned: ${words.map((w: any) => w.word).join(', ')}`);
    if (kai) {
      assertContains('買い primary meaning contains "buy"', kai.meaning, 'buy');
      assertNotContains('買い primary meaning not about prostitution', kai.meaning, 'prostitut');
      assertNotContains('買い primary meaning not about geisha', kai.meaning, 'geisha');
    }
  }

  // -----------------------------------------------------------------------
  // 5. たい → "want to", not Dutch/foreign text (issues #186, #188)
  // -----------------------------------------------------------------------
  section('#186 / #188 — たい returns "want to", not foreign-language text');
  {
    const words = curlPost('/api/extract', { text: '海に行きたいです。' });
    const tai = findWord(words, 'たい');
    assert('たい is returned by /api/extract', !!tai,
      `words returned: ${words.map((w: any) => w.word).join(', ')}`);
    if (tai) {
      assertNotContains('たい meaning is not "Unknown"', tai.meaning, 'Unknown');
      assertContains('たい meaning contains "want"', tai.meaning, 'want');
      // Before fix: Dutch "Kriebelen" from a non-English JMDict gloss
      assertNotContains('たい meaning not in Dutch (no "kriebelen")', tai.meaning, 'kriebelen');
    }
  }

  // -----------------------------------------------------------------------
  // 6. いい → "good", not "Unknown" (issues #186, #188)
  // -----------------------------------------------------------------------
  section('#186 / #188 — いい returns "good / nice", not "Unknown" or German text');
  {
    const words = curlPost('/api/extract', { text: '今日はいい天気です。' });
    const ii = findWord(words, 'いい');
    assert('いい is returned by /api/extract', !!ii,
      `words returned: ${words.map((w: any) => w.word).join(', ')}`);
    if (ii) {
      assertNotContains('いい meaning is not "Unknown"', ii.meaning, 'Unknown');
      const hasGoodOrNice = ii.meaning.toLowerCase().includes('good') || ii.meaning.toLowerCase().includes('nice');
      assert('いい meaning contains "good" or "nice"', hasGoodOrNice, `got: "${ii.meaning}"`);
      // Before fix: German text from JMDict non-English glosses
      assertNotContains('いい meaning is not in German', ii.meaning, 'gut ');
    }
  }

  // -----------------------------------------------------------------------
  // 7. まし → polite suffix sense, not "appalling" (issues #187, #188)
  // -----------------------------------------------------------------------
  section('#187 / #188 — まし is not "appalling" (polite verb stem)');
  {
    const words = curlPost('/api/extract', { text: '春が来ましたね。' });
    const mashi = findWord(words, 'まし');
    assert('まし is returned by /api/extract', !!mashi,
      `words returned: ${words.map((w: any) => w.word).join(', ')}`);
    if (mashi) {
      assertNotContains('まし meaning is not "appalling"', mashi.meaning, 'appalling');
      assertNotContains('まし meaning is not "terrible"', mashi.meaning, 'terrible');
    }
  }

  // -----------------------------------------------------------------------
  // 8. 春 → "spring (season)", not archaic "New Year" (issue #187)
  // -----------------------------------------------------------------------
  section('#187 — 春 primary meaning is "spring (season)", not archaic "New Year"');
  {
    const words = curlPost('/api/extract', { text: '春が来ましたね。' });
    const haru = findWord(words, '春');
    assert('春 is returned by /api/extract', !!haru, 'word not found in response');
    if (haru) {
      assertContains('春 primary meaning contains "spring"', haru.meaning, 'spring');
      assertNotContains('春 primary meaning is not "New Year"', haru.meaning, 'New Year');
    }
  }

  // -----------------------------------------------------------------------
  // 9. 可愛い → "cute / adorable", not "dainty, little, tiny" (issue #187)
  // -----------------------------------------------------------------------
  section('#187 — 可愛い primary meaning is "cute/adorable", not "dainty/tiny"');
  {
    const words = curlPost('/api/extract', { text: 'とても可愛いです。' });
    const kawaii = findWord(words, '可愛い');
    assert('可愛い is returned by /api/extract', !!kawaii, 'word not found in response');
    if (kawaii) {
      const top = allMeanings(kawaii).toLowerCase().slice(0, 200);
      assert('可愛い top meanings include "cute" or "adorable"',
        top.includes('cute') || top.includes('adorable'),
        `got: "${kawaii.meaning}"`);
      assertNotContains('可愛い primary meaning is not "dainty"', kawaii.meaning, 'dainty');
      assertNotContains('可愛い primary meaning is not "tiny"', kawaii.meaning, 'tiny');
    }
  }

  // -----------------------------------------------------------------------
  // 10. 行き → "to go", not "to die / pass away" (issue #187 ordering)
  // -----------------------------------------------------------------------
  section('#187 — 行き primary meaning is "to go", not "to die / pass away"');
  {
    const words = curlPost('/api/extract', { text: '行きました。' });
    const iki = words.find((w: any) => w.word === '行き' || w.word === '行く');
    assert('行き/行く is returned by /api/extract', !!iki,
      `words returned: ${words.map((w: any) => w.word).join(', ')}`);
    if (iki) {
      assertContains('行き primary meaning contains "go"', iki.meaning, 'go');
      assertNotContains('行き primary meaning is not "to die"', iki.meaning, 'to die');
      assertNotContains('行き primary meaning is not "pass away"', iki.meaning, 'pass away');
    }
  }

  // -----------------------------------------------------------------------
  // Bonus: /api/word/:word endpoint — kana words should have real meanings
  // -----------------------------------------------------------------------
  section('#188 — /api/word/:word endpoint: kana grammar words return real meanings');
  {
    for (const [word, expectedHint] of [
      ['です', 'be'],
      ['ます', 'polite'],
      ['ない', 'not'],
    ] as const) {
      const encoded = encodeURIComponent(word);
      const result = curlGet(`/api/word/${encoded}`);
      assert(`/api/word/${word} returns a result`, !!result && !result.error,
        result?.error || 'no result');
      if (result && !result.error) {
        assertNotContains(`/api/word/${word} meaning is not "Unknown"`, result.meaning || '', 'Unknown');
        assertContains(`/api/word/${word} meaning mentions "${expectedHint}"`,
          (result.meaning || '') + ' ' + (result.meanings || []).join(' '),
          expectedHint);
      }
    }
  }

  // -------------------------------------------------------------------------
  // Summary
  // -------------------------------------------------------------------------
  console.log('\n' + '='.repeat(70));
  const total = passed + failed;
  console.log(`  Results: ${passed}/${total} passed, ${failed} failed`);
  console.log('='.repeat(70));

  if (failed > 0) process.exit(1);
}

runTests().catch((e) => {
  console.error('Test runner error:', e);
  process.exit(1);
});
