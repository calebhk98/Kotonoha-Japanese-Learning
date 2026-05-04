import fs from 'fs';
import path from 'path';
import { Content } from '../data/content';

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

/**
 * Load all stories from the stories directory.
 * Each story should be in a folder with:
 * - metadata.json (story metadata)
 * - content.md (story content in markdown)
 *
 * @returns Array of Content objects with loaded story data
 */
export function loadStoriesFromDisk(): Content[] {
  const storiesDir = path.join(process.cwd(), 'src', 'stories');

  // Return empty array if stories directory doesn't exist yet
  if (!fs.existsSync(storiesDir)) {
    return [];
  }

  const stories: Content[] = [];
  const storyFolders = fs.readdirSync(storiesDir).filter(file => {
    const fullPath = path.join(storiesDir, file);
    return fs.statSync(fullPath).isDirectory();
  });

  for (const folder of storyFolders) {
    const folderPath = path.join(storiesDir, folder);
    const metadataPath = path.join(folderPath, 'metadata.json');
    const contentPath = path.join(folderPath, 'content.md');

    // Skip if metadata or content file is missing
    if (!fs.existsSync(metadataPath) || !fs.existsSync(contentPath)) {
      console.warn(`⚠️  Skipping ${folder}: missing metadata.json or content.md`);
      continue;
    }

    try {
      const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf-8')) as StoryMetadata;
      const text = fs.readFileSync(contentPath, 'utf-8');

      stories.push({
        id: metadata.id,
        title: metadata.title,
        type: 'story',
        description: metadata.description,
        text: text.trim(),
        imageUrl: metadata.imageUrl,
      });
    } catch (error) {
      console.warn(`⚠️  Error loading story from ${folder}:`, error);
    }
  }

  return stories.sort((a, b) => a.id.localeCompare(b.id));
}
