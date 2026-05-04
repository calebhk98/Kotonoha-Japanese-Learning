/**
 * Migration script: Convert existing stories from src/data/content.ts
 * to the new file-based storage format in src/stories/
 *
 * Usage: npx tsx scripts/migrate-stories.ts
 */

import fs from 'fs';
import path from 'path';
import { INITIAL_CONTENT } from '../src/data/content';

interface StoryMetadata {
  id: string;
  title: string;
  type: 'story';
  description: string;
  level?: string;
  imageUrl?: string;
  tags?: string[];
  author?: string;
  dateAdded?: string;
}

function sanitizeFolderName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

async function migrateStories() {
  const storiesDir = path.join(process.cwd(), 'src', 'stories');

  // Create stories directory if it doesn't exist
  if (!fs.existsSync(storiesDir)) {
    fs.mkdirSync(storiesDir, { recursive: true });
    console.log(`✓ Created ${storiesDir}`);
  }

  let migratedCount = 0;
  let skippedCount = 0;

  for (const item of INITIAL_CONTENT) {
    // Only migrate story type
    if (item.type !== 'story') {
      skippedCount++;
      continue;
    }

    // Create folder name from title
    const folderName = sanitizeFolderName(item.title);
    const storyPath = path.join(storiesDir, folderName);

    // Skip if already exists
    if (fs.existsSync(storyPath)) {
      console.log(`⊘ Skipped (already exists): ${item.title}`);
      skippedCount++;
      continue;
    }

    try {
      // Create story directory
      fs.mkdirSync(storyPath, { recursive: true });

      // Create metadata.json
      const metadata: StoryMetadata = {
        id: item.id,
        title: item.title,
        type: 'story',
        description: item.description,
        imageUrl: item.imageUrl,
        dateAdded: new Date().toISOString(),
      };

      fs.writeFileSync(
        path.join(storyPath, 'metadata.json'),
        JSON.stringify(metadata, null, 2)
      );

      // Create content.md
      fs.writeFileSync(
        path.join(storyPath, 'content.md'),
        item.text
      );

      console.log(`✓ Migrated: ${item.title}`);
      migratedCount++;
    } catch (error) {
      console.error(`✗ Error migrating ${item.title}:`, error);
      skippedCount++;
    }
  }

  console.log(`\n${'='.repeat(60)}`);
  console.log(`Migration Complete!`);
  console.log(`${'='.repeat(60)}`);
  console.log(`✓ Migrated: ${migratedCount} stories`);
  console.log(`⊘ Skipped: ${skippedCount} items (non-stories or duplicates)`);
  console.log(`\nNext steps:`);
  console.log(`1. Update src/data/content.ts to use the new loader`);
  console.log(`2. Test that stories load correctly`);
  console.log(`3. Optionally keep the old INITIAL_CONTENT as fallback\n`);
}

migrateStories().catch(console.error);
