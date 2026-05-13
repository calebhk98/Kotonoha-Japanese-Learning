/**
 * Unified caption-scraper for videos.
 * Handles multiple sources (YouTube, NHK) with source-specific timeouts and retry logic.
 */

import { execSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, statSync } from "node:fs";
import { join } from "node:path";

export type VideoSource = "youtube" | "nhk-kokokoza" | "unknown";

export interface ScraperConfig {
  videoId: string;
  mediaUrl: string;
  source: VideoSource;
  dasId?: string; // for NHK 高校講座
}

export interface ScraperResult {
  success: boolean;
  videoId: string;
  message: string;
  transcriptLinesCount?: number;
  error?: string;
}

/**
 * Detect the video source from mediaUrl.
 */
export function detectSource(mediaUrl: string): VideoSource {
  if (mediaUrl.includes("youtube.com")) return "youtube";
  if (mediaUrl.includes("edu.web.nhk")) return "nhk-kokokoza";
  return "unknown";
}

/**
 * Check if a video's transcript is a placeholder (too short = not real captions).
 * Threshold: < 30 lines likely means it's a summary, not actual captions.
 */
export function isPlaceholderTranscript(videoId: string): boolean {
  const transcriptPath = join(process.cwd(), "src", "videos", videoId, "transcript.md");
  if (!existsSync(transcriptPath)) return true;

  const content = readFileSync(transcriptPath, "utf8");
  const lines = content.split("\n").filter((l) => l.trim().length > 0);
  return lines.length < 30;
}

/**
 * Base handler for caption pulling.
 */
abstract class CaptionHandler {
  abstract name: string;
  abstract timeout: number; // milliseconds

  abstract pull(config: ScraperConfig): Promise<ScraperResult>;

  protected getOutDir(videoId: string): string {
    return join(process.cwd(), "src", "videos", videoId);
  }

  protected getTranscriptPath(videoId: string): string {
    return join(this.getOutDir(videoId), "transcript.md");
  }

  /**
   * Mark video as failed with a flag in metadata.json.
   */
  protected markFailed(videoId: string, error: string): void {
    const metaPath = join(this.getOutDir(videoId), "metadata.json");
    if (!existsSync(metaPath)) return;

    const meta = JSON.parse(readFileSync(metaPath, "utf8"));
    meta.captionScrapeAttempts = (meta.captionScrapeAttempts ?? 0) + 1;
    meta.lastCaptionScrapeError = error;
    meta.lastCaptionScrapeAttempt = new Date().toISOString();
    writeFileSync(metaPath, JSON.stringify(meta, null, 2));
  }
}

/**
 * YouTube handler: uses yt-dlp.
 */
class YouTubeHandler extends CaptionHandler {
  name = "YouTube";
  timeout = 60000; // 60s per video

  async pull(config: ScraperConfig): Promise<ScraperResult> {
    try {
      const scriptPath = join(process.cwd(), "scripts", "dev", "pull-video-captions.sh");
      if (!existsSync(scriptPath)) {
        throw new Error("pull-video-captions.sh not found");
      }

      // Run the script synchronously with timeout
      const result = spawnSync("bash", [scriptPath, config.mediaUrl, config.videoId], {
        timeout: this.timeout,
        encoding: "utf8",
      });

      if (result.error) {
        throw result.error;
      }

      if (result.status !== 0) {
        const stderr = result.stderr || result.stdout || "unknown error";
        throw new Error(`Script exited with status ${result.status}: ${stderr}`);
      }

      // Count lines in the newly-written transcript
      const transcriptPath = this.getTranscriptPath(config.videoId);
      if (!existsSync(transcriptPath)) {
        throw new Error("Transcript file was not created");
      }

      const content = readFileSync(transcriptPath, "utf8");
      const lineCount = content.split("\n").filter((l) => l.trim().length > 0).length;

      return {
        success: true,
        videoId: config.videoId,
        message: `YouTube: successfully pulled ${lineCount} lines`,
        transcriptLinesCount: lineCount,
      };
    } catch (err: any) {
      const error = err.message || String(err);
      this.markFailed(config.videoId, error);
      return {
        success: false,
        videoId: config.videoId,
        message: `YouTube: failed to pull`,
        error,
      };
    }
  }
}

