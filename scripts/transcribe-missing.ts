#!/usr/bin/env npx tsx

/**
 * Batch-transcribes all music and video entries that have a playable mediaUrl
 * but are missing a transcript.md (or have an empty one).
 *
 * Runs whisper jobs concurrently up to --concurrency N (default 1, since
 * Whisper is CPU-bound; raise on GPU machines).
 *
 * Usage:
 *   npm run transcribe-missing
 *   npm run transcribe-missing -- --type music
 *   npm run transcribe-missing -- --concurrency 2 --model medium
 *   npm run transcribe-missing -- --dry-run
 *
 * Run in background (bash):
 *   nohup npm run transcribe-missing >> transcribe.log 2>&1 &
 *
 * Prerequisites: pip install openai-whisper yt-dlp
 */

import { spawn, spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

interface Args {
  type: 'music' | 'videos' | 'all';
  concurrency: number;
  model: string;
  language: string;
  timestamps: boolean;
  dryRun: boolean;
  help: boolean;
}

interface ContentEntry {
  id: string;
  dir: string;
  mediaUrl: string;
  transcriptPath: string;
  contentType: 'music' | 'videos';
}

function parseArgs(): Args {
  const args: Args = {
    type: 'all',
    concurrency: 1,
    model: 'large-v3',
    language: 'ja',
    timestamps: false,
    dryRun: false,
    help: false,
  };
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') args.help = true;
    else if (a === '--type' && argv[i + 1]) args.type = argv[++i] as Args['type'];
    else if (a === '--concurrency' && argv[i + 1]) args.concurrency = parseInt(argv[++i], 10);
    else if (a === '--model' && argv[i + 1]) args.model = argv[++i];
    else if (a === '--language' && argv[i + 1]) args.language = argv[++i];
    else if (a === '--timestamps') args.timestamps = true;
    else if (a === '--dry-run') args.dryRun = true;
  }
  return args;
}

function showHelp() {
  console.log(`
Usage: npm run transcribe-missing -- [options]

Scans music and video content directories and auto-transcribes any entry
that has a playable mediaUrl but is missing a transcript.md.

Options:
  --type music|videos|all   Which content type to scan (default: all)
  --concurrency N           Run N Whisper jobs in parallel (default: 1)
                            Raise to 2-4 on GPU machines; keep at 1 on CPU
  --model <name>            Whisper model (default: large-v3)
  --language <code>         Language (default: ja)
  --timestamps              Write SRT-style timestamps into transcript
  --dry-run                 Print what would be transcribed, don't run
  --help                    Show this help

Background execution (bash):
  nohup npm run transcribe-missing >> transcribe.log 2>&1 &

A "playable" URL is one pointing to a specific video (contains /watch, /shorts,
/embed, or ends in a video ID), not a channel homepage.
`);
}

function checkPrerequisite(cmd: string, installHint: string): void {
  const result = spawnSync('which', [cmd], { encoding: 'utf8' });
  if (result.error || result.status !== 0) {
    console.error(`✗ '${cmd}' not found. Install with: ${installHint}`);
    process.exit(1);
  }
}

function isPlayableUrl(url: string): boolean {
  if (!url) return false;
  // Accept specific video URLs; reject channel/playlist homepages
  return (
    /youtube\.com\/watch/.test(url) ||
    /youtu\.be\/[A-Za-z0-9_-]{11}/.test(url) ||
    /youtube\.com\/shorts\//.test(url) ||
    /youtube\.com\/embed\//.test(url) ||
    /nicovideo\.jp\/watch\//.test(url) ||
    /bilibili\.com\/video\//.test(url) ||
    // Generic: direct audio/video file links
    /\.(mp3|mp4|wav|ogg|m4a|webm)(\?|$)/.test(url)
  );
}

function isTranscriptMissing(transcriptPath: string): boolean {
  if (!fs.existsSync(transcriptPath)) return true;
  const content = fs.readFileSync(transcriptPath, 'utf8').trim();
  // Treat stub/placeholder transcripts as missing
  if (content.length === 0) return true;
  if (/^\[.*\]$/.test(content)) return true; // e.g. "[transcript unavailable]"
  return false;
}

