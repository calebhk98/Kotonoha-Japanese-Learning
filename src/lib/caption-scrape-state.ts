/**
 * Runtime state for the caption scraper: per-video attempt counts, last
 * error, and last-attempt timestamp.
 *
 * This used to live inside src/videos/<id>/metadata.json — git-tracked
 * content files — so every dev-server run on a machine without yt-dlp
 * dirtied 30+ tracked files with machine-local failure timestamps. Like
 * .cache.db and the lookup caches, scrape state is per-machine runtime data
 * and lives in a gitignored sidecar at the repo root.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface CaptionScrapeEntry {
  attempts: number;
  lastError: string;
  lastAttempt: string; // ISO timestamp
}

export type CaptionScrapeState = Record<string, CaptionScrapeEntry>;

const STATE_FILENAME = ".caption-scrape-state.json";

function statePath(): string {
  return join(process.cwd(), STATE_FILENAME);
}

export function loadCaptionScrapeState(): CaptionScrapeState {
  const p = statePath();
  if (!existsSync(p)) return {};
  try {
    return JSON.parse(readFileSync(p, "utf8"));
  } catch {
    // Corrupt state file is not worth crashing the scraper over — start over.
    return {};
  }
}

export function recordCaptionScrapeFailure(videoId: string, error: string): void {
  const state = loadCaptionScrapeState();
  const prev = state[videoId];
  state[videoId] = {
    attempts: (prev?.attempts ?? 0) + 1,
    lastError: error,
    lastAttempt: new Date().toISOString(),
  };
  writeFileSync(statePath(), JSON.stringify(state, null, 2));
}

/**
 * Cooldown check used by the background scraper: true when this video failed
 * recently enough that retrying now would just thrash (default 1 hour).
 */
export function wasRecentlyAttempted(videoId: string, cooldownMs = 3600000): boolean {
  const entry = loadCaptionScrapeState()[videoId];
  if (!entry?.lastAttempt) return false;
  const last = new Date(entry.lastAttempt).getTime();
  if (Number.isNaN(last)) return false;
  return Date.now() - last < cooldownMs;
}
