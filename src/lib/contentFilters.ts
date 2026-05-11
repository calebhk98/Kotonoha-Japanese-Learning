import type { Content } from '../data/content';
import type { WordInfo } from '../types';

export type SearchScope = 'title' | 'description' | 'body';
export type LengthFilter = 'all' | 'short' | 'medium' | 'long';
export type SortBy =
  | 'difficulty'
  | 'title'
  | 'date'
  | 'comprehension'
  | 'length'
  | 'hardest-kanji';
export type SortDir = 'asc' | 'desc';

export interface ContentStatus {
  comprehension: number;
  totalCount: number;
  unknownCount: number;
  score: number;
}

export interface ContentFilters {
  searchQuery: string;
  searchScope: Set<SearchScope>;
  typeFilter: Set<string>;
  levelFilter: Set<string>;       // normalized level keys, e.g. 'N5', 'beginner'
  tagFilter: Set<string>;
  lengthFilter: LengthFilter;
  comprehensionRange: [number, number]; // inclusive 0..100; [0,100] disables the filter
}

export const DEFAULT_FILTERS: ContentFilters = {
  searchQuery: '',
  searchScope: new Set<SearchScope>(['title', 'description']),
  typeFilter: new Set<string>(),
  levelFilter: new Set<string>(),
  tagFilter: new Set<string>(),
  lengthFilter: 'all',
  comprehensionRange: [0, 100],
};

// Length bands (sentence count). Tuned so a typical haiku or short song
// lands in "short" and a multi-paragraph story lands in "medium" or "long".
const LENGTH_BANDS: Record<Exclude<LengthFilter, 'all'>, [number, number]> = {
  short: [0, 4],
  medium: [5, 29],
  long: [30, Number.POSITIVE_INFINITY],
};

const JLPT_RE = /\bN[1-5]\b/i;

export function normalizeLevel(raw: string | undefined | null): string {
  if (!raw) return 'unknown';
  const trimmed = String(raw).trim();
  if (!trimmed) return 'unknown';
  const jlpt = trimmed.match(JLPT_RE);
  if (jlpt) return jlpt[0].toUpperCase();
  return trimmed.toLowerCase();
}

export function countSentences(text: string): number {
  if (!text) return 0;
  // Split on Japanese / western sentence terminators and newlines, then drop empties.
  const parts = text
    .split(/[。．！？!?\n\r]+/)
    .map(s => s.trim())
    .filter(Boolean);
  return parts.length;
}

export function hardestKanjiScore(words: WordInfo[] | undefined): number {
  if (!words || words.length === 0) return 0;
  let max = 0;
  for (const w of words) {
    const s = w.breakdown?.jlptScore;
    if (typeof s === 'number' && s > max) max = s;
  }
  return max;
}

export function matchesSearch(
  c: Content,
  rawQuery: string,
  scope: Set<SearchScope>,
): boolean {
  const q = rawQuery.trim().toLowerCase();
  if (!q) return true;
  if (scope.size === 0) return false;

  const haystacks: string[] = [];
  if (scope.has('title')) haystacks.push(c.title);
  if (scope.has('description')) haystacks.push(c.description);
  if (scope.has('body')) haystacks.push(c.text);

  for (const h of haystacks) {
    if (h && h.toLowerCase().includes(q)) return true;
  }
  return false;
}

function inLengthBand(text: string, band: LengthFilter): boolean {
  if (band === 'all') return true;
  const n = countSentences(text);
  const [lo, hi] = LENGTH_BANDS[band];
  return n >= lo && n <= hi;
}

function inComprehensionRange(
  status: ContentStatus,
  [min, max]: [number, number],
): boolean {
  // The default range [0,100] is a no-op; we want unloaded items (totalCount 0)
  // to still show up. Only exclude unloaded items when the user has narrowed
  // the range away from the defaults.
  const isDefault = min === 0 && max === 100;
  if (status.totalCount === 0) return isDefault;
  return status.comprehension >= min && status.comprehension <= max;
}

