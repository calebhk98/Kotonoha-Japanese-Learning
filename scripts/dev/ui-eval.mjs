// Drives the real UI like a learner: Import modal -> content page vocab list
// ("+N more words" expanded) -> reader with hover on. Writes <id>.vocab.md
// (cards as rendered), <id>.reader.md (each hoverable word as ⟦surface｜tooltip⟧)
// and hover screenshots. Needs the dev server running and playwright-core:
//   npm i --no-save playwright-core@1.47.2   (or install it in a scratch dir)
//   node scripts/dev/ui-eval.mjs <dirOfTxtFiles> <outDir>   (ONLY=<substr> filters)
// Each .txt file: title on line 1, blank line, body.
// Drive the real app UI: Import -> content page vocab list -> reader hovers.
// Usage: node ui.mjs <textsDir> <outDir>
import { chromium } from 'playwright-core';
import fs from 'fs'; import path from 'path';
const [textsDir, outDir] = process.argv.slice(2);
const base = `http://localhost:${process.env.PORT || 3000}`;
fs.mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell' });
const only = process.env.ONLY;
for (const f of fs.readdirSync(textsDir).filter(f => f.endsWith('.txt') && (!only || f.includes(only))).sort()) {
  const id = f.replace(/\.txt$/, '');
  const raw = fs.readFileSync(path.join(textsDir, f), 'utf8');
  const [title, ...rest] = raw.split('\n');
  const body = rest.join('\n').trim();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  page.on('console', m => { if (m.type() === 'error') console.log(`[${id} console]`, m.text().slice(0, 200)); });
  const t0 = Date.now();
  await page.goto(base, { waitUntil: 'networkidle', timeout: 180000 });
  await page.getByRole('button', { name: /Import Text/ }).click();
  await page.getByPlaceholder('e.g. My Favorite Story').fill(title);
  await page.getByPlaceholder('Paste Japanese text here...').fill(body);
  await page.getByRole('button', { name: /Import & Analyze/ }).click();
  await page.getByText(/words you haven't learned yet/).waitFor({ timeout: 900000 });
  await page.waitForLoadState('networkidle', { timeout: 900000 });
  const more = page.getByRole('button', { name: /more words/ });
  if (await more.count()) await more.first().click();
  await page.screenshot({ path: path.join(outDir, `${id}.vocab.png`), fullPage: false });
  // Vocab cards: the buttons in the unknown-words grid, as rendered text
  const cards = await page.evaluate(() => {
    const grid = [...document.querySelectorAll('div.grid')].find(g => g.closest('div.space-y-4') && g.querySelector('button'));
    return grid ? [...grid.querySelectorAll(':scope > button')].map(b => b.innerText.replace(/\n+/g, ' | ')) : [];
  });
  const header = await page.getByText(/words you haven't learned yet/).innerText();
  fs.writeFileSync(path.join(outDir, `${id}.vocab.md`),
    `# Vocabulary list as shown on the content page\n\n${header}\n\nEach line is one card's visible text (fields separated by " | ").\n\n` + cards.map(c => `- ${c}`).join('\n') + '\n');
  // Reader
  await page.getByRole('button', { name: /Dive Right In/ }).click();
  await page.locator('span[role=button][aria-label]').first().waitFor({ timeout: 600000 });
  await page.waitForLoadState('networkidle', { timeout: 600000 });
  // Screenshot a few real hovers
  const words = page.locator('span[role=button][aria-label]');
  const n = await words.count();
  for (const k of [0, Math.floor(n / 3), Math.floor((2 * n) / 3)]) {
    const w = words.nth(k); await w.scrollIntoViewIfNeeded(); await w.hover(); await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(outDir, `${id}.hover-${k}.png`) });
  }
  const reader = await page.evaluate(() => {
    const spans = [...document.querySelectorAll('span[role=button][aria-label]')];
    if (!spans.length) return '';
    // common container of the word spans = the reading text area
    let root = spans[0].parentElement;
    while (root && !spans.every(s => root.contains(s))) root = root.parentElement;
    const clone = root.cloneNode(true);
    for (const s of clone.querySelectorAll('span[role=button][aria-label]')) {
      const first = s.firstElementChild; // ruby or span with the surface
      const c2 = first.cloneNode(true); c2.querySelectorAll('rt').forEach(r => r.remove());
      // tooltip content, as the hover box shows it: lines of its flex column
      const tip = s.querySelector('div.flex.flex-col');
      const tipText = tip ? [...tip.children].map(e => e.innerText.trim()).filter(Boolean).join(' / ') : s.getAttribute('aria-label');
      s.replaceWith(document.createTextNode(`⟦${c2.textContent}｜${tipText}⟧`));
    }
    document.body.appendChild(clone); clone.style.display = 'block';
    const t = clone.innerText; clone.remove(); return t;
  });
  fs.writeFileSync(path.join(outDir, `${id}.reader.md`),
    `# ${title}\n\nReader view with hover definitions on. Each hoverable word is shown as ⟦word｜tooltip lines joined by " / "⟧ (tooltip lines: [Morpheme badge] / reading / word / meaning / [conjugation note] / [JLPT, Score]). Text outside ⟦⟧ has no hover.\n\n${reader}\n`);
  console.log(id, 'cards', cards.length, 'hover words', n, `${Math.round((Date.now() - t0) / 1000)}s`);
  await ctx.close();
}
await browser.close();
