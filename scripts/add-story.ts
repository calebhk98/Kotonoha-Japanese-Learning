#!/usr/bin/env npx tsx

/**
 * CLI tool to add new stories to the story collection.
 *
 * Usage:
 *   npx tsx scripts/add-story.ts --title "Story Title" --description "Description"
 *   npx tsx scripts/add-story.ts --help
 */

import fs from 'fs';
import path from 'path';

interface StoryArgs {
  title?: string;
  description?: string;
  level?: string;
  imageUrl?: string;
  help?: boolean;
}

function parseArgs(): StoryArgs {
  const args: StoryArgs = {};

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
📖 Add New Story

Usage: npx tsx scripts/add-story.ts [options]

Options:
  --title TEXT          Story title (required)
  --description TEXT    Story description (required)
  --level LEVEL         Difficulty level: n5, n4, n3, etc. (optional)
  --imageUrl URL        URL to story image (optional)
  --help                Show this help message

Examples:
  npx tsx scripts/add-story.ts --title "My Story" --description "A simple story"
  npx tsx scripts/add-story.ts --title "Tokyo" --description "A trip to Tokyo" --level n5
`);
}

function sanitizeFolderName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function generateId(): string {
  // Generate ID from timestamp (e.g., "story-1714816745")
  return `story-${Date.now()}`;
}

async function addStory(args: StoryArgs) {
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

  const storiesDir = path.join(process.cwd(), 'src', 'stories');
  const folderName = sanitizeFolderName(args.title);
  const storyPath = path.join(storiesDir, folderName);

  // Check if story already exists
  if (fs.existsSync(storyPath)) {
    console.error(`❌ Error: Story "${folderName}" already exists at ${storyPath}`);
    process.exit(1);
  }

  try {
    // Create stories directory if needed
    if (!fs.existsSync(storiesDir)) {
      fs.mkdirSync(storiesDir, { recursive: true });
    }

    // Create story directory
    fs.mkdirSync(storyPath, { recursive: true });

    // Create metadata.json
    const metadata = {
      id: generateId(),
      title: args.title,
      type: 'story',
      description: args.description,
      ...(args.level && { level: args.level }),
      ...(args.imageUrl && { imageUrl: args.imageUrl }),
      dateAdded: new Date().toISOString(),
    };

    fs.writeFileSync(
      path.join(storyPath, 'metadata.json'),
      JSON.stringify(metadata, null, 2)
    );

    // Create template content.md
    const content = `# ${args.title}

あなたのストーリーをここに書いてください。

このファイルはマークダウン形式です。
`;

    fs.writeFileSync(
      path.join(storyPath, 'content.md'),
      content
    );

    console.log('\n✅ Story created successfully!\n');
    console.log(`📁 Location: ${storyPath}`);
    console.log(`📝 ID: ${metadata.id}`);
    console.log(`📖 Title: ${args.title}`);
    console.log(`\n📄 Files created:`);
    console.log(`  • metadata.json - Story metadata`);
    console.log(`  • content.md - Story content (edit this file)`);
    console.log(`\n💡 Next steps:`);
    console.log(`  1. Edit ${storyPath}/content.md with your story`);
    console.log(`  2. Run the tests to verify: npx tsx test-stories-quick.ts`);
  } catch (error) {
    console.error(`❌ Error creating story: ${error}`);
    process.exit(1);
  }
}

const args = parseArgs();

if (args.help) {
  showHelp();
} else {
  addStory(args);
}
