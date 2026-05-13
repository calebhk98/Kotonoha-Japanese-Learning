import { describe, it, expect } from 'vitest';
import {
  normalizeLevel,
  countSentences,
  hardestKanjiScore,
  matchesSearch,
  applyContentFilters,
  sortContent,
  collectTags,
  DEFAULT_FILTERS,
  type ContentFilters,
  type SortBy,
  type SortDir,
  type ContentStatus,
} from './contentFilters';
import type { Content } from '../data/content';
import type { WordInfo } from '../types';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const mkContent = (over: Partial<Content>): Content => ({
  id: over.id ?? 'x',
  title: over.title ?? 'Title',
  type: over.type ?? 'story',
  description: over.description ?? '',
  text: over.text ?? '',
  level: over.level,
  tags: over.tags,
  dateAdded: over.dateAdded,
  mediaUrl: over.mediaUrl,
  imageUrl: over.imageUrl,
});

const mkStatus = (over: Partial<ContentStatus> = {}): ContentStatus => ({
  comprehension: 0,
  totalCount: 0,
  unknownCount: 0,
  score: 0,
  ...over,
});

const mkWord = (jlptScore: number): WordInfo => ({
  word: '',
  reading: '',
  meaning: '',
  jlpt: 0,
  joyo: false,
  score: 0,
  breakdown: {
    jlptScore,
    joyoPenalty: 0,
    freqPenalty: 0,
    jlptValues: [],
    gradeValues: [],
    priorities: [],
  },
});

// ---------------------------------------------------------------------------
// normalizeLevel
// ---------------------------------------------------------------------------

describe('normalizeLevel', () => {
  it('maps JLPT-style values', () => {
    expect(normalizeLevel('N5')).toBe('N5');
    expect(normalizeLevel('n4')).toBe('N4');
    expect(normalizeLevel('JLPT N3')).toBe('N3');
  });
  it('maps difficulty bands', () => {
    expect(normalizeLevel('beginner')).toBe('beginner');
    expect(normalizeLevel('Intermediate')).toBe('intermediate');
    expect(normalizeLevel('ADVANCED')).toBe('advanced');
  });
  it('returns unknown for missing/empty', () => {
    expect(normalizeLevel(undefined)).toBe('unknown');
    expect(normalizeLevel('')).toBe('unknown');
  });
});

// ---------------------------------------------------------------------------
// countSentences
// ---------------------------------------------------------------------------

