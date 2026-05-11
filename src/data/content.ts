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
  level?: string;     // JLPT level / difficulty band from metadata (e.g. "N5", "beginner")
  tags?: string[];    // Free-form tags from metadata
  dateAdded?: string; // ISO date string from metadata (when content was added)
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

export function getContent(): Content[] {
  return [...loadStoriesFromDisk(), ...loadMusicFromDisk(), ...loadVideosFromDisk()];
}

export function getStories(): Story[] {
  return loadStoriesFromDisk().filter((item): item is Story => item.type === 'story');
}

export function getMusic(): Music[] {
  return loadMusicFromDisk().filter((item): item is Music => item.type === 'music');
}

export function getVideos(): Video[] {
  return loadVideosFromDisk().filter((item): item is Video => item.type === 'video');
}
