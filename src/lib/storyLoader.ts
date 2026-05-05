import fs from 'fs';
import path from 'path';
import { Content } from '../data/content';

interface RelatedStory {
  id: string;
  type: 'episode' | 'variant' | 'series';
  description?: string;
}

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
  parentId?: string;
  episodeNumber?: number;
  variantType?: 'kanji' | 'hiragana' | 'simplified' | 'full' | string;
  relatedStories?: RelatedStory[];
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

/**
 * Find related stories by ID
 * @param storyId The story ID to find relations for
 * @param allStories All loaded stories with metadata
 * @returns Object with episodes, variants, and series related to this story
 */
export function findRelatedStories(
  storyId: string,
  storiesWithMetadata: Array<{ story: Content; metadata: StoryMetadata }>
) {
  const story = storiesWithMetadata.find(s => s.story.id === storyId);
  if (!story) return { episodes: [], variants: [], series: [] };

  const episodes: Content[] = [];
  const variants: Content[] = [];
  const series: Content[] = [];

  const mainMetadata = story.metadata;

  for (const item of storiesWithMetadata) {
    if (item.story.id === storyId) continue;

    const meta = item.metadata;

    if (meta.parentId === storyId) {
      if (meta.variantType) {
        variants.push(item.story);
      } else if (meta.episodeNumber !== undefined) {
        episodes.push(item.story);
      }
    }

    if (mainMetadata.relatedStories?.some(r => r.id === item.story.id)) {
      if (meta.variantType) {
        variants.push(item.story);
      } else {
        series.push(item.story);
      }
    }
  }

  episodes.sort((a, b) => {
    const aNum = storiesWithMetadata.find(s => s.story.id === a.id)?.metadata.episodeNumber ?? 0;
    const bNum = storiesWithMetadata.find(s => s.story.id === b.id)?.metadata.episodeNumber ?? 0;
    return aNum - bNum;
  });

  return { episodes, variants, series };
}

/**
 * Get parent story if this is an episode or variant
 */
export function getParentStory(
  storyId: string,
  storiesWithMetadata: Array<{ story: Content; metadata: StoryMetadata }>
) {
  const story = storiesWithMetadata.find(s => s.story.id === storyId);
  if (!story?.metadata.parentId) return null;

  return storiesWithMetadata.find(s => s.story.id === story.metadata.parentId)?.story ?? null;
}
