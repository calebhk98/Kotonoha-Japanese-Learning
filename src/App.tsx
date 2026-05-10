import { useState, useEffect, useMemo } from 'react';
import { getAllContentWords } from './lib/api';
import { BookOpen, Video, Music, CheckCircle, ChevronRight, PlayCircle, Loader2, Library, Plus, Settings, Search, X } from 'lucide-react';
import { Content } from './data/content';
import { useContentData, applyWaniKaniToWords } from './hooks/useContentData';
import { ContentDetail } from './components/ContentDetail';
import { ImportModal } from './components/ImportModal';
import { WordDetailModal } from './components/WordDetailModal';
import { WordDetailPage } from './components/WordDetailPage';
import { SettingsPage } from './components/SettingsPage';
import { WordInfo } from './types';
import HomeView from './views/HomeView';
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

  const [customContent, setCustomContent] = useState<Content[]>(() => {
    const saved = localStorage.getItem('customContent');
    if (!saved) return [];
    try {
      return JSON.parse(saved);
    } catch (e) {
      console.error("Failed to parse custom content from localStorage:", e);
      return [];
    }
  });
  const [diskContent, setDiskContent] = useState<Content[]>([]);
  const [selectedContent, setSelectedContent] = useState<Content | null>(null);
  const [selectedWord, setSelectedWord] = useState<string | null>(null);
  const [displayCount, setDisplayCount] = useState(12);
  const [view, setView] = useState<'home' | 'vocab' | 'scoring' | 'settings'>('home');
  const [showImportOpts, setShowImportOpts] = useState(false);
  const [isConfirmingReset, setIsConfirmingReset] = useState(false);
  const [editingWord, setEditingWord] = useState<WordInfo | null>(null);

  // Fetch content from disk-based system
  useEffect(() => {
    const fetchContent = async () => {
      try {
        const response = await fetch('/api/content');
        if (!response.ok) {
          console.error(`Failed to fetch content: ${response.status}`);
          return;
        }
        const data = await response.json();
        setDiskContent(Array.isArray(data) ? data : []);
        console.log(`[App] Loaded ${data.length} content items from server`);
      } catch (error) {
        console.error('Failed to fetch content from server:', error);
      }
    };
    fetchContent();
  }, []);

  // Filter state for home view (#12, #13)
  const [searchQuery, setSearchQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<Set<string>>(new Set());
  const [comprehensionFilter, setComprehensionFilter] = useState<'all' | 'almost' | 'ready'>('all');

  // URL routing for word detail page
  useEffect(() => {
    const handlePopState = () => {
      const path = window.location.pathname;
      if (path.startsWith('/word/')) {
        const word = decodeURIComponent(path.slice(6));
        setSelectedWord(word);
      } else {
        setSelectedWord(null);
      }
    };

    window.addEventListener('popstate', handlePopState);
    handlePopState();
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  const navigateToWord = (word: string) => {
    setSelectedWord(word);
    window.history.pushState({ type: 'word', word, scrollPos: window.scrollY }, '', `/word/${encodeURIComponent(word)}`);
  };

  const navigateBack = () => {
    if (selectedWord) {
      setSelectedWord(null);
      window.history.back();
    }
  };

  const ALL_CONTENT = useMemo(() => {
    const map = new Map<string, Content>();
    for (const c of diskContent) map.set(c.id, c);
    for (const c of customContent) map.set(c.id, c);
    return Array.from(map.values());
  }, [diskContent, customContent]);

  useEffect(() => {
    localStorage.setItem('customContent', JSON.stringify(customContent));
  }, [customContent]);

  // Track whether we've attempted batch extraction
  const [batchExtractionAttempted, setBatchExtractionAttempted] = useState(false);

  // Background startup: load known vocab from server, then batch-extract only what's missing
  useEffect(() => {
    const startup = async () => {
      if (!ALL_CONTENT.length) return;

      // Step 1: Load all already-processed content words from server
      let serverVocab: Record<string, WordInfo[]> = {};
      try {
        serverVocab = await getAllContentWords();
        const count = Object.keys(serverVocab).length;
        if (count > 0) {
          console.log(`[App] Loaded vocab for ${count} content items from server`);
          // Apply WaniKani multipliers if available
          if (wkData) {
            for (const id of Object.keys(serverVocab)) {
              serverVocab[id] = applyWaniKaniToWords(serverVocab[id], wkData);
            }
          }
          setContentVocab(prev => ({ ...prev, ...serverVocab }));
        }
      } catch (e) {
        console.warn('[App] Could not load server vocab, will extract fresh:', e);
      }

      // Step 2: Identify content that has no server-side data yet
      const missing = ALL_CONTENT.filter(c => !serverVocab[c.id]);
      if (missing.length === 0) {
        console.log('[App] All content already processed — skipping batch-extract');
        setBatchExtractionAttempted(true);
        return;
      }

      console.log(`[App] ${missing.length} content items need extraction`);

      const fetchWithRetry = async (url: string, options: RequestInit, maxRetries = 3) => {
        let lastError: any;
        for (let attempt = 0; attempt < maxRetries; attempt++) {
          try {
            const res = await fetch(url, options);
            if (res.ok) return res;
            if (res.status !== 504) return res;
            lastError = new Error(`504 Gateway Timeout`);
          } catch (e) {
            lastError = e;
          }
          if (attempt < maxRetries - 1) {
            const delayMs = Math.pow(2, attempt) * 1000;
            console.log(`[App] Request failed, retrying in ${delayMs}ms (attempt ${attempt + 1}/${maxRetries - 1})`);
            await new Promise(resolve => setTimeout(resolve, delayMs));
          }
        }
        throw lastError || new Error(`Failed after ${maxRetries} attempts`);
      };

      // Step 3: Batch-extract only the missing content
      const texts = missing.map(c => ({ id: c.id, text: c.text }));
      const CHUNK_SIZE = 20;
      let totalProcessed = 0;

      for (let i = 0; i < texts.length; i += CHUNK_SIZE) {
        const chunk = texts.slice(i, i + CHUNK_SIZE);
        const chunkNum = Math.floor(i / CHUNK_SIZE) + 1;
        const totalChunks = Math.ceil(texts.length / CHUNK_SIZE);
        console.log(`[App] Extracting chunk ${chunkNum}/${totalChunks}`);

        try {
          const res = await fetchWithRetry("/api/batch-extract", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ texts: chunk })
          });

          if (!res.ok) {
            console.warn(`[App] Batch extract chunk ${chunkNum} failed with status ${res.status}`);
            continue;
          }

          const results = await res.json();
          const newVocab: Record<string, WordInfo[]> = {};
          for (const result of results) {
            if (result.words && Array.isArray(result.words)) {
              let words: WordInfo[] = result.words;
              if (wkData) words = applyWaniKaniToWords(words, wkData);
              newVocab[result.id] = words;
              totalProcessed++;
            }
          }

          if (Object.keys(newVocab).length > 0) {
            setContentVocab(prev => ({ ...prev, ...newVocab }));
          }
        } catch (chunkError) {
          console.error(`[App] Failed to process chunk ${chunkNum}:`, chunkError);
        }

        if (i + CHUNK_SIZE < texts.length) {
          await new Promise(resolve => setTimeout(resolve, 5000));
        }
      }

      console.log(`[App] Background extraction complete: ${totalProcessed}/${missing.length} new items processed`);
      setBatchExtractionAttempted(true);
    };

    const shouldRun = !batchExtractionAttempted && ALL_CONTENT.length > 0;
    if (shouldRun) {
      const timer = setTimeout(startup, 500);
      return () => clearTimeout(timer);
    }
  }, [ALL_CONTENT.length, batchExtractionAttempted, wkData]);

  // Sort and filter content (#11, #12, #13)
  const sortedContent = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return [...ALL_CONTENT]
      .filter(c => {
        if (q && !c.title.toLowerCase().includes(q)) return false;
        if (typeFilter.size > 0 && !typeFilter.has(c.type)) return false;
        const status = getContentStatus(c.id);
        if (status.totalCount === 0) return comprehensionFilter === 'all'; // unloaded items only show in 'all'
        if (comprehensionFilter === 'almost') return status.comprehension >= 90 && status.comprehension < 100;
        if (comprehensionFilter === 'ready') return status.comprehension === 100;
        return true;
      })
      .sort((a, b) => {
        const statusA = getContentStatus(a.id);
        const statusB = getContentStatus(b.id);
        if (statusA.totalCount === 0 && statusB.totalCount !== 0) return 1;
        if (statusA.totalCount !== 0 && statusB.totalCount === 0) return -1;
        return statusA.score - statusB.score;
      });
  }, [ALL_CONTENT, searchQuery, typeFilter, comprehensionFilter, getContentStatus]);

  const visibleContent = sortedContent.slice(0, displayCount);

  const toggleTypeFilter = (type: string) => {
    setTypeFilter(prev => {
      const next = new Set(prev);
      next.has(type) ? next.delete(type) : next.add(type);
      return next;
    });
    setDisplayCount(12);
  };

  const hasActiveFilters = searchQuery.trim() !== '' || typeFilter.size > 0 || comprehensionFilter !== 'all';

  const comprehensionColor = (pct: number) => {
    if (pct >= 90) return 'text-green-700 bg-green-50 border-green-200';
    if (pct >= 70) return 'text-yellow-700 bg-yellow-50 border-yellow-200';
    return 'text-red-700 bg-red-50 border-red-200';
  };

  if (selectedWord) {
    return (
      <WordDetailPage
        word={selectedWord}
        onBack={navigateBack}
        allWords={Object.values(contentVocab).flat() as WordInfo[]}
        onNavigateWord={navigateToWord}
        onEdit={(wordInfo) => setEditingWord(wordInfo)}
      />
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
      <header className="bg-white px-6 py-4 shadow-sm border-b border-gray-200 sticky top-0 z-10 w-full">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <h1 className="text-xl font-semibold tracking-tight cursor-pointer" onClick={() => setView('home')}>
            Kotonoha <span className="text-xs text-gray-500 font-normal uppercase tracking-widest ml-2 hidden sm:inline">Language Learning</span>
          </h1>
          <div className="flex items-center gap-4">
            <button 
              onClick={() => setShowImportOpts(true)}
              className="hidden sm:flex text-sm font-medium items-center gap-1.5 px-3 py-1.5 bg-indigo-50 text-indigo-700 hover:bg-indigo-100 rounded-lg transition-colors border border-indigo-200"
            >
              <Plus className="w-4 h-4" /> Import Text
            </button>
            <button 
              onClick={() => setView('home')}
              className={`text-sm font-medium transition-colors ${view === 'home' ? 'text-indigo-600' : 'text-gray-500 hover:text-gray-900'}`}
            >
              Content
            </button>
            <button 
              onClick={() => setView('vocab')}
              className={`text-sm font-medium transition-colors ${view === 'vocab' ? 'text-indigo-600' : 'text-gray-500 hover:text-gray-900'}`}
            >
              My Vocab
            </button>
            <button
              onClick={() => setView('scoring')}
              className={`text-sm font-medium transition-colors ${view === 'scoring' ? 'text-indigo-600' : 'text-gray-500 hover:text-gray-900'}`}
            >
              Scoring Guide
            </button>
            <button
              onClick={() => setView('settings')}
              className={`text-sm font-medium transition-colors flex items-center gap-1 ${view === 'settings' ? 'text-indigo-600' : 'text-gray-500 hover:text-gray-900'}`}
            >
              <Settings className="w-4 h-4" /> Settings
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
            setSearchQuery={setSearchQuery}
            setDisplayCount={setDisplayCount}
            searchQuery={searchQuery}
            toggleTypeFilter={toggleTypeFilter}
            typeFilter={typeFilter}
            setComprehensionFilter={setComprehensionFilter}
            comprehensionFilter={comprehensionFilter}
            setTypeFilter={setTypeFilter}
            hasActiveFilters={hasActiveFilters}
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
            setEditingWord={setEditingWord}
          />

        )}

        {view === 'scoring' && (
          <section className="space-y-6">
            <h2 className="text-2xl font-semibold tracking-tight mb-8">Scoring Guide</h2>
            <div className="bg-white p-8 rounded-3xl border border-gray-100 shadow-sm text-gray-800">
              <h3 className="text-xl font-bold mb-4 border-b border-gray-100 pb-2">Base JLPT Points</h3>
              <p className="text-sm text-gray-600 mb-4">Each word receives a base score according to its estimated JLPT level. Rarer words score higher.</p>
              <ul className="list-disc list-inside space-y-2 mb-8">
                <li><span className="font-medium text-indigo-600">N5</span>: +15 pts (Fundamentals)</li>
                <li><span className="font-medium text-indigo-600">N4</span>: +25 pts</li>
                <li><span className="font-medium text-indigo-600">N3</span>: +50 pts</li>
                <li><span className="font-medium text-indigo-600">N2</span>: +75 pts</li>
                <li><span className="font-medium text-indigo-600">N1</span>: +100 pts (Native / Advanced)</li>
              </ul>

              <h3 className="text-xl font-bold mb-4 border-b border-gray-100 pb-2">Kanji Joyo Penalties</h3>
              <p className="text-sm text-gray-600 mb-4">If a word contains kanji, it gets bonus penalty points based on the highest-grade kanji it contains.</p>
              <ul className="list-disc list-inside space-y-2 mb-8">
                <li><span className="font-medium">Grade 1</span>: +5 pts</li>
                <li><span className="font-medium">Grade 2</span>: +7 pts</li>
                <li><span className="font-medium">Grade 3</span>: +10 pts</li>
                <li><span className="font-medium">Grade 4</span>: +12 pts</li>
                <li><span className="font-medium">Grade 5</span>: +15 pts</li>
                <li><span className="font-medium">Grade 6</span>: +20 pts</li>
                <li><span className="font-medium">Grade 8 (Middle School)</span>: +25 pts</li>
                <li><span className="font-medium">Grade 9+ (Non-Joyo)</span>: +30 pts</li>
              </ul>

              <h3 className="text-xl font-bold mb-4 border-b border-gray-100 pb-2">Frequency Penalties</h3>
              <p className="text-sm text-gray-600 mb-4">Words are penalized or rewarded based on their frequency in standard Japanese corpora. Values range from -20 to +50.</p>
              <ul className="list-disc list-inside space-y-2">
                <li><span className="font-medium text-red-500">Very Common</span> (ichi1, news1, common kana): -20 pts</li>
                <li><span className="font-medium text-orange-500">Common</span> (ichi2, news2): -10 pts</li>
                <li><span className="font-medium">Frequent Loan/Spec 1</span> (gai1, spec1): 0 pts</li>
                <li><span className="font-medium">Frequent Loan/Spec 2</span> (gai2, spec2): +5 pts</li>
                <li><span className="font-medium">General Corpus Rank 1-5</span> (nf01-nf05): +10 pts</li>
                <li><span className="font-medium">General Corpus Rank 6-10</span> (nf06-nf10): +15 pts</li>
                <li><span className="font-medium text-green-600">General Corpus Rank 11-20</span> (nf11-nf20): +20 pts</li>
                <li><span className="font-medium text-emerald-600">General Corpus Rank 21-30</span> (nf21-nf30): +30 pts</li>
                <li><span className="font-medium text-teal-600">General Corpus Rank 31-48</span> (nf31-nf48): +40 pts</li>
                <li><span className="font-medium text-blue-600">Very Rare</span> (No frequency tags): +50 pts</li>
              </ul>
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
