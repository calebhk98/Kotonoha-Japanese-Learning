#!/usr/bin/env npx tsx
/**
 * Fetch lyrics from uta-net.com using plain HTTP + cheerio.
 *
 * Usage (from scripts):
 *   import { fetchUnetLyrics } from './fetch-uta-net.js';
 *   const lyrics = await fetchUnetLyrics('https://www.uta-net.com/song/9951/');
 */

import { load } from "cheerio";

/**
 * Fetch lyrics from a uta-net.com song page.
 * Returns the raw Japanese text with newlines preserved.
 * Returns null if fetch fails or lyrics not found.
 */
export async function fetchUnetLyrics(url: string): Promise<string | null> {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      console.error(
        `[fetch-uta-net] HTTP ${response.status} for ${url}`
      );
      return null;
    }

    const html = await response.text();
    const $ = load(html);

    // uta-net stores lyrics in <div id="kashi_area">
    const lyricsDiv = $("#kashi_area");
    if (!lyricsDiv.length) {
      console.error(`[fetch-uta-net] #kashi_area not found in ${url}`);
      return null;
    }

    // Get text content, preserving structure
    let lyrics = lyricsDiv.html() || "";

    // Convert <br> to newlines
    lyrics = lyrics.replace(/<br\s*\/?>/gi, "\n");

    // Remove all HTML tags
    lyrics = lyrics.replace(/<[^>]+>/g, "");

    // Decode HTML entities
    lyrics = lyrics
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'");

    // Clean up excessive whitespace while preserving intentional newlines
    lyrics = lyrics
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .join("\n");

    if (!lyrics) {
      console.error(`[fetch-uta-net] No lyrics found in #kashi_area for ${url}`);
      return null;
    }

    return lyrics;
  } catch (err) {
    console.error(`[fetch-uta-net] Error fetching ${url}:`, err);
    return null;
  }
}

// If run directly as a script: npx tsx scripts/fetch-uta-net.ts <URL>
if (import.meta.url === `file://${process.argv[1]}`) {
  const url = process.argv[2];
  if (!url) {
    console.error("Usage: npx tsx scripts/fetch-uta-net.ts <uta-net-url>");
    process.exit(1);
  }

  const lyrics = await fetchUnetLyrics(url);
  if (lyrics) {
    console.log(lyrics);
  } else {
    process.exit(1);
  }
}
