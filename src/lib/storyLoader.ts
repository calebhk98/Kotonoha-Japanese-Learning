import fs from 'fs';
import path from 'path';
import { Content } from '../data/content';

interface RelatedContent {
  id: string;
  type: 'episode' | 'variant' | 'series';
  description?: string;
}

interface RelatedStory extends RelatedContent {}

interface SeriesMetadata {
  id: string;
  title: string;
  type: 'series';
  description: string;
  level?: string;
  imageUrl?: string;
  tags?: string[];
  author?: string;
  dateAdded?: string;
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
  // Relationships - use ONE of these, not both:
  // Use parentId for episodes/variants of a single story (e.g., Urashima Taro Part 1, Part 2)
  parentId?: string;
  // Use seriesId for independent episodes grouped into a series (e.g., Pokemon Episode 1, 2, 3)
  seriesId?: string;
  episodeNumber?: number;
  variantType?: 'kanji' | 'hiragana' | 'simplified' | 'full' | string;
  relatedStories?: RelatedStory[];
}

interface MusicMetadata {
  id: string;
  title: string;
  type: 'music';
  description: string;
  level?: string;
  imageUrl?: string;
  mediaUrl?: string;
  tags?: string[];
  artist?: string;
  dateAdded?: string;
}

interface VideoMetadata {
  id: string;
  title: string;
  type: 'video';
  description: string;
  level?: string;
  imageUrl?: string;
  mediaUrl?: string;
  tags?: string[];
  creator?: string;
  dateAdded?: string;
}

/**
 * Load all series from the series directory.
 * Each series should be in a folder with:
 * - metadata.json (series metadata only, no content.md needed)
 *
 * @returns Array of SeriesMetadata objects
 */
