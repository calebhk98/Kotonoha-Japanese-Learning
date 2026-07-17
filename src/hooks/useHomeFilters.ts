import { useEffect, useMemo, useState } from 'react';
import { Content } from '../data/content';
import {
  applyContentFilters,
  collectLevels,
  collectTags,
  ContentStatus,
  DEFAULT_FILTERS,
  sortContent,
  type ContentFilters,
  type LengthFilter,
  type SearchScope,
  type SortBy,
  type SortDir,
} from '../lib/contentFilters';
import { WordInfo } from '../types';

const HOME_FILTERS_KEY = 'homeFilters';

interface PersistedHomeFilters {
  searchQuery: string;
  searchScope: SearchScope[];
  typeFilter: string[];
  levelFilter: string[];
  tagFilter: string[];
  lengthFilter: LengthFilter;
  comprehensionRange: [number, number];
  sortBy: SortBy;
  sortDir: SortDir;
}

function loadPersistedFilters(): {
  filters: ContentFilters;
  sortBy: SortBy;
  sortDir: SortDir;
} {
  const fallback = { filters: { ...DEFAULT_FILTERS }, sortBy: 'difficulty' as SortBy, sortDir: 'asc' as SortDir };
  try {
    const raw = localStorage.getItem(HOME_FILTERS_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<PersistedHomeFilters>;
    return {
      filters: {
        searchQuery: parsed.searchQuery ?? '',
        searchScope: new Set(parsed.searchScope ?? ['title', 'description']),
        typeFilter: new Set(parsed.typeFilter ?? []),
        levelFilter: new Set(parsed.levelFilter ?? []),
        tagFilter: new Set(parsed.tagFilter ?? []),
        lengthFilter: parsed.lengthFilter ?? 'all',
        comprehensionRange: parsed.comprehensionRange ?? [0, 100],
      },
      sortBy: parsed.sortBy ?? 'difficulty',
      sortDir: parsed.sortDir ?? 'asc',
    };
  } catch (e) {
    console.error('Failed to parse persisted home filters:', e);
    return fallback;
  }
}

/**
 * Owns all Home-view search/filter/sort state, its localStorage persistence
 * (under HOME_FILTERS_KEY), and the derived sorted/filtered content list.
 * Extracted from App.tsx (issue #255) so the shell component doesn't have to
 * carry this bookkeeping directly.
 */
export function useHomeFilters(
  allContent: Content[],
  getContentStatus: (contentId: string) => ContentStatus,
  contentVocab: Record<string, WordInfo[]>,
) {
  const persisted = useMemo(() => loadPersistedFilters(), []);
  const [searchQuery, setSearchQuery] = useState(persisted.filters.searchQuery);
  const [searchScope, setSearchScope] = useState<Set<SearchScope>>(persisted.filters.searchScope);
  const [typeFilter, setTypeFilter] = useState<Set<string>>(persisted.filters.typeFilter);
  const [levelFilter, setLevelFilter] = useState<Set<string>>(persisted.filters.levelFilter);
  const [tagFilter, setTagFilter] = useState<Set<string>>(persisted.filters.tagFilter);
  const [lengthFilter, setLengthFilter] = useState<LengthFilter>(persisted.filters.lengthFilter);
  const [comprehensionRange, setComprehensionRange] = useState<[number, number]>(persisted.filters.comprehensionRange);
  const [sortBy, setSortBy] = useState<SortBy>(persisted.sortBy);
  const [sortDir, setSortDir] = useState<SortDir>(persisted.sortDir);
  const [displayCount, setDisplayCount] = useState(12);

  const filters = useMemo<ContentFilters>(() => ({
    searchQuery,
    searchScope,
    typeFilter,
    levelFilter,
    tagFilter,
    lengthFilter,
    comprehensionRange,
  }), [searchQuery, searchScope, typeFilter, levelFilter, tagFilter, lengthFilter, comprehensionRange]);

  // Persist filter/sort selections so they survive a reload.
  useEffect(() => {
    const payload: PersistedHomeFilters = {
      searchQuery,
      searchScope: Array.from(searchScope),
      typeFilter: Array.from(typeFilter),
      levelFilter: Array.from(levelFilter),
      tagFilter: Array.from(tagFilter),
      lengthFilter,
      comprehensionRange,
      sortBy,
      sortDir,
    };
    localStorage.setItem(HOME_FILTERS_KEY, JSON.stringify(payload));
  }, [searchQuery, searchScope, typeFilter, levelFilter, tagFilter, lengthFilter, comprehensionRange, sortBy, sortDir]);

  const sortedContent = useMemo(() => {
    const filtered = applyContentFilters(allContent, getContentStatus, filters);
    return sortContent(filtered, getContentStatus, contentVocab, sortBy, sortDir);
  }, [allContent, filters, sortBy, sortDir, getContentStatus, contentVocab]);

  const availableTags = useMemo(() => collectTags(allContent), [allContent]);
  const availableLevels = useMemo(() => collectLevels(allContent), [allContent]);

  const visibleContent = sortedContent.slice(0, displayCount);

  const toggleTypeFilter = (type: string) => {
    setTypeFilter(prev => {
      const next = new Set(prev);
      next.has(type) ? next.delete(type) : next.add(type);
      return next;
    });
    setDisplayCount(12);
  };

  const toggleLevelFilter = (level: string) => {
    setLevelFilter(prev => {
      const next = new Set(prev);
      next.has(level) ? next.delete(level) : next.add(level);
      return next;
    });
    setDisplayCount(12);
  };

  const toggleTagFilter = (tag: string) => {
    setTagFilter(prev => {
      const next = new Set(prev);
      next.has(tag) ? next.delete(tag) : next.add(tag);
      return next;
    });
    setDisplayCount(12);
  };

  const toggleSearchScope = (scope: SearchScope) => {
    setSearchScope(prev => {
      const next = new Set(prev);
      next.has(scope) ? next.delete(scope) : next.add(scope);
      // Don't allow zero scopes — re-enable title if user removed the last one.
      if (next.size === 0) next.add('title');
      return next;
    });
    setDisplayCount(12);
  };

  const clearAllFilters = () => {
    setSearchQuery('');
    setSearchScope(new Set(['title', 'description']));
    setTypeFilter(new Set());
    setLevelFilter(new Set());
    setTagFilter(new Set());
    setLengthFilter('all');
    setComprehensionRange([0, 100]);
    setDisplayCount(12);
  };

  const hasActiveFilters =
    searchQuery.trim() !== '' ||
    typeFilter.size > 0 ||
    levelFilter.size > 0 ||
    tagFilter.size > 0 ||
    lengthFilter !== 'all' ||
    comprehensionRange[0] !== 0 ||
    comprehensionRange[1] !== 100;

  return {
    searchQuery,
    setSearchQuery,
    searchScope,
    toggleSearchScope,
    typeFilter,
    toggleTypeFilter,
    levelFilter,
    toggleLevelFilter,
    availableLevels,
    tagFilter,
    toggleTagFilter,
    availableTags,
    lengthFilter,
    setLengthFilter,
    comprehensionRange,
    setComprehensionRange,
    sortBy,
    setSortBy,
    sortDir,
    setSortDir,
    hasActiveFilters,
    clearAllFilters,
    sortedContent,
    visibleContent,
    displayCount,
    setDisplayCount,
  };
}
