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
  parentId?: string;
  seriesId?: string;
  episodeNumber?: number;
  variantType?: string;
  relatedStories?: string;
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
    } else if (arg === '--parentId' && i + 1 < process.argv.length) {
      args.parentId = process.argv[++i];
    } else if (arg === '--seriesId' && i + 1 < process.argv.length) {
      args.seriesId = process.argv[++i];
    } else if (arg === '--episodeNumber' && i + 1 < process.argv.length) {
      args.episodeNumber = parseInt(process.argv[++i], 10);
    } else if (arg === '--variantType' && i + 1 < process.argv.length) {
      args.variantType = process.argv[++i];
    } else if (arg === '--relatedStories' && i + 1 < process.argv.length) {
      args.relatedStories = process.argv[++i];
    }
  }

  return args;
}

function showHelp() {
  console.log(`
📖 Add New Story

Usage: npx tsx scripts/add-story.ts [options]

Required Options:
  --title TEXT          Story title
  --description TEXT    Story description

Optional Options:
  --level LEVEL         Difficulty level: n5, n4, n3, etc.
  --imageUrl URL        URL to story image

Story Relationships:
  --parentId ID         Link to parent story (for episodes/variants of a single story)
  --seriesId ID         Link to a series (for independent episodes in a series like Pokemon)
  --episodeNumber NUM   Episode number for ordering (use with parentId)
  --variantType TYPE    Type of variant: kanji, hiragana, simplified, full, etc.
  --relatedStories JSON JSON array of related story objects
                        Example: '[{"id":"story-123","type":"variant","description":"Kanji version"}]'

  --help                Show this help message

Examples:
  npx tsx scripts/add-story.ts --title "My Story" --description "A simple story"

  npx tsx scripts/add-story.ts \\
    --title "浦島太郎 Part 1" \\
    --description "The first episode of Urashima Taro" \\
    --parentId "story-parent-id" \\
    --episodeNumber 1

  npx tsx scripts/add-story.ts \\
    --title "Pokemon Episode 1" \\
    --description "Pikachu appears" \\
    --seriesId "series-pokemon-id"

  npx tsx scripts/add-story.ts \\
    --title "Art Class (hiragana)" \\
    --description "Art class with hiragana text" \\
    --parentId "story-art-class-id" \\
    --variantType "hiragana"
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

  let relatedStories: Array<{ id: string; type: string; description?: string }> | undefined;
  if (args.relatedStories) {
    try {
      relatedStories = JSON.parse(args.relatedStories);
    } catch (error) {
      console.error('❌ Error: Invalid JSON in --relatedStories');
      console.log(`Error: ${error}`);
      process.exit(1);
    }
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
    const metadata: Record<string, unknown> = {
      id: generateId(),
      title: args.title,
      type: 'story',
      description: args.description,
      dateAdded: new Date().toISOString(),
    };

    if (args.level) metadata.level = args.level;
    if (args.imageUrl) metadata.imageUrl = args.imageUrl;
    if (args.parentId) metadata.parentId = args.parentId;
    if (args.seriesId) metadata.seriesId = args.seriesId;
    if (args.episodeNumber !== undefined) metadata.episodeNumber = args.episodeNumber;
    if (args.variantType) metadata.variantType = args.variantType;
    if (relatedStories) metadata.relatedStories = relatedStories;

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

    if (args.parentId) {
      if (args.episodeNumber !== undefined) {
        console.log(`🎬 Episode: ${args.episodeNumber}`);
      } else if (args.variantType) {
        console.log(`🔄 Variant: ${args.variantType}`);
      }
      console.log(`👁️ Parent Story ID: ${args.parentId}`);
    }

    if (args.seriesId) {
      console.log(`📺 Series ID: ${args.seriesId}`);
    }

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