export function applyContentFilters(
  items: Content[],
  statusFor: (id: string) => ContentStatus,
  f: ContentFilters,
): Content[] {
  return items.filter(c => {
    if (!matchesSearch(c, f.searchQuery, f.searchScope)) return false;
    if (f.typeFilter.size > 0 && !f.typeFilter.has(c.type)) return false;
    if (f.levelFilter.size > 0) {
      const lvl = normalizeLevel(c.level);
      const want = new Set(Array.from(f.levelFilter, normalizeLevel));
      if (!want.has(lvl)) return false;
    }
    if (f.tagFilter.size > 0) {
      const tags = c.tags ?? [];
      const has = tags.some(t => f.tagFilter.has(t));
      if (!has) return false;
    }
    if (!inLengthBand(c.text, f.lengthFilter)) return false;
    if (!inComprehensionRange(statusFor(c.id), f.comprehensionRange)) return false;
    return true;
  });
}

export function sortContent(
  items: Content[],
  statusFor: (id: string) => ContentStatus,
  vocab: Record<string, WordInfo[]>,
  by: SortBy,
  dir: SortDir,
): Content[] {
  const out = [...items];
  const mult = dir === 'asc' ? 1 : -1;

  if (by === 'title') {
    out.sort((a, b) => a.title.toLowerCase().localeCompare(b.title.toLowerCase()) * mult);
    return out;
  }

  if (by === 'date') {
    // Items without a dateAdded sort to the end regardless of dir.
    out.sort((a, b) => {
      const ad = a.dateAdded ?? '';
      const bd = b.dateAdded ?? '';
      if (!ad && !bd) return 0;
      if (!ad) return 1;
      if (!bd) return -1;
      return ad.localeCompare(bd) * mult;
    });
    return out;
  }

  if (by === 'comprehension') {
    out.sort((a, b) => {
      const sa = statusFor(a.id);
      const sb = statusFor(b.id);
      // Unloaded items at the bottom regardless of dir.
      if (sa.totalCount === 0 && sb.totalCount !== 0) return 1;
      if (sa.totalCount !== 0 && sb.totalCount === 0) return -1;
      return (sa.comprehension - sb.comprehension) * mult;
    });
    return out;
  }

  if (by === 'length') {
    out.sort((a, b) => (countSentences(a.text) - countSentences(b.text)) * mult);
    return out;
  }

  if (by === 'hardest-kanji') {
    out.sort((a, b) => (hardestKanjiScore(vocab[a.id]) - hardestKanjiScore(vocab[b.id])) * mult);
    return out;
  }

  // difficulty (the historical default): unloaded items always at the bottom,
  // then sort by computed score in the requested direction.
  out.sort((a, b) => {
    const sa = statusFor(a.id);
    const sb = statusFor(b.id);
    if (sa.totalCount === 0 && sb.totalCount !== 0) return 1;
    if (sa.totalCount !== 0 && sb.totalCount === 0) return -1;
    return (sa.score - sb.score) * mult;
  });
  return out;
}

export interface TagCount {
  tag: string;
  count: number;
}

export function collectTags(items: Content[]): TagCount[] {
  const counts = new Map<string, number>();
  for (const c of items) {
    for (const t of c.tags ?? []) {
      if (!t) continue;
      counts.set(t, (counts.get(t) ?? 0) + 1);
    }
  }
  return Array.from(counts.entries())
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => (b.count - a.count) || a.tag.localeCompare(b.tag));
}

export function collectLevels(items: Content[]): { level: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const c of items) {
    const lvl = normalizeLevel(c.level);
    if (lvl === 'unknown') continue;
    counts.set(lvl, (counts.get(lvl) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([level, count]) => ({ level, count }))
    .sort((a, b) => {
      // Put JLPT levels first (N5 → N1), then alphabetical bands.
      const aJ = JLPT_RE.test(a.level);
      const bJ = JLPT_RE.test(b.level);
      if (aJ && !bJ) return -1;
      if (!aJ && bJ) return 1;
      if (aJ && bJ) return b.level.localeCompare(a.level); // N5 before N1
      return a.level.localeCompare(b.level);
    });
}
