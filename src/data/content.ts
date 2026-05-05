import { loadStoriesFromDisk, loadMusicFromDisk, loadVideosFromDisk } from '../lib/storyLoader';

export type ContentType = 'story' | 'video' | 'music';

export interface Content {
  id: string;
  title: string;
  type: ContentType;
  description: string;
  text: string; // The transcript or story
  mediaUrl?: string;
  imageUrl?: string;
}

export interface Story extends Content {
  type: 'story';
}

export interface Music extends Content {
  type: 'music';
}

export interface Video extends Content {
  type: 'video';
}

/**
 * Get all content items (stories, music, and videos).
 * Loads from disk first, falls back to INITIAL_CONTENT.
 * @returns Array of all content objects
 */
export function getContent(): Content[] {
  const diskStories = loadStoriesFromDisk();
  const diskMusic = loadMusicFromDisk();
  const diskVideos = loadVideosFromDisk();

  if (diskStories.length > 0 || diskMusic.length > 0 || diskVideos.length > 0) {
    return [...diskStories, ...diskMusic, ...diskVideos];
  }

  return INITIAL_CONTENT;
}

/**
 * Get all story content items.
 * Loads from disk (src/stories/) first, falls back to INITIAL_CONTENT.
 * @returns Array of story objects (filtered from all content)
 */
export function getStories(): Story[] {
  const content = getContent();
  return content.filter((item): item is Story => item.type === 'story');
}

/**
 * Get all music content items.
 * Loads from disk (src/music/) first, falls back to INITIAL_CONTENT.
 * @returns Array of music objects (filtered from all content)
 */
export function getMusic(): Music[] {
  const content = getContent();
  return content.filter((item): item is Music => item.type === 'music');
}

/**
 * Get all video content items.
 * Loads from disk (src/videos/) first, falls back to INITIAL_CONTENT.
 * @returns Array of video objects (filtered from all content)
 */
export function getVideos(): Video[] {
  const content = getContent();
  return content.filter((item): item is Video => item.type === 'video');
}


/**
 * INITIAL_CONTENT and GENERATED_CONTENT have been migrated to file-based system.
 * All content is now stored in:
 * - src/stories/ (story content with metadata.json + content.md)
 * - src/music/ (music content with metadata.json + transcript.md)
 * - src/videos/ (video content with metadata.json + transcript.md)
 *
 * These arrays are kept empty as fallback for the getContent() function.
 * To add more content, create new directories in those folders with the appropriate structure.
 */
export const INITIAL_CONTENT: Content[] = [];