/**
 * NHK 高校講座 handler: uses pdftotext.
 */
class NHKHandler extends CaptionHandler {
  name = "NHK高校講座";
  timeout = 30000; // 30s per video (smaller, just PDF extraction)

  async pull(config: ScraperConfig): Promise<ScraperResult> {
    try {
      if (!config.dasId) {
        throw new Error("NHK video requires das_id in metadata");
      }

      const scriptPath = join(process.cwd(), "scripts", "dev", "pull-video-captions.sh");
      if (!existsSync(scriptPath)) {
        throw new Error("pull-video-captions.sh not found");
      }

      const result = spawnSync(
        "bash",
        [scriptPath, config.mediaUrl, config.videoId, "--nhk-das-id", config.dasId],
        {
          timeout: this.timeout,
          encoding: "utf8",
        }
      );

      if (result.error) {
        throw result.error;
      }

      if (result.status !== 0) {
        const stderr = result.stderr || result.stdout || "unknown error";
        throw new Error(`Script exited with status ${result.status}: ${stderr}`);
      }

      const transcriptPath = this.getTranscriptPath(config.videoId);
      if (!existsSync(transcriptPath)) {
        throw new Error("Transcript file was not created");
      }

      const content = readFileSync(transcriptPath, "utf8");
      const lineCount = content.split("\n").filter((l) => l.trim().length > 0).length;

      return {
        success: true,
        videoId: config.videoId,
        message: `NHK 高校講座: successfully extracted ${lineCount} lines from PDF`,
        transcriptLinesCount: lineCount,
      };
    } catch (err: any) {
      const error = err.message || String(err);
      this.markFailed(config.videoId, error);
      return {
        success: false,
        videoId: config.videoId,
        message: `NHK 高校講座: failed to extract`,
        error,
      };
    }
  }
}

/**
 * Main scraper coordinator.
 */
export class CaptionScraper {
  private handlers: Map<VideoSource, CaptionHandler> = new Map();
  private defaultDelay = 3000; // 3s between videos

  constructor() {
    this.handlers.set("youtube", new YouTubeHandler());
    this.handlers.set("nhk-kokokoza", new NHKHandler());
  }

  /**
   * Pull a single video's captions.
   */
  async pullSingle(config: ScraperConfig): Promise<ScraperResult> {
    const handler = this.handlers.get(config.source);
    if (!handler) {
      return {
        success: false,
        videoId: config.videoId,
        message: `Unknown source: ${config.source}`,
        error: "No handler for this source",
      };
    }

    return handler.pull(config);
  }

  /**
   * Pull captions for a batch of videos, with delays between each.
   * Processes one at a time; skips if placeholder transcript is already missing.
   */
  async pullBatch(
    configs: ScraperConfig[],
    onProgress?: (result: ScraperResult) => void
  ): Promise<ScraperResult[]> {
    const results: ScraperResult[] = [];

    for (let i = 0; i < configs.length; i++) {
      const config = configs[i];
      const handler = this.handlers.get(config.source);

      if (!handler) {
        const result = {
          success: false,
          videoId: config.videoId,
          message: `Skipped: unknown source ${config.source}`,
          error: "No handler",
        };
        results.push(result);
        onProgress?.(result);
        continue;
      }

      console.log(`[CaptionScraper] Pulling ${config.videoId} (${i + 1}/${configs.length})…`);
      const result = await handler.pull(config);
      results.push(result);
      onProgress?.(result);

      // Wait before the next video (except on the last one)
      if (i < configs.length - 1) {
        const delay = this.defaultDelay;
        console.log(`[CaptionScraper] Waiting ${delay}ms before next…`);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }

    return results;
  }
}
