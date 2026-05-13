#!/usr/bin/env npx tsx

/**
 * Index copyrighted content for vocabulary analysis.
 *
 * Takes Japanese text via stdin or --file, tokenizes it with Sudachi WASM,
 * deduplicates the surface tokens by frequency, and writes them (one per line,
 * most-frequent first) to a content.md inside a new story directory.
 *
 * The original text is never written anywhere — only the unique surface tokens
 * are stored, which is the same output the server's tokenizer would produce if
 * it saw the original text.
 *
 * Usage:
 *   cat source.txt | npx tsx scripts/index-copyrighted.ts \
 *     --title "よつばと！第1話" \
 *     --description "よつばが引っ越してくる日。" \
 *     --level n4 \
 *     --source-url "https://mangaplus.shueisha.co.jp/..." \
 *     --source-name "Manga Plus"
 *
 *   npx tsx scripts/index-copyrighted.ts \
 *     --file ./raw-text.txt \
 *     --title "NHK Web Easy — 2024-05-10" \
 *     --source-url "https://www3.nhk.or.jp/news/easy/..." \
 *     --source-name "NHK Web Easy"
 */

import fs from 'fs';
import path from 'path';
import { createTokenizer } from '../src/lib/tokenizers.js';

interface Args {
  title?: string;
  description?: string;
  level?: string;
  sourceUrl?: string;
  sourceName?: string;
  file?: string;
  help?: boolean;
}

function parseArgs(): Args {
  const args: Args = {};
  const argv = process.argv.slice(2);

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      args.help = true;
    } else if (arg === '--title' && argv[i + 1]) {
      args.title = argv[++i];
    } else if (arg === '--description' && argv[i + 1]) {
      args.description = argv[++i];
    } else if (arg === '--level' && argv[i + 1]) {
      args.level = argv[++i];
    } else if (arg === '--source-url' && argv[i + 1]) {
      args.sourceUrl = argv[++i];
    } else if (arg === '--source-name' && argv[i + 1]) {
      args.sourceName = argv[++i];
    } else if (arg === '--file' && argv[i + 1]) {
      args.file = argv[++i];
    }
  }

  return args;
}

function showHelp() {
  console.log(`
Index Copyrighted Content

Tokenizes Japanese text and stores only the unique surface tokens in content.md.
The original text is never written to disk.

Usage:
  cat source.txt | npx tsx scripts/index-copyrighted.ts [options]
  npx tsx scripts/index-copyrighted.ts --file source.txt [options]

Required:
  --title TEXT          Content title (used for directory name and metadata)
  --source-url URL      Official URL where users will be sent to read
  --source-name TEXT    Display name of the source (e.g. "Manga Plus", "NHK Web Easy")

Optional:
  --description TEXT    Short description of the content
  --level LEVEL         Difficulty level: n5, n4, n3, n2, n1
  --file PATH           Read input text from a file instead of stdin

  --help                Show this help

Examples:
  cat chapter1.txt | npx tsx scripts/index-copyrighted.ts \\
    --title "よつばと！第1話" \\
    --description "よつばが引っ越してくる日。" \\
    --level n4 \\
    --source-url "https://mangaplus.shueisha.co.jp/viewer/1234" \\
    --source-name "Manga Plus"

  npx tsx scripts/index-copyrighted.ts \\
    --file article.txt \\
    --title "NHK Web Easy — 気候変動について" \\
    --level n4 \\
    --source-url "https://www3.nhk.or.jp/news/easy/k10012345678000.html" \\
    --source-name "NHK Web Easy"
`);
}

function sanitizeFolderName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    if (process.stdin.isTTY) {
      reject(new Error('No input: pipe text via stdin or use --file'));
      return;
    }
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', chunk => { data += chunk; });
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', reject);
  });
}

async function run(args: Args) {
  if (!args.title) {
    console.error('Error: --title is required');
    process.exit(1);
  }
  if (!args.sourceUrl) {
    console.error('Error: --source-url is required');
    process.exit(1);
  }
  if (!args.sourceName) {
    console.error('Error: --source-name is required');
    process.exit(1);
  }

  // Read source text
  let text: string;
  if (args.file) {
    const filePath = path.resolve(args.file);
    if (!fs.existsSync(filePath)) {
      console.error(`Error: file not found: ${filePath}`);
      process.exit(1);
    }
    text = fs.readFileSync(filePath, 'utf8');
  } else {
    text = await readStdin();
  }

  text = text.trim();
  if (!text) {
    console.error('Error: input text is empty');
    process.exit(1);
  }

  const hasJapanese = /[぀-ゟ゠-ヿ一-鿿]/.test(text);
  if (!hasJapanese) {
    console.error('Error: input does not appear to contain Japanese text');
    process.exit(1);
  }

  console.log(`[index-copyrighted] Initializing Sudachi WASM tokenizer...`);
  const tokenizer = await createTokenizer('sudachi-wasm');

  console.log(`[index-copyrighted] Tokenizing ${text.length} characters...`);
  const tokens = await tokenizer.segment(text);
  console.log(`[index-copyrighted] Got ${tokens.length} raw tokens`);

  // Count frequency of each unique surface form
  const freq = new Map<string, number>();
  for (const t of tokens) {
    const s = t.surface.trim();
    if (!s) continue;
    freq.set(s, (freq.get(s) ?? 0) + 1);
  }

  // Sort by frequency descending
  const sorted = Array.from(freq.entries()).sort((a, b) => b[1] - a[1]);
  const uniqueSurfaces = sorted.map(([surface]) => surface);

  console.log(`[index-copyrighted] ${uniqueSurfaces.length} unique surface tokens (from ${tokens.length} total)`);

  // Create story directory
  const storiesDir = path.join(process.cwd(), 'src', 'stories');
  const folderName = sanitizeFolderName(args.title);
  const storyPath = path.join(storiesDir, folderName);

  if (fs.existsSync(storyPath)) {
    console.error(`Error: directory already exists: ${storyPath}`);
    console.error('Remove it first or choose a different title.');
    process.exit(1);
  }

  fs.mkdirSync(storyPath, { recursive: true });

  // Write metadata.json
  const metadata: Record<string, unknown> = {
    id: `story-${Date.now()}`,
    title: args.title,
    type: 'story',
    copyrighted: true,
    sourceUrl: args.sourceUrl,
    sourceName: args.sourceName,
    description: args.description ?? '',
    dateAdded: new Date().toISOString(),
  };
  if (args.level) metadata.level = args.level;

  fs.writeFileSync(
    path.join(storyPath, 'metadata.json'),
    JSON.stringify(metadata, null, 2)
  );

  // Write content.md — unique surface tokens only, one per line
  // This file intentionally contains no sentences or story text.
  const contentLines = uniqueSurfaces.join('\n');
  fs.writeFileSync(path.join(storyPath, 'content.md'), contentLines + '\n');

  console.log(`\n[index-copyrighted] Done.`);
  console.log(`  Directory : ${storyPath}`);
  console.log(`  Tokens    : ${uniqueSurfaces.length} unique surface forms`);
  console.log(`  Source    : ${args.sourceName} — ${args.sourceUrl}`);
  console.log(`\nThe original text was not written anywhere.`);
}

const args = parseArgs();

if (args.help) {
  showHelp();
} else {
  run(args).catch(err => {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  });
}
