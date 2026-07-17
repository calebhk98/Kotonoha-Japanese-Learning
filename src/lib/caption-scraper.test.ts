import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CaptionScraper } from './caption-scraper.js';

// ---------------------------------------------------------------------------
// Caption scrape state must NOT be written into git-tracked metadata.json
//
// markFailed() used to stamp captionScrapeAttempts / lastCaptionScrapeError /
// lastCaptionScrapeAttempt into src/videos/<id>/metadata.json. Those files are
// committed content, so every `npm run dev` on a machine without yt-dlp (or
// with YouTube blocking the request) dirtied 30+ tracked files with
// machine-local failure timestamps. Scrape state is runtime cache — it belongs
// in a gitignored sidecar file, like .cache.db and the lookup caches.
// ---------------------------------------------------------------------------

describe('CaptionScraper – failure state stays out of metadata.json', () => {
  let tmp: string;
  let originalCwd: string;
  const videoId = 'test-video';
  let metaPath: string;
  let originalMetaContent: string;

  beforeEach(() => {
    originalCwd = process.cwd();
    tmp = mkdtempSync(join(tmpdir(), 'caption-scraper-test-'));
    // The scraper resolves everything from process.cwd()
    const videoDir = join(tmp, 'src', 'videos', videoId);
    mkdirSync(videoDir, { recursive: true });
    originalMetaContent = JSON.stringify(
      { id: videoId, title: 'Test', mediaUrl: 'https://www.youtube.com/watch?v=x' },
      null,
      2
    );
    metaPath = join(videoDir, 'metadata.json');
    writeFileSync(metaPath, originalMetaContent);
    process.chdir(tmp);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    rmSync(tmp, { recursive: true, force: true });
  });

  it('a failed pull leaves metadata.json byte-identical', async () => {
    const scraper = new CaptionScraper();
    // pull-video-captions.sh does not exist under the temp cwd, so the pull
    // fails through the same markFailed path as a missing yt-dlp would.
    const result = await scraper.pullSingle({
      videoId,
      mediaUrl: 'https://www.youtube.com/watch?v=x',
      source: 'youtube',
    });

    expect(result.success).toBe(false);
    expect(readFileSync(metaPath, 'utf8')).toBe(originalMetaContent);
  });

  it('a failed pull records attempts/error/timestamp in the gitignored state file instead', async () => {
    const scraper = new CaptionScraper();
    await scraper.pullSingle({
      videoId,
      mediaUrl: 'https://www.youtube.com/watch?v=x',
      source: 'youtube',
    });

    const statePath = join(tmp, '.caption-scrape-state.json');
    expect(existsSync(statePath)).toBe(true);
    const state = JSON.parse(readFileSync(statePath, 'utf8'));
    expect(state[videoId]).toBeDefined();
    expect(state[videoId].attempts).toBe(1);
    expect(typeof state[videoId].lastError).toBe('string');
    expect(new Date(state[videoId].lastAttempt).getTime()).not.toBeNaN();
  });

  it('repeated failures increment the attempt counter in the state file', async () => {
    const scraper = new CaptionScraper();
    const config = { videoId, mediaUrl: 'https://www.youtube.com/watch?v=x', source: 'youtube' as const };
    await scraper.pullSingle(config);
    await scraper.pullSingle(config);

    const state = JSON.parse(readFileSync(join(tmp, '.caption-scrape-state.json'), 'utf8'));
    expect(state[videoId].attempts).toBe(2);
  });
});
