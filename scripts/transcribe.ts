#!/usr/bin/env npx tsx

/**
 * Transcribes Japanese audio/video to a draft transcript.md using yt-dlp + Whisper.
 *
 * Usage:
 *   npx tsx scripts/transcribe.ts <youtube-url-or-local-file> [options]
 *
 * Options:
 *   --output <path>      Write transcript to this file (default: print to stdout)
 *   --model <name>       Whisper model: tiny/base/small/medium/large/large-v3 (default: large-v3)
 *   --language <code>    Language code (default: ja)
 *   --timestamps         Include SRT-style timestamps in output
 *   --help               Show this help
 *
 * Prerequisites (install once):
 *   pip install openai-whisper   # or: pip install faster-whisper
 *   pip install yt-dlp           # or: brew install yt-dlp
 *
 * Examples:
 *   npx tsx scripts/transcribe.ts "https://www.youtube.com/watch?v=XXXX"
 *   npx tsx scripts/transcribe.ts "https://www.youtube.com/watch?v=XXXX" --output src/music/MySong/transcript.md
 *   npx tsx scripts/transcribe.ts ./audio.mp3 --model medium --timestamps
 */

import { execSync, spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

interface Args {
  input?: string;
  output?: string;
  model: string;
  language: string;
  timestamps: boolean;
  help: boolean;
}

function parseArgs(): Args {
  const args: Args = { model: 'large-v3', language: 'ja', timestamps: false, help: false };
  const argv = process.argv.slice(2);

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') { args.help = true; }
    else if (a === '--output' && argv[i + 1]) { args.output = argv[++i]; }
    else if (a === '--model' && argv[i + 1]) { args.model = argv[++i]; }
    else if (a === '--language' && argv[i + 1]) { args.language = argv[++i]; }
    else if (a === '--timestamps') { args.timestamps = true; }
    else if (!a.startsWith('--')) { args.input = a; }
  }
  return args;
}

function showHelp() {
  console.log(`
Usage: npx tsx scripts/transcribe.ts <url-or-file> [options]

Transcribes a YouTube URL or local audio/video file to a draft transcript
using OpenAI Whisper. Output is formatted as transcript.md for use in
src/music/ or src/videos/ content entries.

Options:
  --output <path>    Write to file instead of stdout
  --model <name>     Whisper model (default: large-v3)
                     Tradeoff: larger = more accurate, slower to load
                     Sizes: tiny · base · small · medium · large · large-v3
  --language <code>  Language (default: ja)
  --timestamps       Include timestamps in output (SRT-style)
  --help             Show this help

Prerequisites:
  pip install openai-whisper
  pip install yt-dlp        (or: brew install yt-dlp)

NOTE: Transcription output is a draft. Review carefully before committing:
  - Japanese homophones cause kanji errors (e.g. 橋/箸, 春/晴)
  - Copyrighted songs are still copyrighted even after transcription
  - Accuracy is best on clear vocals with minimal accompaniment
`);
}

function checkPrerequisite(cmd: string, installHint: string): void {
  const result = spawnSync(cmd, ['--version'], { encoding: 'utf8' });
  if (result.error || result.status !== 0) {
    console.error(`✗ '${cmd}' not found. Install with: ${installHint}`);
    process.exit(1);
  }
}

function isUrl(input: string): boolean {
  return /^https?:\/\//.test(input);
}

function downloadAudio(url: string, tmpDir: string): string {
  console.error(`[transcribe] Downloading audio from: ${url}`);
  const outTemplate = path.join(tmpDir, 'audio.%(ext)s');

  const result = spawnSync(
    'yt-dlp',
    ['-x', '--audio-format', 'wav', '--audio-quality', '0', '-o', outTemplate, url],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
  );

  if (result.status !== 0) {
    console.error('[transcribe] yt-dlp failed:');
    console.error(result.stderr);
    process.exit(1);
  }

  const wavFile = path.join(tmpDir, 'audio.wav');
  if (!fs.existsSync(wavFile)) {
    // yt-dlp may not always convert to wav cleanly; look for any audio file
    const files = fs.readdirSync(tmpDir);
    const audioFile = files.find(f => /\.(wav|mp3|m4a|opus|webm)$/.test(f));
    if (!audioFile) {
      console.error('[transcribe] No audio file found after yt-dlp download.');
      process.exit(1);
    }
    return path.join(tmpDir, audioFile);
  }
  return wavFile;
}

