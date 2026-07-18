import React, { useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  BookOpen,
  ChevronDown,
  ChevronRight,
  Loader2,
  Music,
  Search,
  Video,
  X,
} from 'lucide-react';
import { Content } from '../data/content';
import { WordInfo } from '../types';
import type {
  LengthFilter,
  SearchScope,
  SortBy,
  SortDir,
} from '../lib/contentFilters';

const SORT_OPTIONS: { value: SortBy; label: string }[] = [
  { value: 'difficulty', label: 'Difficulty' },
  { value: 'hardest-kanji', label: 'Hardest kanji' },
  { value: 'comprehension', label: 'Comprehension %' },
  { value: 'length', label: 'Length' },
  { value: 'title', label: 'Title' },
  { value: 'date', label: 'Date added' },
];

const LENGTH_OPTIONS: { value: LengthFilter; label: string }[] = [
  { value: 'all', label: 'Any length' },
  { value: 'short', label: 'Short (≤4 sentences)' },
  { value: 'medium', label: 'Medium (5–29)' },
  { value: 'long', label: 'Long (30+)' },
];

const RANGE_PRESETS: { label: string; range: [number, number] }[] = [
  { label: 'All', range: [0, 100] },
  { label: 'Almost (85–95%)', range: [85, 95] },
  { label: 'Almost (≥90%)', range: [90, 99] },
  { label: 'Ready (100%)', range: [100, 100] },
];