describe('countSentences', () => {
  it('counts on Japanese terminators', () => {
    expect(countSentences('猫が好きです。本を読みました。')).toBe(2);
  });
  it('counts on western terminators', () => {
    expect(countSentences('Hello world! How are you? Fine.')).toBe(3);
  });
  it('counts blank lines / newlines as separators (for songs/poems)', () => {
    expect(countSentences('行一\n行二\n行三')).toBe(3);
  });
  it('returns 0 for empty text', () => {
    expect(countSentences('')).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// hardestKanjiScore
// ---------------------------------------------------------------------------

describe('hardestKanjiScore', () => {
  it('returns 0 when no words', () => {
    expect(hardestKanjiScore(undefined)).toBe(0);
    expect(hardestKanjiScore([])).toBe(0);
  });
  it('returns max breakdown.jlptScore across words', () => {
    expect(hardestKanjiScore([mkWord(15), mkWord(70), mkWord(30)])).toBe(70);
  });
});

// ---------------------------------------------------------------------------
// matchesSearch
// ---------------------------------------------------------------------------

describe('matchesSearch', () => {
  const c = mkContent({
    title: 'Spring Morning',
    description: 'A short tale about spring.',
    text: '春の朝です。',
  });
  it('empty query matches everything', () => {
    expect(matchesSearch(c, '', new Set(['title']))).toBe(true);
  });
  it('searches title by default', () => {
    expect(matchesSearch(c, 'spring', new Set(['title']))).toBe(true);
    expect(matchesSearch(c, 'tale', new Set(['title']))).toBe(false);
  });
  it('searches description when scope includes description', () => {
    expect(matchesSearch(c, 'tale', new Set(['description']))).toBe(true);
  });
  it('searches body when scope includes body', () => {
    expect(matchesSearch(c, '春', new Set(['body']))).toBe(true);
    expect(matchesSearch(c, '春', new Set(['title']))).toBe(false);
  });
  it('is case-insensitive', () => {
    expect(matchesSearch(c, 'SPRING', new Set(['title']))).toBe(true);
  });
  it('with empty scope set, never matches a non-empty query', () => {
    expect(matchesSearch(c, 'spring', new Set())).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// applyContentFilters
// ---------------------------------------------------------------------------

describe('applyContentFilters', () => {
  const items: Content[] = [
    mkContent({ id: 'a', title: 'Alpha',   type: 'story',  level: 'N5',          tags: ['spring'],   text: '一文。二文。' }),
    mkContent({ id: 'b', title: 'Beta',    type: 'music',  level: 'beginner',    tags: ['autumn'],   text: '一行\n二行\n三行' }),
    mkContent({ id: 'c', title: 'Gamma',   type: 'video',  level: 'intermediate',tags: ['spring','newsy'], text: Array(20).fill('文。').join('') }),
    mkContent({ id: 'd', title: 'Delta',   type: 'story',  level: 'N3',          tags: [],           text: Array(60).fill('文。').join('') }),
  ];

  const statuses: Record<string, ContentStatus> = {
    a: mkStatus({ comprehension: 100, totalCount: 10 }),
    b: mkStatus({ comprehension: 90,  totalCount: 10 }),
    c: mkStatus({ comprehension: 50,  totalCount: 10 }),
    d: mkStatus({ comprehension: 0,   totalCount: 0  }),
  };

  const statusFn = (id: string) => statuses[id];

  it('default filters keep everything', () => {
    const out = applyContentFilters(items, statusFn, DEFAULT_FILTERS);
    expect(out.map(c => c.id).sort()).toEqual(['a', 'b', 'c', 'd']);
  });

  it('type filter', () => {
    const f: ContentFilters = { ...DEFAULT_FILTERS, typeFilter: new Set(['story']) };
    expect(applyContentFilters(items, statusFn, f).map(c => c.id)).toEqual(['a', 'd']);
  });

  it('level filter (case-insensitive, normalized)', () => {
    const f: ContentFilters = { ...DEFAULT_FILTERS, levelFilter: new Set(['N5', 'beginner']) };
    expect(applyContentFilters(items, statusFn, f).map(c => c.id).sort()).toEqual(['a', 'b']);
  });

  it('tag filter (any-match)', () => {
    const f: ContentFilters = { ...DEFAULT_FILTERS, tagFilter: new Set(['spring']) };
    expect(applyContentFilters(items, statusFn, f).map(c => c.id).sort()).toEqual(['a', 'c']);
  });

  it('length filter — short (<5 sentences)', () => {
    const f: ContentFilters = { ...DEFAULT_FILTERS, lengthFilter: 'short' };
    expect(applyContentFilters(items, statusFn, f).map(c => c.id).sort()).toEqual(['a', 'b']);
  });

  it('length filter — long (>=30 sentences)', () => {
    const f: ContentFilters = { ...DEFAULT_FILTERS, lengthFilter: 'long' };
    expect(applyContentFilters(items, statusFn, f).map(c => c.id)).toEqual(['d']);
  });

  it('comprehension range filters by inclusive min/max', () => {
    const f: ContentFilters = { ...DEFAULT_FILTERS, comprehensionRange: [85, 95] };
    // a=100 out, b=90 in, c=50 out, d=unloaded (excluded when range != [0,100])
    expect(applyContentFilters(items, statusFn, f).map(c => c.id)).toEqual(['b']);
  });

  it('comprehension range [0,100] keeps unloaded items', () => {
    const f: ContentFilters = { ...DEFAULT_FILTERS, comprehensionRange: [0, 100] };
    expect(applyContentFilters(items, statusFn, f).map(c => c.id).sort()).toEqual(['a', 'b', 'c', 'd']);
  });

  it('search applies across configured scopes', () => {
    const f: ContentFilters = { ...DEFAULT_FILTERS, searchQuery: 'alpha', searchScope: new Set(['title']) };
    expect(applyContentFilters(items, statusFn, f).map(c => c.id)).toEqual(['a']);
  });
});

// ---------------------------------------------------------------------------
// sortContent
// ---------------------------------------------------------------------------

describe('sortContent', () => {
  const items: Content[] = [
    mkContent({ id: 'a', title: 'Cherry',   text: '短い。', dateAdded: '2025-01-01' }),
    mkContent({ id: 'b', title: 'apple',    text: '一。二。三。', dateAdded: '2026-04-01' }),
    mkContent({ id: 'c', title: 'Banana',   text: Array(10).fill('文。').join(''), dateAdded: '2025-06-15' }),
  ];

  const statuses: Record<string, ContentStatus> = {
    a: mkStatus({ comprehension: 80, totalCount: 5, score: 50 }),
    b: mkStatus({ comprehension: 100, totalCount: 3, score: 10 }),
    c: mkStatus({ comprehension: 0,   totalCount: 0, score: 0  }),
  };
  const statusFn = (id: string) => statuses[id];

  const vocab: Record<string, WordInfo[]> = {
    a: [mkWord(50), mkWord(15)],
    b: [mkWord(30)],
    c: [],
  };

  const sortBy = (by: SortBy, dir: SortDir = 'asc') =>
    sortContent(items, statusFn, vocab, by, dir).map(c => c.id);

  it('title ascending (case-insensitive)', () => {
    expect(sortBy('title', 'asc')).toEqual(['b', 'c', 'a']);
  });

  it('title descending', () => {
    expect(sortBy('title', 'desc')).toEqual(['a', 'c', 'b']);
  });

  it('date — newest first when desc', () => {
    expect(sortBy('date', 'desc')).toEqual(['b', 'c', 'a']);
  });

  it('comprehension descending', () => {
    expect(sortBy('comprehension', 'desc')).toEqual(['b', 'a', 'c']);
  });

  it('length ascending uses sentence count', () => {
    expect(sortBy('length', 'asc')).toEqual(['a', 'b', 'c']);
  });

  it('hardest-kanji uses max breakdown.jlptScore', () => {
    // a=50, b=30, c=0 — ascending
    expect(sortBy('hardest-kanji', 'asc')).toEqual(['c', 'b', 'a']);
  });

  it('difficulty sort keeps unloaded items at the bottom regardless of dir', () => {
    // ascending: loaded ascending by score then unloaded
    expect(sortBy('difficulty', 'asc')).toEqual(['b', 'a', 'c']);
    // descending: loaded descending then unloaded
    expect(sortBy('difficulty', 'desc')).toEqual(['a', 'b', 'c']);
  });
});

// ---------------------------------------------------------------------------
// collectTags
// ---------------------------------------------------------------------------

describe('collectTags', () => {
  it('returns unique tags with counts, sorted by frequency desc then alpha', () => {
    const items: Content[] = [
      mkContent({ id: '1', tags: ['spring', 'children'] }),
      mkContent({ id: '2', tags: ['spring'] }),
      mkContent({ id: '3', tags: ['autumn', 'children'] }),
      mkContent({ id: '4' }),
    ];
    const out = collectTags(items);
    expect(out).toEqual([
      { tag: 'children', count: 2 },
      { tag: 'spring',   count: 2 },
      { tag: 'autumn',   count: 1 },
    ]);
  });
});
