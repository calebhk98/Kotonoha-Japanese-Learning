import fs from 'fs';
import path from 'path';
import { runInNewContext } from 'vm';

interface ContentItem {
  id: string;
  title: string;
  type: 'story' | 'music' | 'video';
  description: string;
  text: string;
  mediaUrl?: string;
  imageUrl?: string;
  level?: string;
  tags?: string[];
  author?: string;
  dateAdded?: string;
}

// Read and parse INITIAL_CONTENT from content.ts by extracting and evaluating it
function readContentFile(): ContentItem[] {
  const contentPath = path.join(process.cwd(), 'src/data/content.ts');
  let content = fs.readFileSync(contentPath, 'utf-8');

  // Find the array content
  const startIdx = content.indexOf('export const INITIAL_CONTENT');
  const equalsIdx = content.indexOf('=', startIdx);
  const bracketStart = content.indexOf('[', equalsIdx);

  // Find the closing bracket by counting brackets
  let bracketCount = 0;
  let closing = -1;
  for (let i = bracketStart; i < content.length; i++) {
    if (content[i] === '[') bracketCount++;
    if (content[i] === ']') {
      bracketCount--;
      if (bracketCount === 0) {
        closing = i;
        break;
      }
    }
  }

  if (closing === -1) {
    throw new Error('Could not find closing ] for INITIAL_CONTENT');
  }

  // Extract just the array (from [ to the matching ])
  const arrayContent = content.substring(bracketStart, closing + 1);

  // Use vm to safely evaluate the JavaScript array
  try {
    // Clean up the array content - remove anything after the closing bracket
    let cleanArray = arrayContent;
    const lastBracket = cleanArray.lastIndexOf(']');
    if (lastBracket !== -1) {
      cleanArray = cleanArray.substring(0, lastBracket + 1);
    }

    // Create a sandbox context
    const sandbox = { result: null };

    // Evaluate the array using vm
    const code = `result = ${cleanArray}`;
    runInNewContext(code, sandbox);
    const items = sandbox.result as ContentItem[];
    return items;
  } catch (error) {
    console.error('Failed to parse INITIAL_CONTENT:', error);
    throw error;
  }
}

// Read and parse GENERATED_CONTENT from content.ts
function readGeneratedContent(): ContentItem[] {
  const contentPath = path.join(process.cwd(), 'src/data/content.ts');
  let content = fs.readFileSync(contentPath, 'utf-8');

  // Find the array content
  const startIdx = content.indexOf('export const GENERATED_CONTENT');
  if (startIdx === -1) {
    return []; // No GENERATED_CONTENT
  }

  const equalsIdx = content.indexOf('=', startIdx);
  const bracketStart = content.indexOf('[', equalsIdx);

  // Find the closing bracket by counting brackets
  let bracketCount = 0;
  let closing = -1;
  for (let i = bracketStart; i < content.length; i++) {
    if (content[i] === '[') bracketCount++;
    if (content[i] === ']') {
      bracketCount--;
      if (bracketCount === 0) {
        closing = i;
        break;
      }
    }
  }

  if (closing === -1) {
    throw new Error('Could not find closing ] for GENERATED_CONTENT');
  }

  // Extract just the array
  const arrayContent = content.substring(bracketStart, closing + 1);

  // Use vm to safely evaluate the JavaScript array
  try {
    let cleanArray = arrayContent;
    const lastBracket = cleanArray.lastIndexOf(']');
    if (lastBracket !== -1) {
      cleanArray = cleanArray.substring(0, lastBracket + 1);
    }

    const sandbox = { result: null };
    const code = `result = ${cleanArray}`;
    runInNewContext(code, sandbox);
    return sandbox.result as ContentItem[];
  } catch (error) {
    console.error('Failed to parse GENERATED_CONTENT:', error);
    throw error;
  }
}

async function migrateContent() {
  console.log('Starting content migration...');
  const INITIAL_CONTENT = readContentFile();
  const GENERATED_CONTENT = readGeneratedContent();
  const ALL_CONTENT = [...INITIAL_CONTENT, ...GENERATED_CONTENT];
  console.log(`Found ${INITIAL_CONTENT.length} INITIAL items, ${GENERATED_CONTENT.length} GENERATED items`)
  console.log(`Total: ${ALL_CONTENT.length} items to migrate`);

  const results = {
    stories: 0,
    music: 0,
    videos: 0,
    errors: [] as string[],
  };

  for (const item of ALL_CONTENT) {
    try {
      const contentItem = item as ContentItem;
      const typeDir = contentItem.type === 'story' ? 'stories' : contentItem.type === 'music' ? 'music' : 'videos';
      const itemDir = path.join(process.cwd(), 'src', typeDir, contentItem.id);

      // Create directory
      if (!fs.existsSync(itemDir)) {
        fs.mkdirSync(itemDir, { recursive: true });
      }

      // Create metadata.json
      const metadata = {
        id: contentItem.id,
        title: contentItem.title,
        type: contentItem.type,
        description: contentItem.description,
        ...(contentItem.level && { level: contentItem.level }),
        ...(contentItem.imageUrl && { imageUrl: contentItem.imageUrl }),
        ...(contentItem.mediaUrl && { mediaUrl: contentItem.mediaUrl }),
        ...(contentItem.tags && contentItem.tags.length > 0 && { tags: contentItem.tags }),
        ...(contentItem.author && { author: contentItem.author }),
        ...(contentItem.dateAdded && { dateAdded: contentItem.dateAdded }),
      };

      const metadataPath = path.join(itemDir, 'metadata.json');
      fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));

      // Create content file (content.md for stories, transcript.md for music/videos)
      const contentFileName = contentItem.type === 'story' ? 'content.md' : 'transcript.md';
      const contentPath = path.join(itemDir, contentFileName);
      fs.writeFileSync(contentPath, contentItem.text);

      // Verify files were written correctly
      const metadataStats = fs.statSync(metadataPath);
      const contentStats = fs.statSync(contentPath);

      if (metadataStats.size === 0 || contentStats.size === 0) {
        results.errors.push(
          `${contentItem.type}/${contentItem.id}: File size is 0 (metadata: ${metadataStats.size}B, content: ${contentStats.size}B)`
        );
      }

      // Count by type
      if (contentItem.type === 'story') {
        results.stories++;
      } else if (contentItem.type === 'music') {
        results.music++;
      } else if (contentItem.type === 'video') {
        results.videos++;
      }

      process.stdout.write('.');
    } catch (error) {
      results.errors.push(`${item.id}: ${error instanceof Error ? error.message : String(error)}`);
      console.error(`\n✗ Error migrating ${item.id}:`, error);
    }
  }

  // Print summary
  console.log('\n\n========== MIGRATION SUMMARY ==========');
  console.log(`Stories: ${results.stories}`);
  console.log(`Music: ${results.music}`);
  console.log(`Videos: ${results.videos}`);
  console.log(`Total: ${results.stories + results.music + results.videos}/${ALL_CONTENT.length}`);

  if (results.errors.length > 0) {
    console.log('\n⚠️  ERRORS:');
    results.errors.forEach(err => console.log(`  - ${err}`));
    process.exit(1);
  } else {
    console.log('\n✅ Migration completed successfully!');
  }
}

migrateContent().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
