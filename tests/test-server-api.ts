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
      // "to sleep", "to go to bed", "to lie down" are all valid primary meanings
      const sleepRelated = ne.meaning.toLowerCase().includes('sleep') ||
        ne.meaning.toLowerCase().includes('bed') ||
        ne.meaning.toLowerCase().includes('lie');
      assert('寝る primary meaning is sleep-related', sleepRelated, `got: "${ne.meaning}"`);
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

  // -----------------------------------------------------------------------
  // Issue #189 — Conjugated verb lookup (Sudachi mode C groups verb forms)
  //
  // With mode C alone, tokens like 寝ています have no dictionary entry and
  // return "Unknown meaning". The fix uses dual-mode: mode C surface for
  // display, mode A normalized_form for dictionary lookup.
  //
  // These tests are written BEFORE the fix and are expected to fail until
  // dual-mode tokenization is implemented.
  // -----------------------------------------------------------------------

  // --- Group A: て-います progressive forms --------------------------------
  section('#189 — 寝ています (progressive) → sleep-related meaning, not Unknown');
  {
    const words = curlPost('/api/extract', { text: '猫が寝ています。' });
    const nete = findWord(words, '寝ています');
    assert(
      '寝ています appears as a single word (surface preserved from mode C)',
      !!nete,
      `words returned: ${words.map((w: any) => w.word).join(', ')}`
    );
    if (nete) {
      assertNotContains('寝ています meaning is not "Unknown"', nete.meaning, 'Unknown');
      const sleepRelated =
        nete.meaning.toLowerCase().includes('sleep') ||
        nete.meaning.toLowerCase().includes('bed') ||
        nete.meaning.toLowerCase().includes('lie down');
      assert('寝ています meaning is sleep-related', sleepRelated, `got: "${nete.meaning}"`);
    }
  }

  section('#189 — 走っています (progressive) → run-related meaning, not Unknown');
  {
    const words = curlPost('/api/extract', { text: '毎朝走っています。' });
    const hashitte = findWord(words, '走っています');
    assert(
      '走っています appears as a single word',
      !!hashitte,
      `words returned: ${words.map((w: any) => w.word).join(', ')}`
    );
    if (hashitte) {
      assertNotContains('走っています meaning is not "Unknown"', hashitte.meaning, 'Unknown');
      const runRelated =
        hashitte.meaning.toLowerCase().includes('run') ||
        hashitte.meaning.toLowerCase().includes('jog');
      assert('走っています meaning is run-related', runRelated, `got: "${hashitte.meaning}"`);
    }
  }

  section('#189 — 笑っています (progressive) → laugh/smile meaning, not Unknown');
  {
    const words = curlPost('/api/extract', { text: '彼女は笑っています。' });
    const waratte = findWord(words, '笑っています');
    assert(
      '笑っています appears as a single word',
      !!waratte,
      `words returned: ${words.map((w: any) => w.word).join(', ')}`
    );
    if (waratte) {
      assertNotContains('笑っています meaning is not "Unknown"', waratte.meaning, 'Unknown');
      const laughRelated =
        waratte.meaning.toLowerCase().includes('laugh') ||
        waratte.meaning.toLowerCase().includes('smile');
      assert('笑っています meaning is laugh/smile-related', laughRelated, `got: "${waratte.meaning}"`);
    }
  }

  // --- Group B: ました polite past forms -----------------------------------
  section('#189 — 描きました (polite past) → draw/paint meaning, not Unknown');
  {
    const words = curlPost('/api/extract', { text: '絵を描きました。' });
    const kakimashita = findWord(words, '描きました');
    assert(
      '描きました appears as a single word',
      !!kakimashita,
      `words returned: ${words.map((w: any) => w.word).join(', ')}`
    );
    if (kakimashita) {
      assertNotContains('描きました meaning is not "Unknown"', kakimashita.meaning, 'Unknown');
      const drawRelated =
        kakimashita.meaning.toLowerCase().includes('draw') ||
        kakimashita.meaning.toLowerCase().includes('paint') ||
        kakimashita.meaning.toLowerCase().includes('sketch');
      assert('描きました meaning is draw/paint-related', drawRelated, `got: "${kakimashita.meaning}"`);
    }
  }

  section('#189 — 読みました (polite past) → read-related meaning, not Unknown');
  {
    const words = curlPost('/api/extract', { text: '本を読みました。' });
    const yomimashita = findWord(words, '読みました');
    assert(
      '読みました appears as a single word',
      !!yomimashita,
      `words returned: ${words.map((w: any) => w.word).join(', ')}`
    );
    if (yomimashita) {
      assertNotContains('読みました meaning is not "Unknown"', yomimashita.meaning, 'Unknown');
      assertContains('読みました meaning contains "read"', yomimashita.meaning, 'read');
    }
  }

  section('#189 — 食べました (polite past) → eat-related meaning, not Unknown');
  {
    const words = curlPost('/api/extract', { text: 'ご飯を食べました。' });
    const tabemashita = findWord(words, '食べました');
    assert(
      '食べました appears as a single word',
      !!tabemashita,
      `words returned: ${words.map((w: any) => w.word).join(', ')}`
    );
    if (tabemashita) {
      assertNotContains('食べました meaning is not "Unknown"', tabemashita.meaning, 'Unknown');
      const eatRelated =
        tabemashita.meaning.toLowerCase().includes('eat') ||
        tabemashita.meaning.toLowerCase().includes('food') ||
        tabemashita.meaning.toLowerCase().includes('consume');
      assert('食べました meaning is eat-related', eatRelated, `got: "${tabemashita.meaning}"`);
    }
  }

  // --- Group C: て-いました past progressive --------------------------------
  section('#189 — 食べていました (past progressive) → eat-related meaning, not Unknown');
  {
    const words = curlPost('/api/extract', { text: 'ご飯を食べていました。' });
    const tabeteimashita = findWord(words, '食べていました');
    assert(
      '食べていました appears as a single word',
      !!tabeteimashita,
      `words returned: ${words.map((w: any) => w.word).join(', ')}`
    );
    if (tabeteimashita) {
      assertNotContains('食べていました meaning is not "Unknown"', tabeteimashita.meaning, 'Unknown');
      const eatRelated =
        tabeteimashita.meaning.toLowerCase().includes('eat') ||
        tabeteimashita.meaning.toLowerCase().includes('food');
      assert('食べていました meaning is eat-related', eatRelated, `got: "${tabeteimashita.meaning}"`);
    }
  }

  // --- Group D: ません negative polite -------------------------------------
  section('#189 — 飲みません (negative polite) → drink-related meaning, not Unknown');
  {
    const words = curlPost('/api/extract', { text: 'お酒を飲みません。' });
    const nomimasen = findWord(words, '飲みません');
    assert(
      '飲みません appears as a single word',
      !!nomimasen,
      `words returned: ${words.map((w: any) => w.word).join(', ')}`
    );
    if (nomimasen) {
      assertNotContains('飲みません meaning is not "Unknown"', nomimasen.meaning, 'Unknown');
      const drinkRelated =
        nomimasen.meaning.toLowerCase().includes('drink') ||
        nomimasen.meaning.toLowerCase().includes('swallow');
      assert('飲みません meaning is drink-related', drinkRelated, `got: "${nomimasen.meaning}"`);
    }
  }

  // --- Group E: て-くれました compound giving verb --------------------------
  section('#189 — 喜んでくれました (compound giving verb) → rejoice/glad meaning, not Unknown');
  {
    const words = curlPost('/api/extract', { text: '友達が喜んでくれました。' });
    // Mode C may group differently; accept the token containing 喜
    const yorokobu = words.find((w: any) =>
      w.word.includes('喜') || w.word === '喜ぶ'
    );
    assert(
      'A word containing 喜 is returned',
      !!yorokobu,
      `words returned: ${words.map((w: any) => w.word).join(', ')}`
    );
    if (yorokobu) {
      assertNotContains('喜… meaning is not "Unknown"', yorokobu.meaning, 'Unknown');
      const gladRelated =
        yorokobu.meaning.toLowerCase().includes('rejoice') ||
        yorokobu.meaning.toLowerCase().includes('glad') ||
        yorokobu.meaning.toLowerCase().includes('happy') ||
        yorokobu.meaning.toLowerCase().includes('joy');
      assert('喜… meaning is glad/rejoice-related', gladRelated, `got: "${yorokobu.meaning}"`);
    }
  }

  // --- Group F: Surface form preservation (dual-mode key invariant) --------
  //
  // With mode A alone, 寝ています splits into [寝, て, い, ます] — four words.
  // With dual-mode (C for surface, A for lookup), it stays as one word.
  // These tests enforce the dual-mode contract.
  section('#189 — surface form preservation: 寝ています is ONE token, not [寝|て|い|ます]');
  {
    const words = curlPost('/api/extract', { text: '猫が寝ています。' });
    const surfaceForms = words.map((w: any) => w.word);

    // The conjugated form must appear as a single surface word
    assert(
      '寝ています appears as one token',
      surfaceForms.includes('寝ています'),
      `surfaces: [${surfaceForms.join(', ')}]`
    );
    // The bare stem 寝 must NOT appear as a separate vocabulary entry
    assert(
      '寝 alone does NOT appear (would mean mode A split it)',
      !surfaceForms.includes('寝'),
      `surfaces: [${surfaceForms.join(', ')}]`
    );
  }

  section('#189 — surface form preservation: 描きました is ONE token, not [描き|まし|た]');
  {
    const words = curlPost('/api/extract', { text: '絵を描きました。' });
    const surfaceForms = words.map((w: any) => w.word);

    assert(
      '描きました appears as one token',
      surfaceForms.includes('描きました'),
      `surfaces: [${surfaceForms.join(', ')}]`
    );
    assert(
      '描き alone does NOT appear as a separate word',
      !surfaceForms.includes('描き'),
      `surfaces: [${surfaceForms.join(', ')}]`
    );
  }

  // --- Group G: Compound noun regression (must still work after the fix) ---
  section('#189 (regression) — 図書館 (multi-kanji compound noun) still returns "library"');
  {
    const words = curlPost('/api/extract', { text: '図書館で本を読みました。' });
    const toshokan = findWord(words, '図書館');
    assert('図書館 is returned by /api/extract', !!toshokan,
      `words returned: ${words.map((w: any) => w.word).join(', ')}`);
    if (toshokan) {
      assertContains('図書館 meaning contains "library"', toshokan.meaning, 'library');
      assertNotContains('図書館 meaning is not "Unknown"', toshokan.meaning, 'Unknown');
    }
  }

  section('#189 (regression) — 新聞 (compound noun) still returns "newspaper"');
  {
    const words = curlPost('/api/extract', { text: '毎朝新聞を読んでいます。' });
    const shinbun = findWord(words, '新聞');
    assert('新聞 is returned by /api/extract', !!shinbun,
      `words returned: ${words.map((w: any) => w.word).join(', ')}`);
    if (shinbun) {
      assertContains('新聞 meaning contains "newspaper"', shinbun.meaning, 'newspaper');
      assertNotContains('新聞 meaning is not "Unknown"', shinbun.meaning, 'Unknown');
    }
  }

  section('#189 (regression) — 勉強 (compound noun / verbal noun) still returns "study"');
  {
    const words = curlPost('/api/extract', { text: '毎日日本語を勉強しています。' });
    const benkyo = findWord(words, '勉強');
    assert('勉強 is returned by /api/extract', !!benkyo,
      `words returned: ${words.map((w: any) => w.word).join(', ')}`);
    if (benkyo) {
      const studyRelated =
        benkyo.meaning.toLowerCase().includes('study') ||
        benkyo.meaning.toLowerCase().includes('learn');
      assert('勉強 meaning is study-related', studyRelated, `got: "${benkyo.meaning}"`);
      assertNotContains('勉強 meaning is not "Unknown"', benkyo.meaning, 'Unknown');
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
