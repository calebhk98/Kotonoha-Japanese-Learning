import React from 'react';
import {
  BookOpen,
  ChevronRight,
  Loader2,
  Music,
  Search,
  Video,
  X,
} from 'lucide-react';
import { Content } from '../data/content';
import { WordInfo } from '../types';

function HomeView({
  setSearchQuery,
  setDisplayCount,
  toggleTypeFilter,
  setComprehensionFilter,
  setTypeFilter,
  setSelectedContent,
  getContentStatus,
  loadVocabForContent,
  comprehensionColor,

  searchQuery,
  typeFilter,
  comprehensionFilter,
  hasActiveFilters,
  visibleContent,
  loadingContent,
  displayCount,
  sortedContent,
}: HomeViewProps) {
  return (
    <section>
      <div className="mb-6 flex items-baseline justify-between">
        <h2 className="text-2xl font-semibold tracking-tight">
          Recommended For You
        </h2>
        <p className="text-sm text-gray-500 uppercase tracking-widest font-medium">
          Sorted by difficulty
        </p>
      </div>

      {/* Search + filters (#12, #13) */}
      <div className="mb-6 space-y-3">
        <div className="flex flex-wrap gap-2 items-center">
          {/* Search */}
          <div className="relative flex-1 min-w-[180px] max-w-xs">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
            <input
              type="text"
              placeholder="Search by title..."
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setDisplayCount(12);
              }}
              className="w-full pl-9 pr-3 py-2 text-sm rounded-xl border border-gray-200 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-300"
            />
          </div>

          {/* Type filter */}
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

          {/* Comprehension filter (#13) */}
          <div className="flex rounded-xl border border-gray-200 overflow-hidden bg-white text-xs font-semibold">
            {(['all', 'almost', 'ready'] as const).map((f, i) => (
              <button
                key={f}
                onClick={() => {
                  setComprehensionFilter(f);
                  setDisplayCount(12);
                }}
                className={`px-3 py-2 transition-colors ${i > 0 ? 'border-l border-gray-200' : ''} ${
                  comprehensionFilter === f
                    ? 'bg-indigo-600 text-white'
                    : 'text-gray-600 hover:bg-gray-50'
                }`}
              >
                {f === 'all'
                  ? 'All'
                  : f === 'almost'
                    ? 'Almost There ≥90%'
                    : 'Ready ✓'}
              </button>
            ))}
          </div>

          {/* Clear filters */}
          {hasActiveFilters && (
            <button
              onClick={() => {
                setSearchQuery('');
                setTypeFilter(new Set());
                setComprehensionFilter('all');
                setDisplayCount(12);
              }}
              className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-700 transition-colors px-2 py-2"
            >
              <X className="w-3.5 h-3.5" /> Clear
            </button>
          )}
        </div>

        {/* "Almost There" explanation banner (#13) */}
        {comprehensionFilter === 'almost' && (
          <div className="bg-green-50 border border-green-100 rounded-2xl px-4 py-3 text-sm text-green-800">
            <strong>i+1 sweet spot</strong> — content where you know ≥90% of
            words. Challenging enough to encounter new vocabulary, easy enough
            to enjoy reading.
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {visibleContent.map((content) => {
          const status = getContentStatus(content.id);
          const isLoading =
            loadingContent[content.id] || status.totalCount === 0;

          return (
            <div
              key={content.id}
              onClick={() => {
                loadVocabForContent(content);
                setSelectedContent(content);
              }}
              className="bg-white rounded-3xl overflow-hidden cursor-pointer shadow-sm hover:shadow-md transition-all border border-gray-100 group flex flex-col h-full"
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
                {/* Comprehension badge (#11) */}
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
                <p className="text-sm text-gray-500 line-clamp-2 mb-4 flex-grow">
                  {content.description}
                </p>

                {/* In "Almost There" mode, show unknown word chips (#13) */}
                {comprehensionFilter === 'almost' &&
                  !isLoading &&
                  status.unknownCount > 0 && (
                    <div className="flex flex-wrap gap-1 mb-3">
                      {status.unknownWords.slice(0, 6).map((w) => (
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
              onClick={() => {
                setSearchQuery('');
                setTypeFilter(new Set());
                setComprehensionFilter('all');
              }}
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
  setSearchQuery: React.Dispatch<React.SetStateAction<string>>;
  setDisplayCount: React.Dispatch<React.SetStateAction<number>>;
  setComprehensionFilter: React.Dispatch<React.SetStateAction<'all' | 'almost' | 'ready'>>;
  setTypeFilter: React.Dispatch<React.SetStateAction<Set<string>>>;
  loadVocabForContent: (content: Content) => void;
  setSelectedContent: React.Dispatch<React.SetStateAction<Content | null>>;
  

  toggleTypeFilter: (type: 'story' | 'video' | 'music') => void;
  getContentStatus: (contentId: string) => {
    difficulty: number;
    totalUnknownScore: number;
    unknownCount: number;
    totalCount: number;
    score: number;
    unknownWords: WordInfo[];
    comprehension: number;
  };
  comprehensionColor: (comprehension: number) => string;


  searchQuery: string;
  typeFilter: Set<string>;
  comprehensionFilter: 'all' | 'almost' | 'ready';
  hasActiveFilters: boolean;
  visibleContent: Content[];
  loadingContent: Record<string, boolean>;
  displayCount: number;
  sortedContent: Content[];
};

export default HomeView;