export function loadSeriesFromDisk(): SeriesMetadata[] {
  const seriesDir = path.join(process.cwd(), 'src', 'series');

  // Return empty array if series directory doesn't exist yet
  if (!fs.existsSync(seriesDir)) {
    return [];
  }

  const series: SeriesMetadata[] = [];
  const seriesFolders = fs.readdirSync(seriesDir).filter(file => {
    const fullPath = path.join(seriesDir, file);
    return fs.statSync(fullPath).isDirectory();
  });

  for (const folder of seriesFolders) {
    const folderPath = path.join(seriesDir, folder);
    const metadataPath = path.join(folderPath, 'metadata.json');

    // Skip if metadata file is missing
    if (!fs.existsSync(metadataPath)) {
      console.warn(`⚠️  Skipping series ${folder}: missing metadata.json`);
      continue;
    }

    try {
      const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf-8')) as SeriesMetadata;
      series.push(metadata);
    } catch (error) {
      console.warn(`⚠️  Error loading series from ${folder}:`, error);
    }
  }

  return series.sort((a, b) => a.id.localeCompare(b.id));
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
 * Load all music content from the music directory.
 * Each music item should be in a folder with:
 * - metadata.json (music metadata)
 * - transcript.md (lyrics or transcript in markdown)
 *
 * @returns Array of Content objects with loaded music data
 */
export function loadMusicFromDisk(): Content[] {
  const musicDir = path.join(process.cwd(), 'src', 'music');

  // Return empty array if music directory doesn't exist yet
  if (!fs.existsSync(musicDir)) {
    return [];
  }

  const music: Content[] = [];
  const musicFolders = fs.readdirSync(musicDir).filter(file => {
    const fullPath = path.join(musicDir, file);
    return fs.statSync(fullPath).isDirectory();
  });

  for (const folder of musicFolders) {
    const folderPath = path.join(musicDir, folder);
    const metadataPath = path.join(folderPath, 'metadata.json');
    const transcriptPath = path.join(folderPath, 'transcript.md');

    // Skip if metadata or transcript file is missing
    if (!fs.existsSync(metadataPath) || !fs.existsSync(transcriptPath)) {
      console.warn(`⚠️  Skipping music ${folder}: missing metadata.json or transcript.md`);
      continue;
    }

    try {
      const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf-8')) as MusicMetadata;
      const text = fs.readFileSync(transcriptPath, 'utf-8');

      music.push({
        id: metadata.id,
        title: metadata.title,
        type: 'music',
        description: metadata.description,
        text: text.trim(),
        mediaUrl: metadata.mediaUrl,
        imageUrl: metadata.imageUrl,
      });
    } catch (error) {
      console.warn(`⚠️  Error loading music from ${folder}:`, error);
    }
  }

  return music.sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * Load all video content from the videos directory.
 * Each video item should be in a folder with:
 * - metadata.json (video metadata)
 * - transcript.md (video transcript in markdown)
 *
 * @returns Array of Content objects with loaded video data
 */
export function loadVideosFromDisk(): Content[] {
  const videosDir = path.join(process.cwd(), 'src', 'videos');

  // Return empty array if videos directory doesn't exist yet
  if (!fs.existsSync(videosDir)) {
    return [];
  }

  const videos: Content[] = [];
  const videoFolders = fs.readdirSync(videosDir).filter(file => {
    const fullPath = path.join(videosDir, file);
    return fs.statSync(fullPath).isDirectory();
  });

  for (const folder of videoFolders) {
    const folderPath = path.join(videosDir, folder);
    const metadataPath = path.join(folderPath, 'metadata.json');
    const transcriptPath = path.join(folderPath, 'transcript.md');

    // Skip if metadata or transcript file is missing
    if (!fs.existsSync(metadataPath) || !fs.existsSync(transcriptPath)) {
      console.warn(`⚠️  Skipping video ${folder}: missing metadata.json or transcript.md`);
      continue;
    }

    try {
      const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf-8')) as VideoMetadata;
      const text = fs.readFileSync(transcriptPath, 'utf-8');

      videos.push({
        id: metadata.id,
        title: metadata.title,
        type: 'video',
        description: metadata.description,
        text: text.trim(),
        mediaUrl: metadata.mediaUrl,
        imageUrl: metadata.imageUrl,
      });
    } catch (error) {
      console.warn(`⚠️  Error loading video from ${folder}:`, error);
    }
  }

  return videos.sort((a, b) => a.id.localeCompare(b.id));
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

/**
 * Get all child stories (episodes and variants) for a given story.
 * Use this for stories split into parts via parentId (e.g., Urashima Taro Part 1, Part 2).
 * NOT for series episodes - use getSeriesStories() instead.
 * @param storyId The parent story ID
 * @param storiesWithMetadata All stories with their metadata
 * @returns Array of child stories sorted by episode number, variants last
 */
export function getChildren(
  storyId: string,
  storiesWithMetadata: Array<{ story: Content; metadata: StoryMetadata }>
) {
  const children: Array<{ story: Content; metadata: StoryMetadata; isVariant: boolean }> = [];

  for (const item of storiesWithMetadata) {
    if (item.metadata.parentId === storyId) {
      children.push({
        ...item,
        isVariant: !!item.metadata.variantType,
      });
    }
  }

  // Sort: episodes first (by episode number), then variants
  children.sort((a, b) => {
    if (a.isVariant && !b.isVariant) return 1;
    if (!a.isVariant && b.isVariant) return -1;

    if (!a.isVariant && !b.isVariant) {
      const aNum = a.metadata.episodeNumber ?? 0;
      const bNum = b.metadata.episodeNumber ?? 0;
      return aNum - bNum;
    }

    return a.story.title.localeCompare(b.story.title);
  });

  return children.map(c => ({ story: c.story, metadata: c.metadata }));
}

/**
 * Get all stories in a series.
 * Use this for independent episodes grouped into a series via seriesId (e.g., Pokemon Episode 1, 2, 3).
 * NOT for story parts - use getChildren() instead.
 * @param seriesId The series ID
 * @param storiesWithMetadata All stories with their metadata
 * @returns Array of stories in the series
 */
export function getSeriesStories(
  seriesId: string,
  storiesWithMetadata: Array<{ story: Content; metadata: StoryMetadata }>
) {
  const seriesStories = storiesWithMetadata
    .filter(item => item.metadata.seriesId === seriesId)
    .map(item => item.story);

  return seriesStories;
}
