#!/usr/bin/env tsx
/**
 * Background video caption scraper.
 * Scans src/videos/* for videos with placeholder transcripts,
 * then pulls real captions using the CaptionScraper.
 *
 * Usage:
 *   npx tsx scripts/background/scrape-video-captions.ts
 *
 * Runs indefinitely, pulling one video at a time with delays.
 * Logs progress to stdout/stderr.
 */

import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { CaptionScraper, isPlaceholderTranscript, detectSource } from "../../src/lib/caption-scraper.js";

const VIDEOS_DIR = join(process.cwd(), "src", "videos");

interface VideoMetadata {
  id?: string;
  mediaUrl?: string;
  [k: string]: any;
}

/**
 * Scan src/videos/ and find all videos with placeholder transcripts.
 */
async function findPlaceholderVideos(): Promise<
  Array<{ videoId: string; meta: VideoMetadata }>
> {
  const candidates: Array<{ videoId: string; meta: VideoMetadata }> = [];

  if (!existsSync(VIDEOS_DIR)) {
    console.log("[scrape-captions] src/videos/ not found");
    return candidates;
  }

  for (const name of readdirSync(VIDEOS_DIR)) {
    const metaPath = join(VIDEOS_DIR, name, "metadata.json");
    if (!existsSync(metaPath)) continue;

    try {
      const meta = JSON.parse(readFileSync(metaPath, "utf8")) as VideoMetadata;

      // Skip if no mediaUrl (can't pull captions)
      if (!meta.mediaUrl) {
        console.log(`[scrape-captions] ${name}: no mediaUrl, skipping`);
        continue;
      }

      // Skip if already attempted recently (avoid thrashing on failures)
      const lastAttempt = meta.lastCaptionScrapeAttempt
        ? new Date(meta.lastCaptionScrapeAttempt)
        : null;
      const now = new Date();
      if (lastAttempt && now.getTime() - lastAttempt.getTime() < 3600000) {
        // 1 hour
        console.log(
          `[scrape-captions] ${name}: recently attempted, skipping (retry after 1h)`
        );
        continue;
      }

      // Check if transcript is a placeholder
      if (isPlaceholderTranscript(name)) {
        candidates.push({ videoId: name, meta });
      }
    } catch (err) {
      console.error(`[scrape-captions] Error parsing ${metaPath}:`, err);
    }
  }

  return candidates;
}

/**
 * Main entry point.
 */
async function main() {
  console.log("[scrape-captions] Starting background caption scraper…");

  const videos = await findPlaceholderVideos();
  if (videos.length === 0) {
    console.log("[scrape-captions] No videos need captions, exiting");
    process.exit(0);
  }

  console.log(`[scrape-captions] Found ${videos.length} videos with placeholder transcripts`);

  const scraper = new CaptionScraper();
  const configs = videos.map((v) => ({
    videoId: v.videoId,
    mediaUrl: v.meta.mediaUrl!,
    source: detectSource(v.meta.mediaUrl!),
    dasId: v.meta.dasId,
  }));

  const results = await scraper.pullBatch(configs, (result) => {
    if (result.success) {
      console.log(`[scrape-captions] ✓ ${result.videoId}: ${result.message}`);
    } else {
      console.error(`[scrape-captions] ✗ ${result.videoId}: ${result.message}`, result.error);
    }
  });

  const succeeded = results.filter((r) => r.success).length;
  const failed = results.filter((r) => !r.success).length;

  console.log(
    `[scrape-captions] Done. Succeeded: ${succeeded}, Failed: ${failed}, Total: ${results.length}`
  );
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("[scrape-captions] Unhandled error:", err);
  process.exit(1);
});
