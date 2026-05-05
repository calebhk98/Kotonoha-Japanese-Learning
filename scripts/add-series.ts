#!/usr/bin/env npx tsx

/**
 * CLI tool to add new series to the series collection.
 *
 * Usage:
 *   npx tsx scripts/add-series.ts --title "Series Title" --description "Description"
 *   npx tsx scripts/add-series.ts --help
 */

import fs from 'fs';
import path from 'path';

interface SeriesArgs {
  title?: string;
  description?: string;
  level?: string;
  imageUrl?: string;
  help?: boolean;
}

function parseArgs(): SeriesArgs {
  const args: SeriesArgs = {};

  for (let i = 2; i < process.argv.length; i++) {
    const arg = process.argv[i];

    if (arg === '--help' || arg === '-h') {
      args.help = true;
    } else if (arg === '--title' && i + 1 < process.argv.length) {
      args.title = process.argv[++i];
    } else if (arg === '--description' && i + 1 < process.argv.length) {
      args.description = process.argv[++i];
    } else if (arg === '--level' && i + 1 < process.argv.length) {
      args.level = process.argv[++i];
    } else if (arg === '--imageUrl' && i + 1 < process.argv.length) {
      args.imageUrl = process.argv[++i];
    }
  }

  return args;
}

function showHelp() {
  console.log(`
📺 Add New Series

Usage: npx tsx scripts/add-series.ts [options]

Required Options:
  --title TEXT          Series title
  --description TEXT    Series description

Optional Options:
  --level LEVEL         Difficulty level: n5, n4, n3, etc.
  --imageUrl URL        URL to series image

  --help                Show this help message

Examples:
  npx tsx scripts/add-series.ts \\
    --title "Pokemon Adventure" \\
    --description "A series of Pokemon adventures"

  npx tsx scripts/add-series.ts \\
    --title "Naruto" \\
    --description "Follow Naruto's ninja journey" \\
    --level n3 \\
    --imageUrl "https://example.com/naruto.jpg"

After creating a series, add episodes with:
  npx tsx scripts/add-story.ts \\
    --title "Pokemon Episode 1" \\
    --description "The first episode" \\
    --seriesId SERIES_ID
`);
}

function sanitizeFolderName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function generateId(): string {
  return `series-${Date.now()}`;
}

async function addSeries(args: SeriesArgs) {
  // Validate inputs
  if (!args.title) {
    console.error('❌ Error: --title is required');
    console.log('\nUse --help for usage information');
    process.exit(1);
  }

  if (!args.description) {
    console.error('❌ Error: --description is required');
    console.log('\nUse --help for usage information');
    process.exit(1);
  }

  const seriesDir = path.join(process.cwd(), 'src', 'series');
  const folderName = sanitizeFolderName(args.title);
  const seriesPath = path.join(seriesDir, folderName);

  // Check if series already exists
  if (fs.existsSync(seriesPath)) {
    console.error(`❌ Error: Series "${folderName}" already exists at ${seriesPath}`);
    process.exit(1);
  }

  try {
    // Create series directory if needed
    if (!fs.existsSync(seriesDir)) {
      fs.mkdirSync(seriesDir, { recursive: true });
    }

    // Create series directory
    fs.mkdirSync(seriesPath, { recursive: true });

    // Create metadata.json
    const metadata: Record<string, unknown> = {
      id: generateId(),
      title: args.title,
      type: 'series',
      description: args.description,
      dateAdded: new Date().toISOString(),
    };

    if (args.level) metadata.level = args.level;
    if (args.imageUrl) metadata.imageUrl = args.imageUrl;

    fs.writeFileSync(
      path.join(seriesPath, 'metadata.json'),
      JSON.stringify(metadata, null, 2)
    );

    console.log('\n✅ Series created successfully!\n');
    console.log(`📁 Location: ${seriesPath}`);
    console.log(`📺 ID: ${metadata.id}`);
    console.log(`📖 Title: ${args.title}`);
    console.log(`\n📄 Files created:`);
    console.log(`  • metadata.json - Series metadata (no content.md needed)`);
    console.log(`\n💡 Next steps:`);
    console.log(`  1. Create episodes with:`);
    console.log(`     npx tsx scripts/add-story.ts --title "Episode 1" --seriesId ${metadata.id}`);
    console.log(`  2. Run the tests to verify: npx tsx test-stories-quick.ts`);
  } catch (error) {
    console.error(`❌ Error creating series: ${error}`);
    process.exit(1);
  }
}

const args = parseArgs();

if (args.help) {
  showHelp();
} else {
  addSeries(args);
}