function scanContentDir(contentType: 'music' | 'videos'): ContentEntry[] {
  const dir = path.join(ROOT, 'src', contentType);
  if (!fs.existsSync(dir)) return [];

  const entries: ContentEntry[] = [];
  for (const name of fs.readdirSync(dir)) {
    const entryDir = path.join(dir, name);
    if (!fs.statSync(entryDir).isDirectory()) continue;

    const metaPath = path.join(entryDir, 'metadata.json');
    if (!fs.existsSync(metaPath)) continue;

    let meta: Record<string, string>;
    try {
      meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
    } catch {
      continue;
    }

    const mediaUrl = meta.mediaUrl ?? '';
    if (!isPlayableUrl(mediaUrl)) continue;

    const transcriptPath = path.join(entryDir, 'transcript.md');
    if (!isTranscriptMissing(transcriptPath)) continue;

    entries.push({ id: meta.id ?? name, dir: entryDir, mediaUrl, transcriptPath, contentType });
  }
  return entries;
}

function transcribeOne(entry: ContentEntry, args: Args): Promise<void> {
  return new Promise((resolve, reject) => {
    const transcribeScript = path.join(ROOT, 'scripts', 'transcribe.ts');
    const cliArgs = [
      'tsx', transcribeScript,
      entry.mediaUrl,
      '--model', args.model,
      '--language', args.language,
      '--output', entry.transcriptPath,
    ];
    if (args.timestamps) cliArgs.push('--timestamps');

    const tag = `[${entry.contentType}/${entry.id}]`;
    console.log(`${tag} Starting transcription of ${entry.mediaUrl}`);

    const proc = spawn('npx', cliArgs, {
      cwd: ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const lines: string[] = [];
    proc.stderr.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      lines.push(text);
      // Forward [transcribe] log lines with the entry tag prepended
      for (const line of text.split('\n').filter(Boolean)) {
        console.log(`${tag} ${line}`);
      }
    });

    proc.on('close', (code) => {
      if (code === 0) {
        console.log(`${tag} ✓ Done → ${entry.transcriptPath}`);
        resolve();
      } else {
        console.error(`${tag} ✗ Failed (exit ${code})`);
        console.error(lines.join(''));
        reject(new Error(`Transcription failed for ${entry.id}`));
      }
    });

    proc.on('error', reject);
  });
}

async function runQueue(entries: ContentEntry[], args: Args): Promise<void> {
  // Simple concurrency pool: run at most args.concurrency jobs at once
  const queue = [...entries];
  const failures: string[] = [];
  let active = 0;
  let index = 0;

  await new Promise<void>((resolve) => {
    function next() {
      while (active < args.concurrency && index < queue.length) {
        const entry = queue[index++];
        active++;
        transcribeOne(entry, args)
          .catch((err) => {
            failures.push(`${entry.id}: ${err.message}`);
          })
          .finally(() => {
            active--;
            next();
            if (active === 0 && index >= queue.length) resolve();
          });
      }
      if (active === 0 && index >= queue.length) resolve();
    }
    next();
  });

  if (failures.length > 0) {
    console.error('\nFailed entries:');
    for (const f of failures) console.error(`  ✗ ${f}`);
    process.exit(1);
  }
}

async function main() {
  const args = parseArgs();

  if (args.help) {
    showHelp();
    process.exit(0);
  }

  if (!args.dryRun) {
    checkPrerequisite('whisper', 'pip install openai-whisper');
    checkPrerequisite('yt-dlp', 'pip install yt-dlp   OR   brew install yt-dlp');
  }

  const types: Array<'music' | 'videos'> =
    args.type === 'all' ? ['music', 'videos'] : [args.type];

  const allEntries: ContentEntry[] = [];
  for (const t of types) allEntries.push(...scanContentDir(t));

  if (allEntries.length === 0) {
    console.log('✓ No entries need transcription (all have transcripts or no playable URL).');
    return;
  }

  console.log(`Found ${allEntries.length} entries needing transcription:`);
  for (const e of allEntries) {
    console.log(`  [${e.contentType}] ${e.id}  →  ${e.mediaUrl}`);
  }

  if (args.dryRun) {
    console.log('\n(dry-run — not executing)');
    return;
  }

  console.log(`\nStarting transcription (model: ${args.model}, concurrency: ${args.concurrency})...\n`);
  await runQueue(allEntries, args);
  console.log('\n✓ All done.');
}

main().catch((err) => {
  console.error('[transcribe-missing] Unexpected error:', err);
  process.exit(1);
});
