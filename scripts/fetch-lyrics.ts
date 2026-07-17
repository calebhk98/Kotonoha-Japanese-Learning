#!/usr/bin/env npx tsx
/**
 * Fetch music lyrics from uta-net.com for placeholder transcripts.
 *
 * Scans src/music/* for entries whose transcript.md is still a placeholder
 * and whose metadata.json sourceUrl points at uta-net.com, then fetches the
 * real lyrics and overwrites transcript.md.
 *
 * This used to run automatically on every `npm run dev` boot. It's now a
 * manual/on-demand script (see issue #255) so the dev server doesn't spend
 * its startup window hammering uta-net.com.
 *
 * Usage:
 *   npm run fetch-lyrics
 *   npx tsx scripts/fetch-lyrics.ts
 *
 * Runs once and exits. Logs progress to stdout/stderr.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");

interface PlaceholderItem {
  id: string;
  title: string;
  sourceUrl: string;
  transcriptPath: string;
}

/**
 * Scan src/music/ and find all entries with placeholder transcripts whose
 * metadata points at uta-net.com.
 */
function findPlaceholderLyrics(): PlaceholderItem[] {
  const musicDir = path.join(ROOT, "src", "music");
  const toFetch: PlaceholderItem[] = [];

  if (!fs.existsSync(musicDir)) {
    return toFetch; // No music directory
  }

  const musicFolders = fs.readdirSync(musicDir);

  for (const folder of musicFolders) {
    const metadataPath = path.join(musicDir, folder, "metadata.json");
    const transcriptPath = path.join(musicDir, folder, "transcript.md");

    if (!fs.existsSync(metadataPath) || !fs.existsSync(transcriptPath)) continue;

    try {
      const metadata = JSON.parse(fs.readFileSync(metadataPath, "utf-8"));
      const transcript = fs.readFileSync(transcriptPath, "utf-8");

      // Check if it's a placeholder (contains "to be fetched" or "Placeholder" or is just the header)
      const isPlaceholder =
        transcript.includes("to be fetched") ||
        transcript.includes("Placeholder") ||
        transcript.includes("fetch") ||
        transcript.trim().split("\n").length < 5; // Very short = likely placeholder

      if (
        isPlaceholder &&
        metadata.sourceUrl &&
        metadata.sourceUrl.includes("uta-net.com")
      ) {
        toFetch.push({
          id: metadata.id,
          title: metadata.title,
          sourceUrl: metadata.sourceUrl,
          transcriptPath,
        });
      }
    } catch (e) {
      // Skip errors per-folder
    }
  }

  return toFetch;
}

/**
 * Fetch and parse lyrics from a single uta-net.com song page.
 * Returns the cleaned lyrics text, or null if extraction failed.
 */
async function fetchLyrics(sourceUrl: string): Promise<string | null> {
  const response = await fetch(sourceUrl);
  if (!response.ok) {
    console.warn(`[fetch-lyrics] Failed to fetch: HTTP ${response.status}`);
    return null;
  }

  const html = await response.text();

  // Parse uta-net HTML: lyrics are in <div id="kashi_area">
  const match = html.match(/<div id="kashi_area">[\s\S]*?<\/div>/i);
  if (!match) {
    console.warn(`[fetch-lyrics] No #kashi_area found in ${sourceUrl}`);
    return null;
  }

  let lyricsHtml = match[0];

  // Convert <br> to newlines
  lyricsHtml = lyricsHtml.replace(/<br\s*\/?>/gi, "\n");

  // Remove all HTML tags
  lyricsHtml = lyricsHtml.replace(/<[^>]+>/g, "");

  // Decode HTML entities
  lyricsHtml = lyricsHtml
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");

  // Clean up whitespace
  const lyrics = lyricsHtml
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join("\n");

  return lyrics || null;
}

/**
 * Main entry point. Batch-fetches with rate limiting (delay between fetches
 * to avoid hammering uta-net).
 */
async function main() {
  const toFetch = findPlaceholderLyrics();

  if (toFetch.length === 0) {
    console.log("[fetch-lyrics] All music transcripts already populated — skipping");
    return;
  }

  console.log(`[fetch-lyrics] ${toFetch.length} placeholder transcripts detected`);

  const DELAY_MS = 1000; // 1 second between requests
  let succeeded = 0;
  let failed = 0;

  for (let i = 0; i < toFetch.length; i++) {
    const item = toFetch[i];

    // Delay before fetch (except the first one)
    if (i > 0) {
      await new Promise((resolve) => setTimeout(resolve, DELAY_MS));
    }

    try {
      console.log(`[fetch-lyrics] Fetching ${item.id} (${i + 1}/${toFetch.length})...`);

      const lyrics = await fetchLyrics(item.sourceUrl);
      if (!lyrics) {
        console.warn(`[fetch-lyrics] Extracted empty lyrics for ${item.id}`);
        failed++;
        continue;
      }

      fs.writeFileSync(item.transcriptPath, lyrics + "\n", "utf-8");
      console.log(`[fetch-lyrics] ✓ ${item.id} — ${lyrics.split("\n").length} lines`);
      succeeded++;
    } catch (e) {
      console.error(`[fetch-lyrics] Error fetching ${item.id}:`, e instanceof Error ? e.message : String(e));
      failed++;
    }
  }

  console.log(`[fetch-lyrics] Done. Succeeded: ${succeeded}, Failed: ${failed}, Total: ${toFetch.length}`);
  process.exitCode = failed > 0 && succeeded === 0 ? 1 : 0;
}

main().catch((err) => {
  console.error("[fetch-lyrics] Unhandled error:", err instanceof Error ? err.message : String(err));
  process.exit(1);
});