function HomeView({
  setDisplayCount,
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
  onClearFilters,
  setSelectedContent,
  getContentStatus,
  loadVocabForContent,
  comprehensionColor,
  visibleContent,
  loadingContent,
  displayCount,
  sortedContent,
}: HomeViewProps) {
  const [tagsExpanded, setTagsExpanded] = useState(false);
  const [showRange, setShowRange] = useState(false);

  const TOP_TAGS = 8;
  const visibleTags = tagsExpanded ? availableTags : availableTags.slice(0, TOP_TAGS);
  const currentRangeLabel = (() => {
    const preset = RANGE_PRESETS.find(
      p => p.range[0] === comprehensionRange[0] && p.range[1] === comprehensionRange[1],
    );
    if (preset) return preset.label;
    return `${comprehensionRange[0]}–${comprehensionRange[1]}%`;
  })();

  return (
    <section>
      <div className="mb-6 flex items-baseline justify-between">
        <h2 className="text-2xl font-semibold tracking-tight">
          Recommended For You
        </h2>
        <p className="text-sm text-gray-500 uppercase tracking-widest font-medium">
          {sortedContent.length} {sortedContent.length === 1 ? 'item' : 'items'}
        </p>
      </div>

      {/* Search + filters */}
      <div className="mb-6 space-y-3">
        {/* Row 1: search + scope + sort */}
        <div className="flex flex-wrap gap-2 items-center">
          <div className="relative flex-1 min-w-[200px] max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
            <input
              type="text"
              placeholder="Search content..."
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setDisplayCount(12);
              }}
              className="w-full pl-9 pr-3 py-2 text-sm rounded-xl border border-gray-200 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-300"
            />
          </div>

          {/* Search scope toggles */}
          <div className="flex items-center gap-1 text-xs text-gray-500">
            <span className="hidden sm:inline">in:</span>
            {(['title', 'description', 'body'] as const).map((s) => (
              <button
                key={s}
                onClick={() => toggleSearchScope(s)}
                className={`px-2 py-1 rounded-md border text-xs font-medium transition-colors ${
                  searchScope.has(s)
                    ? 'bg-indigo-50 text-indigo-700 border-indigo-200'
                    : 'bg-white text-gray-500 border-gray-200 hover:border-indigo-300'
                }`}
                title={s === 'body' ? 'Search Japanese text body' : `Search ${s}`}
              >
                {s}
              </button>
            ))}
          </div>

          {/* Sort dropdown */}
          <div className="flex items-center gap-1 ml-auto">
            <label className="text-xs text-gray-500 hidden sm:inline">Sort:</label>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as SortBy)}
              className="text-xs font-semibold px-3 py-2 rounded-xl border border-gray-200 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-300"
            >
              {SORT_OPTIONS.map(o => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
            <button
              onClick={() => setSortDir(sortDir === 'asc' ? 'desc' : 'asc')}
              className="p-2 rounded-xl border border-gray-200 bg-white hover:border-indigo-300"
              title={sortDir === 'asc' ? 'Ascending — click to reverse' : 'Descending — click to reverse'}
            >
              {sortDir === 'asc'
                ? <ArrowUp className="w-3.5 h-3.5 text-gray-600" />
                : <ArrowDown className="w-3.5 h-3.5 text-gray-600" />}
            </button>
          </div>
        </div>

        {/* Row 2: type, length, comprehension */}
        <div className="flex flex-wrap gap-2 items-center">
          {(['story', 'video', 'music'] as const).map((type) => (
            <button
              key={type}
              onClick={() => toggleTypeFilter(type)}
              className={`flex items-center gap-1.5 px-3 py-2 text-xs font-semibold uppercase tracking-wider rounded-xl border transition-colors ${
                typeFilter.has(type)
                  ? 'bg-indigo-600 text-white border-indigo-600'
                  : 'bg-white text-gray-600 border-gray-200 hover:border-indigo-300'
              }`}
            >
              {type === 'story' && <BookOpen className="w-3.5 h-3.5" />}
              {type === 'video' && <Video className="w-3.5 h-3.5" />}
              {type === 'music' && <Music className="w-3.5 h-3.5" />}
              {type}
            </button>
          ))}

          <select
            value={lengthFilter}
            onChange={(e) => {
              setLengthFilter(e.target.value as LengthFilter);
              setDisplayCount(12);
            }}
            className="text-xs font-semibold px-3 py-2 rounded-xl border border-gray-200 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-300"
          >
            {LENGTH_OPTIONS.map(o => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>

          {/* Comprehension range — popover-style trigger */}
          <div className="relative">
            <button
              onClick={() => setShowRange(v => !v)}
              className={`flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-xl border transition-colors ${
                comprehensionRange[0] !== 0 || comprehensionRange[1] !== 100
                  ? 'bg-indigo-600 text-white border-indigo-600'
                  : 'bg-white text-gray-600 border-gray-200 hover:border-indigo-300'
              }`}
            >
              Comprehension: {currentRangeLabel}
              <ChevronDown className="w-3.5 h-3.5" />
            </button>
            {showRange && (
              <div className="absolute z-20 mt-2 w-72 bg-white border border-gray-200 rounded-2xl shadow-lg p-4 space-y-3">
                <div>
                  <p className="text-xs font-semibold text-gray-500 mb-2 uppercase tracking-wider">Presets</p>
                  <div className="flex flex-wrap gap-1">
                    {RANGE_PRESETS.map(p => {
                      const active = p.range[0] === comprehensionRange[0] && p.range[1] === comprehensionRange[1];
                      return (
                        <button
                          key={p.label}
                          onClick={() => {
                            setComprehensionRange(p.range);
                            setDisplayCount(12);
                          }}
                          className={`px-2 py-1 rounded-md text-xs font-medium border transition-colors ${
                            active
                              ? 'bg-indigo-50 text-indigo-700 border-indigo-200'
                              : 'bg-white text-gray-600 border-gray-200 hover:border-indigo-300'
                          }`}
                        >
                          {p.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
                <div>
                  <p className="text-xs font-semibold text-gray-500 mb-2 uppercase tracking-wider">
                    Custom range: {comprehensionRange[0]}–{comprehensionRange[1]}%
                  </p>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      min={0}
                      max={100}
                      value={comprehensionRange[0]}
                      onChange={(e) => {
                        const v = Math.max(0, Math.min(100, Number(e.target.value) || 0));
                        setComprehensionRange([Math.min(v, comprehensionRange[1]), comprehensionRange[1]]);
                        setDisplayCount(12);
                      }}
                      className="w-20 px-2 py-1 text-sm rounded-md border border-gray-200"
                    />
                    <span className="text-gray-400">–</span>
                    <input
                      type="number"
                      min={0}
                      max={100}
                      value={comprehensionRange[1]}
                      onChange={(e) => {
                        const v = Math.max(0, Math.min(100, Number(e.target.value) || 100));
                        setComprehensionRange([comprehensionRange[0], Math.max(v, comprehensionRange[0])]);
                        setDisplayCount(12);
                      }}
                      className="w-20 px-2 py-1 text-sm rounded-md border border-gray-200"
                    />
                  </div>
                  <p className="text-[11px] text-gray-400 mt-2">
                    Items without analysed vocab only appear when the range is All (0–100).
                  </p>
                </div>
                <div className="flex justify-end">
                  <button
                    onClick={() => setShowRange(false)}
                    className="text-xs text-gray-500 hover:text-gray-900"
                  >
                    Close
                  </button>
                </div>
              </div>
            )}
          </div>

          {hasActiveFilters && (
            <button
              onClick={onClearFilters}
              className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-700 transition-colors px-2 py-2 ml-auto"
            >
              <X className="w-3.5 h-3.5" /> Clear
            </button>
          )}
        </div>

        {/* Row 3: level chips (only when there are any) */}
        {availableLevels.length > 0 && (
          <div className="flex flex-wrap gap-1.5 items-center">
            <span className="text-xs text-gray-500 mr-1">Level:</span>
            {availableLevels.map(({ level, count }) => (
              <button
                key={level}
                onClick={() => toggleLevelFilter(level)}
                className={`px-2.5 py-1 text-xs font-medium rounded-md border transition-colors ${
                  levelFilter.has(level)
                    ? 'bg-indigo-600 text-white border-indigo-600'
                    : 'bg-white text-gray-600 border-gray-200 hover:border-indigo-300'
                }`}
              >
                {level} <span className="opacity-60">({count})</span>
              </button>
            ))}
          </div>
        )}

        {/* Row 4: tag chips */}
        {availableTags.length > 0 && (
          <div className="flex flex-wrap gap-1.5 items-center">
            <span className="text-xs text-gray-500 mr-1">Tags:</span>
            {visibleTags.map(({ tag, count }) => (
              <button
                key={tag}
                onClick={() => toggleTagFilter(tag)}
                className={`px-2.5 py-1 text-xs font-medium rounded-md border transition-colors ${
                  tagFilter.has(tag)
                    ? 'bg-indigo-600 text-white border-indigo-600'
                    : 'bg-white text-gray-600 border-gray-200 hover:border-indigo-300'
                }`}
              >
                {tag} <span className="opacity-60">({count})</span>
              </button>
            ))}
            {availableTags.length > TOP_TAGS && (
              <button
                onClick={() => setTagsExpanded(v => !v)}
                className="text-xs text-indigo-600 hover:text-indigo-800 px-2 py-1"
              >
                {tagsExpanded ? 'Show fewer' : `+${availableTags.length - TOP_TAGS} more`}
              </button>
            )}
          </div>
        )}

        {/* "Almost There" explanation banner (when range matches the classic almost preset) */}
        {comprehensionRange[0] >= 85 && comprehensionRange[1] < 100 && (
          <div className="bg-green-50 border border-green-100 rounded-2xl px-4 py-3 text-sm text-green-800">
            <strong>i+1 sweet spot</strong> — content where you know {comprehensionRange[0]}–{comprehensionRange[1]}% of
            words. Challenging enough to encounter new vocabulary, easy enough
            to enjoy reading.
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {visibleContent.map((content) => {
          const status = getContentStatus(content.id);
          // #259 C1: `loaded` (not totalCount === 0) is the "still loading"
          // signal — totalCount === 0 is also true for content that's fully
          // loaded but genuinely has no extracted vocabulary, which used to
          // show "Analyzing vocabulary..." forever for those cards.
          const isLoading =
            loadingContent[content.id] || !status.loaded;
          const showUnknownChips =
            comprehensionRange[0] >= 85 && comprehensionRange[1] < 100;

          const openContent = () => {
            loadVocabForContent(content);
            setSelectedContent(content);
          };

          return (
            <div
              key={content.id}
              onClick={openContent}
              role="button"
              tabIndex={0}
              aria-label={`Open ${content.title}`}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  openContent();
                }
              }}
              className="bg-white rounded-3xl overflow-hidden cursor-pointer shadow-sm hover:shadow-md transition-all border border-gray-100 group flex flex-col h-full focus:outline-none focus:ring-2 focus:ring-indigo-400"
            >
              <div className="aspect-[4/3] w-full bg-gray-100 relative overflow-hidden">
                {content.imageUrl ? (
                  <img
                    src={content.imageUrl}
                    alt={content.title}
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center bg-indigo-50">
                    {content.type === 'story' && (
                      <BookOpen className="w-12 h-12 text-indigo-300" />
                    )}
                    {content.type === 'video' && (
                      <Video className="w-12 h-12 text-indigo-300" />
                    )}
                    {content.type === 'music' && (
                      <Music className="w-12 h-12 text-indigo-300" />
                    )}
                  </div>
                )}
                <div className="absolute top-4 left-4 bg-white/90 backdrop-blur-sm px-3 py-1 rounded-full flex items-center gap-1.5 shadow-sm">
                  {content.type === 'story' && (
                    <BookOpen className="w-3.5 h-3.5 text-indigo-600" />
                  )}
                  {content.type === 'video' && (
                    <Video className="w-3.5 h-3.5 text-indigo-600" />
                  )}
                  {content.type === 'music' && (
                    <Music className="w-3.5 h-3.5 text-indigo-600" />
                  )}
                  <span className="text-xs font-semibold uppercase tracking-wider text-gray-800">
                    {content.type}
                  </span>
                </div>
                {!isLoading && status.totalCount > 0 && (
                  <div
                    className={`absolute top-4 right-4 px-2.5 py-1 rounded-full text-xs font-bold border ${comprehensionColor(status.comprehension)}`}
                  >
                    {status.comprehension === 100
                      ? '✓ Ready'
                      : `${status.comprehension}% known`}
                  </div>
                )}
              </div>

              <div className="p-5 flex flex-col flex-grow">
                <h3 className="font-semibold text-lg mb-2">{content.title}</h3>
                {(content.level || (content.tags && content.tags.length > 0)) && (
                  <div className="flex flex-wrap gap-1 mb-2">
                    {content.level && (
                      <span className="px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider rounded bg-indigo-50 text-indigo-700 border border-indigo-100">
                        {content.level}
                      </span>
                    )}
                    {content.tags?.slice(0, 3).map(t => (
                      <span
                        key={t}
                        className="px-1.5 py-0.5 text-[10px] rounded bg-gray-50 text-gray-600 border border-gray-200"
                      >
                        {t}
                      </span>
                    ))}
                  </div>
                )}
                <p className="text-sm text-gray-500 line-clamp-2 mb-4 flex-grow">
                  {content.description}
                </p>

                {showUnknownChips &&
                  !isLoading &&
                  'unknownWords' in status &&
                  (status as { unknownWords: WordInfo[] }).unknownWords.length > 0 && (
                    <div className="flex flex-wrap gap-1 mb-3">
                      {(status as { unknownWords: WordInfo[] }).unknownWords.slice(0, 6).map((w) => (
                        <span
                          key={w.word}
                          className="px-2 py-0.5 bg-amber-50 border border-amber-200 text-amber-800 rounded-md text-xs font-medium"
                        >
                          {w.word}
                        </span>
                      ))}
                      {status.unknownCount > 6 && (
                        <span className="px-2 py-0.5 text-gray-400 text-xs">
                          +{status.unknownCount - 6} more
                        </span>
                      )}
                    </div>
                  )}

                {isLoading ? (
                  <div className="flex items-center gap-2 text-sm text-gray-400">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Analyzing vocabulary...
                  </div>
                ) : (
                  <div className="flex items-center justify-between border-t border-gray-50 pt-4 mt-auto">
                    <div className="flex flex-col">
                      <span className="text-xs text-gray-400 uppercase tracking-wider">
                        Unknown
                      </span>
                      <span className="font-medium text-indigo-600">
                        {status.unknownCount} words
                      </span>
                    </div>
                    <div className="flex flex-col items-end">
                      <span className="text-xs text-gray-400 uppercase tracking-wider">
                        Score
                      </span>
                      <span className="font-medium flex items-center gap-1">
                        {status.score}
                        <ChevronRight className="w-4 h-4 text-gray-300" />
                      </span>
                    </div>
                  </div>
                )}
              </div>
            </div>
          );
        })}

        {visibleContent.length === 0 && (
          <div className="col-span-3 py-16 text-center text-gray-400">
            <p className="text-lg font-medium">
              No content matches your filters.
            </p>
            <button
              onClick={onClearFilters}
              className="mt-3 text-sm text-indigo-500 hover:text-indigo-700 underline"
            >
              Clear filters
            </button>
          </div>
        )}
      </div>

      {displayCount < sortedContent.length && (
        <div className="mt-8 flex justify-center">
          <button
            onClick={() => setDisplayCount((prev) => prev + 12)}
            className="bg-white border border-gray-200 text-gray-700 px-6 py-3 rounded-full font-medium hover:bg-gray-50 shadow-sm transition-all"
          >
            Load More Content ({sortedContent.length - displayCount} remaining)
          </button>
        </div>
      )}
    </section>
  );
}

type HomeViewProps = {
  setDisplayCount: React.Dispatch<React.SetStateAction<number>>;

  searchQuery: string;
  setSearchQuery: React.Dispatch<React.SetStateAction<string>>;

  searchScope: Set<SearchScope>;
  toggleSearchScope: (scope: SearchScope) => void;

  typeFilter: Set<string>;
  toggleTypeFilter: (type: 'story' | 'video' | 'music') => void;

  levelFilter: Set<string>;
  toggleLevelFilter: (level: string) => void;
  availableLevels: { level: string; count: number }[];

  tagFilter: Set<string>;
  toggleTagFilter: (tag: string) => void;
  availableTags: { tag: string; count: number }[];

  lengthFilter: LengthFilter;
  setLengthFilter: React.Dispatch<React.SetStateAction<LengthFilter>>;

  comprehensionRange: [number, number];
  setComprehensionRange: React.Dispatch<React.SetStateAction<[number, number]>>;

  sortBy: SortBy;
  setSortBy: React.Dispatch<React.SetStateAction<SortBy>>;
  sortDir: SortDir;
  setSortDir: React.Dispatch<React.SetStateAction<SortDir>>;

  hasActiveFilters: boolean;
  onClearFilters: () => void;

  loadVocabForContent: (content: Content) => void;
  setSelectedContent: React.Dispatch<React.SetStateAction<Content | null>>;
  getContentStatus: (contentId: string) => {
    difficulty?: number;
    totalUnknownScore?: number;
    unknownCount: number;
    totalCount: number;
    score: number;
    unknownWords?: WordInfo[];
    comprehension: number;
    loaded: boolean;
  };
  comprehensionColor: (comprehension: number) => string;

  visibleContent: Content[];
  loadingContent: Record<string, boolean>;
  displayCount: number;
  sortedContent: Content[];
};

export default HomeView;