function runWhisper(audioFile: string, args: Args, tmpDir: string): string {
  const outputFormat = args.timestamps ? 'srt' : 'txt';
  console.error(`[transcribe] Running Whisper (model: ${args.model}, lang: ${args.language}) ...`);
  console.error('[transcribe] This may take a minute on first run while the model downloads.');

  const result = spawnSync(
    'whisper',
    [
      audioFile,
      '--model', args.model,
      '--language', args.language,
      '--output_format', outputFormat,
      '--output_dir', tmpDir,
      '--verbose', 'False',
    ],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
  );

  if (result.status !== 0) {
    console.error('[transcribe] Whisper failed:');
    console.error(result.stderr);
    process.exit(1);
  }

  const baseName = path.basename(audioFile, path.extname(audioFile));
  const outFile = path.join(tmpDir, `${baseName}.${outputFormat}`);
  if (!fs.existsSync(outFile)) {
    console.error(`[transcribe] Expected output file not found: ${outFile}`);
    console.error('[transcribe] Whisper stdout:', result.stdout);
    process.exit(1);
  }
  return fs.readFileSync(outFile, 'utf8');
}

function formatTranscript(raw: string, timestamps: boolean): string {
  if (timestamps) {
    // SRT → keep as-is with a header comment
    return `# Transcript (with timestamps — edit into verses before committing)\n\n${raw.trim()}\n`;
  }

  // Plain text: split on sentence-ending punctuation and blank lines to guess verse breaks.
  // Whisper plain-text output puts each segment on its own line.
  const lines = raw
    .split('\n')
    .map(l => l.trim())
    .filter(l => l.length > 0);

  if (lines.length === 0) {
    return '# (no transcript produced — check audio quality)\n';
  }

  // Group into rough verses: treat a run of lines ending with 。or ♪ as a verse boundary.
  const verses: string[][] = [];
  let current: string[] = [];

  for (const line of lines) {
    current.push(line);
    // Break verse after lines that end with 。or ♪ (common in song lyrics)
    if (/[。♪]$/.test(line)) {
      verses.push(current);
      current = [];
    }
  }
  if (current.length > 0) verses.push(current);

  const header = `# Draft transcript — REVIEW BEFORE COMMITTING\n# Whisper output needs human correction (kanji homophones, verse breaks).\n\n`;

  if (verses.length <= 1) {
    // No natural verse breaks found — just output lines
    return header + lines.join('\n') + '\n';
  }

  return header + verses.map(v => v.join('\n')).join('\n\n') + '\n';
}

async function main() {
  const args = parseArgs();

  if (args.help || !args.input) {
    showHelp();
    process.exit(args.help ? 0 : 1);
  }

  // Check prerequisites
  checkPrerequisite('whisper', 'pip install openai-whisper');
  if (isUrl(args.input)) {
    checkPrerequisite('yt-dlp', 'pip install yt-dlp   OR   brew install yt-dlp');
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kotonoha-transcribe-'));

  try {
    let audioFile: string;

    if (isUrl(args.input)) {
      audioFile = downloadAudio(args.input, tmpDir);
    } else {
      if (!fs.existsSync(args.input)) {
        console.error(`[transcribe] File not found: ${args.input}`);
        process.exit(1);
      }
      audioFile = path.resolve(args.input);
    }

    const rawOutput = runWhisper(audioFile, args, tmpDir);
    const transcript = formatTranscript(rawOutput, args.timestamps);

    if (args.output) {
      const outDir = path.dirname(path.resolve(args.output));
      fs.mkdirSync(outDir, { recursive: true });
      fs.writeFileSync(args.output, transcript, 'utf8');
      console.error(`[transcribe] Transcript written to: ${args.output}`);
      console.error('[transcribe] Remember to review for kanji errors before committing.');
    } else {
      process.stdout.write(transcript);
    }
  } finally {
    // Clean up temp files
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

main().catch(err => {
  console.error('[transcribe] Unexpected error:', err);
  process.exit(1);
});
