import { CheckCircle, Plus, Settings } from 'lucide-react';
import { useEffect, useState } from 'react';
import { ContentDetail } from './components/ContentDetail';
import { ImportModal } from './components/ImportModal';
import { SettingsPage } from './components/SettingsPage';
import { WordDetailModal } from './components/WordDetailModal';
import { WordDetailPage } from './components/WordDetailPage';
import { Content } from './data/content';
import { useContentBootstrap } from './hooks/useContentBootstrap';
import { useContentData } from './hooks/useContentData';
import { useHomeFilters } from './hooks/useHomeFilters';
import { useUrlRouting } from './hooks/useUrlRouting';
import { WordInfo } from './types';
import HomeView from './views/HomeView';
import ScoringView from './views/ScoringView';
import VocabView from './views/VocabView';

export default function App() {
  const {
    knownWords,
    contentVocab,
    loadingContent,
    wkData,
    loadVocabForContent,
    getContentStatus,
    markWordsAsKnown,
    clearKnownWords,
    clearContentVocab,
    updateWord,
    setContentVocab,
    refreshWaniKaniData,
  } = useContentData();

  const { diskContent, setCustomContent, allContent } = useContentBootstrap(wkData, setContentVocab);

  const [selectedContent, setSelectedContent] = useState<Content | null>(null);
  const [selectedWord, setSelectedWord] = useState<string | null>(null);
  const [view, setView] = useState<'home' | 'vocab' | 'scoring' | 'settings'>('home');
  const [showImportOpts, setShowImportOpts] = useState(false);
  const [isConfirmingReset, setIsConfirmingReset] = useState(false);
  const [editingWord, setEditingWord] = useState<WordInfo | null>(null);

  const { navigateToWord } = useUrlRouting({ setSelectedWord });

  // #259 P4: document.title was always the static "Kotonoha" from index.html
  // and never reflected the active view. ContentDetail/ContentReader/
  // WordDetailPage/LessonProcess set their own title while they're shown
  // (selectedContent/selectedWord below), so this only needs to cover the
  // top-level shell views.
  useEffect(() => {
    if (selectedContent || selectedWord) return;
    const titles: Record<typeof view, string> = {
      home: 'Kotonoha — Content',
      vocab: 'My Vocabulary — Kotonoha',
      scoring: 'Scoring Guide — Kotonoha',
      settings: 'Settings — Kotonoha',
    };
    document.title = titles[view];
  }, [view, selectedContent, selectedWord]);

  const navigateBack = () => {
    if (selectedWord) {
      setSelectedWord(null);
      window.history.back();
    }
  };

  const {
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
  } = useHomeFilters(allContent, getContentStatus, contentVocab);

  const comprehensionColor = (pct: number) => {
    if (pct >= 90) return 'text-green-700 bg-green-50 border-green-200';
    if (pct >= 70) return 'text-yellow-700 bg-yellow-50 border-yellow-200';
    return 'text-red-700 bg-red-50 border-red-200';
  };

  if (selectedWord) {
    return (
      <>
        <WordDetailPage
          word={selectedWord}
          onBack={navigateBack}
          allWords={Object.values(contentVocab).flat() as WordInfo[]}
          onNavigateWord={navigateToWord}
          onEdit={(wordInfo) => setEditingWord(wordInfo)}
        />
        {editingWord && (
          <WordDetailModal
            w={editingWord}
            onClose={() => setEditingWord(null)}
            onSave={(wordStr, updatedMap) => updateWord(wordStr, updatedMap)}
          />
        )}
      </>
    );
  }

  if (selectedContent) {
    return (
      <ContentDetail
        content={selectedContent}
        onBack={() => setSelectedContent(null)}
        status={getContentStatus(selectedContent.id)}
        loading={loadingContent[selectedContent.id]}
        markWordsAsKnown={markWordsAsKnown}
        knownWordSet={knownWords}
        onForceReload={() => loadVocabForContent(selectedContent, true)}
        onUpdateContent={(updatedContent) => {
          let updatedVocab = false;
          if (updatedContent.text !== selectedContent.text) {
             loadVocabForContent(updatedContent, true);
             updatedVocab = true;
          }

          if (!diskContent.find(c => c.id === updatedContent.id)) {
             setCustomContent(prev => prev.map(c => c.id === updatedContent.id ? updatedContent : c));
          } else {
             // Let's copy the Initial content to custom if edited? Or forbid?
             // Actually just push it to customContent so it overrides
             setCustomContent(prev => {
                const existIdx = prev.findIndex(c => c.id === updatedContent.id);
                if (existIdx >= 0) {
                   const m = [...prev];
                   m[existIdx] = updatedContent;
                   return m;
                }
                return [updatedContent, ...prev];
             });
          }
          setSelectedContent(updatedContent);
        }}
        onAddWord={async (addedWordStr) => {
          try {
            const res = await fetch("/api/update-words", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ words: [{ word: addedWordStr, reading: addedWordStr, meaning: "Custom Word", jp: 0, joyo: false, score: 0 }] })
            });
            const gradedWords = await res.json();
            const newWord = gradedWords[0];

            const newVocab = { ...contentVocab };
            const existingList = newVocab[selectedContent.id] || [];
            newVocab[selectedContent.id] = [newWord, ...existingList];

            setContentVocab(newVocab);
            localStorage.setItem('contentVocab', JSON.stringify(newVocab));
          } catch (e) {
            console.error(e);
            alert('Failed to add word');
          }
        }}
        onWordClick={navigateToWord}
      />
    );
  }

  return (
    <div className="min-h-screen bg-[#F5F2ED] text-gray-900 font-sans">
      {/* #259 I3: at 390px the logo + 4 nav links overflowed the header,
          clipping "Settings" to "Setting" with no way to scroll or wrap to
          it. Tighter mobile padding/gaps, a smaller logo, and short labels
          below the sm breakpoint (full labels return at sm+) keep everything
          on one row without adding a hamburger menu. */}
      <header className="bg-white px-3 sm:px-6 py-3 sm:py-4 shadow-sm border-b border-gray-200 sticky top-0 z-10 w-full">
        <div className="max-w-5xl mx-auto flex items-center justify-between gap-1">
          <h1
            className="text-base sm:text-xl font-semibold tracking-tight cursor-pointer shrink-0"
            onClick={() => setView('home')}
          >
            Kotonoha <span className="text-xs text-gray-500 font-normal uppercase tracking-widest ml-2 hidden sm:inline">Language Learning</span>
          </h1>
          <div className="flex items-center gap-1.5 sm:gap-4 min-w-0">
            <button
              onClick={() => setShowImportOpts(true)}
              className="hidden sm:flex text-sm font-medium items-center gap-1.5 px-3 py-1.5 bg-indigo-50 text-indigo-700 hover:bg-indigo-100 rounded-lg transition-colors border border-indigo-200"
            >
              <Plus className="w-4 h-4" /> Import Text
            </button>
            <button
              onClick={() => setView('home')}
              className={`text-xs sm:text-sm font-medium transition-colors whitespace-nowrap ${view === 'home' ? 'text-indigo-600' : 'text-gray-500 hover:text-gray-900'}`}
            >
              Content
            </button>
            <button
              onClick={() => setView('vocab')}
              className={`text-xs sm:text-sm font-medium transition-colors whitespace-nowrap ${view === 'vocab' ? 'text-indigo-600' : 'text-gray-500 hover:text-gray-900'}`}
            >
              <span className="sm:hidden">Vocab</span>
              <span className="hidden sm:inline">My Vocab</span>
            </button>
            <button
              onClick={() => setView('scoring')}
              className={`text-xs sm:text-sm font-medium transition-colors whitespace-nowrap ${view === 'scoring' ? 'text-indigo-600' : 'text-gray-500 hover:text-gray-900'}`}
            >
              <span className="sm:hidden">Scoring</span>
              <span className="hidden sm:inline">Scoring Guide</span>
            </button>
            <button
              onClick={() => setView('settings')}
              className={`text-xs sm:text-sm font-medium transition-colors flex items-center gap-1 whitespace-nowrap ${view === 'settings' ? 'text-indigo-600' : 'text-gray-500 hover:text-gray-900'}`}
            >
              <Settings className="w-4 h-4 shrink-0" /> Settings
            </button>
            <div className="hidden sm:flex items-center gap-2 bg-gray-50 px-3 py-1.5 rounded-full border border-gray-100">
              <CheckCircle className="w-4 h-4 text-green-600" />
              <span className="text-sm font-medium">{knownWords.size} Known</span>
            </div>
          </div>
        </div>
      </header>
      
      {showImportOpts && (
        <ImportModal 
          onClose={() => setShowImportOpts(false)}
          onImport={(newContent) => {
            setCustomContent(prev => [newContent, ...prev]);
            loadVocabForContent(newContent);
            setSelectedContent(newContent);
          }}
        />
      )}

      {editingWord && (
        <WordDetailModal
          w={editingWord}
          onClose={() => setEditingWord(null)}
          onSave={(wordStr, updatedMap) => updateWord(wordStr, updatedMap)}
        />
      )}

      <main className="max-w-5xl mx-auto p-6 space-y-8">
        {view === 'settings' && (
          <SettingsPage onWaniKaniSync={refreshWaniKaniData} />
        )}

        {view === 'home' && (
          <HomeView
            setDisplayCount={setDisplayCount}
            searchQuery={searchQuery}
            setSearchQuery={setSearchQuery}
            searchScope={searchScope}
            toggleSearchScope={toggleSearchScope}
            typeFilter={typeFilter}
            toggleTypeFilter={toggleTypeFilter}
            levelFilter={levelFilter}
            toggleLevelFilter={toggleLevelFilter}
            availableLevels={availableLevels}
            tagFilter={tagFilter}
            toggleTagFilter={toggleTagFilter}
            availableTags={availableTags}
            lengthFilter={lengthFilter}
            setLengthFilter={setLengthFilter}
            comprehensionRange={comprehensionRange}
            setComprehensionRange={setComprehensionRange}
            sortBy={sortBy}
            setSortBy={setSortBy}
            sortDir={sortDir}
            setSortDir={setSortDir}
            hasActiveFilters={hasActiveFilters}
            onClearFilters={clearAllFilters}
            getContentStatus={getContentStatus}
            visibleContent={visibleContent}
            loadingContent={loadingContent}
            loadVocabForContent={loadVocabForContent}
            setSelectedContent={setSelectedContent}
            comprehensionColor={comprehensionColor}
            displayCount={displayCount}
            sortedContent={sortedContent}
          />
        )}

        {view === 'vocab' && (
          <VocabView
            setDisplayCount={setDisplayCount}
            clearContentVocab={clearContentVocab}
            knownWords={knownWords}
            contentVocab={contentVocab}
            diskContent={diskContent}
            isConfirmingReset={isConfirmingReset}
            setIsConfirmingReset={setIsConfirmingReset}
            clearKnownWords={clearKnownWords}
            navigateToWord={navigateToWord}
          />

        )}

        {view === 'scoring' && (
          <ScoringView />
        )}
      </main>
    </div>
  );
}
