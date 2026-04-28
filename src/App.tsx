import { useState, useEffect, useMemo } from 'react';
import { BookOpen, Video, Music, CheckCircle, ChevronRight, PlayCircle, Loader2, Library, Plus } from 'lucide-react';
import { INITIAL_CONTENT, GENERATED_CONTENT, Content } from './data/content';
import { useContentData } from './hooks/useContentData';
import { ContentDetail } from './components/ContentDetail';
import { ImportModal } from './components/ImportModal';
import { WordDetailModal } from './components/WordDetailModal';
import { WordInfo } from './types';

export default function App() {
  const { 
    knownWords, 
    contentVocab, 
    loadingContent, 
    loadVocabForContent, 
    getContentStatus,
    markWordsAsKnown,
    clearKnownWords,
    updateWord,
    setContentVocab
  } = useContentData();

  const [customContent, setCustomContent] = useState<Content[]>(() => {
    const saved = localStorage.getItem('customContent');
    return saved ? JSON.parse(saved) : [];
  });
  const [selectedContent, setSelectedContent] = useState<Content | null>(null);
  const [displayCount, setDisplayCount] = useState(12);
  const [view, setView] = useState<'home' | 'vocab' | 'scoring'>('home');
  const [showImportOpts, setShowImportOpts] = useState(false);
  const [isConfirmingReset, setIsConfirmingReset] = useState(false);
  const [editingWord, setEditingWord] = useState<WordInfo | null>(null);

  const ALL_CONTENT = useMemo(() => {
    const map = new Map<string, Content>();
    for (const c of INITIAL_CONTENT) map.set(c.id, c);
    for (const c of customContent) map.set(c.id, c);
    return Array.from(map.values());
  }, [customContent]);

  useEffect(() => {
    localStorage.setItem('customContent', JSON.stringify(customContent));
  }, [customContent]);

  // Kick off loading for all content on startup so we can score and sort them
  useEffect(() => {
    let mounted = true;
    const loadAll = async () => {
      // Process in batches of 5 to not overwhelm the browser/server
      for (let i = 0; i < ALL_CONTENT.length; i += 5) {
        if (!mounted) break;
        const batch = ALL_CONTENT.slice(i, i + 5);
        await Promise.all(batch.map(content => loadVocabForContent(content)));
      }
    };
    loadAll();
    return () => { mounted = false; };
  }, [loadVocabForContent]);

  // Sort content by difficulty score
  const sortedContent = [...ALL_CONTENT].sort((a, b) => {
    const statusA = getContentStatus(a.id);
    const statusB = getContentStatus(b.id);
    
    // If not loaded, put to end
    if (statusA.totalCount === 0 && statusB.totalCount !== 0) return 1;
    if (statusA.totalCount !== 0 && statusB.totalCount === 0) return -1;
    
    return statusA.score - statusB.score;
  });

  const visibleContent = sortedContent.slice(0, displayCount);

  if (selectedContent) {
    return (
      <ContentDetail 
        content={selectedContent} 
        onBack={() => setSelectedContent(null)}
        status={getContentStatus(selectedContent.id)}
        loading={loadingContent[selectedContent.id]}
        markWordsAsKnown={markWordsAsKnown}
        onForceReload={() => loadVocabForContent(selectedContent, true)}
        onUpdateContent={(updatedContent) => {
          let updatedVocab = false;
          if (updatedContent.text !== selectedContent.text) {
             loadVocabForContent(updatedContent, true);
             updatedVocab = true;
          }
          
          if (!INITIAL_CONTENT.find(c => c.id === updatedContent.id)) {
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
        {view === 'home' && (
          <section>
            <div className="mb-4 flex items-baseline justify-between">
              <h2 className="text-2xl font-semibold tracking-tight">Recommended For You</h2>
              <p className="text-sm text-gray-500 uppercase tracking-widest font-medium">Sorted by difficulty</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {visibleContent.map(content => {
                const status = getContentStatus(content.id);
                const isLoading = loadingContent[content.id] || status.totalCount === 0;

                return (
                  <div 
                    key={content.id} 
                    onClick={() => setSelectedContent(content)}
                    className="bg-white rounded-3xl overflow-hidden cursor-pointer shadow-sm hover:shadow-md transition-all border border-gray-100 group flex flex-col h-full"
                  >
                    <div className="aspect-[4/3] w-full bg-gray-100 relative overflow-hidden">
                      {content.imageUrl ? (
                        <img src={content.imageUrl} alt={content.title} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center bg-indigo-50">
                          {content.type === 'story' && <BookOpen className="w-12 h-12 text-indigo-300" />}
                          {content.type === 'video' && <Video className="w-12 h-12 text-indigo-300" />}
                          {content.type === 'music' && <Music className="w-12 h-12 text-indigo-300" />}
                        </div>
                      )}
                      <div className="absolute top-4 left-4 bg-white/90 backdrop-blur-sm px-3 py-1 rounded-full flex items-center gap-1.5 shadow-sm">
                        {content.type === 'story' && <BookOpen className="w-3.5 h-3.5 text-indigo-600" />}
                        {content.type === 'video' && <Video className="w-3.5 h-3.5 text-indigo-600" />}
                        {content.type === 'music' && <Music className="w-3.5 h-3.5 text-indigo-600" />}
                        <span className="text-xs font-semibold uppercase tracking-wider text-gray-800">{content.type}</span>
                      </div>
                    </div>
                    
                    <div className="p-5 flex flex-col flex-grow">
                      <h3 className="font-semibold text-lg mb-2">{content.title}</h3>
                      <p className="text-sm text-gray-500 line-clamp-2 mb-4 flex-grow">{content.description}</p>
                      
                      {isLoading ? (
                        <div className="flex items-center gap-2 text-sm text-gray-400">
                          <Loader2 className="w-4 h-4 animate-spin" />
                          Analyzing vocabulary...
                        </div>
                      ) : (
                        <div className="flex items-center justify-between border-t border-gray-50 pt-4 mt-auto">
                          <div className="flex flex-col">
                            <span className="text-xs text-gray-400 uppercase tracking-wider">Unknown</span>
                            <span className="font-medium text-indigo-600">{status.unknownCount} words</span>
                          </div>
                          <div className="flex flex-col items-end">
                            <span className="text-xs text-gray-400 uppercase tracking-wider">Score</span>
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
            </div>
            
            {displayCount < sortedContent.length && (
              <div className="mt-8 flex justify-center">
                <button 
                  onClick={() => setDisplayCount(prev => prev + 12)}
                  className="bg-white border border-gray-200 text-gray-700 px-6 py-3 rounded-full font-medium hover:bg-gray-50 shadow-sm transition-all"
                >
                  Load More Content ({sortedContent.length - displayCount} remaining)
                </button>
              </div>
            )}
          </section>
        )}

        {view === 'vocab' && (
          <section className="space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-8 gap-4">
              <h2 className="text-2xl font-semibold tracking-tight"><Library className="w-6 h-6 inline-block mr-2 text-indigo-600" /> Your Vocabulary</h2>
              <div className="flex flex-col sm:flex-row items-end sm:items-center gap-4">
                <button 
                  onClick={() => {
                    localStorage.removeItem('contentVocab');
                    window.location.href = window.location.href.split('?')[0];
                  }}
                  className="text-xs text-indigo-600 hover:text-indigo-800 bg-indigo-50 hover:bg-indigo-100 px-3 py-1.5 rounded-lg transition-colors font-medium border border-indigo-200"
                >
                  Clear Vocab Cache
                </button>

                <button 
                  onClick={() => {
                    const data = {
                      knownWords: Array.from(knownWords),
                      contentVocab
                    };
                    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `kotonoha-backup-${new Date().toISOString().slice(0, 10)}.json`;
                    a.click();
                    URL.revokeObjectURL(url);
                  }}
                  className="text-xs text-green-600 hover:text-green-800 bg-green-50 hover:bg-green-100 px-3 py-1.5 rounded-lg transition-colors font-medium border border-green-200"
                >
                  Export Data
                </button>

                <label className="cursor-pointer text-xs text-blue-600 hover:text-blue-800 bg-blue-50 hover:bg-blue-100 px-3 py-1.5 rounded-lg transition-colors font-medium border border-blue-200">
                  Import Data
                  <input 
                    type="file" 
                    accept=".json" 
                    className="hidden" 
                    onChange={async (e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      const reader = new FileReader();
                      reader.onload = async (event) => {
                        try {
                          const parsed = JSON.parse(event.target?.result as string);
                          if (parsed.knownWords && Array.isArray(parsed.knownWords)) {
                            const newKnown = new Set([...Array.from(knownWords), ...parsed.knownWords]);
                            localStorage.setItem('knownWords', JSON.stringify(Array.from(newKnown)));
                          }
                          
                          if (parsed.contentVocab && typeof parsed.contentVocab === 'object') {
                            const newVocab = { ...contentVocab };
                            for (const [storyId, importedWords] of Object.entries(parsed.contentVocab)) {
                              if (Array.isArray(importedWords)) {
                                // Hit API to calculate missing metrics for imported words
                                const res = await fetch("/api/update-words", {
                                  method: "POST",
                                  headers: { "Content-Type": "application/json" },
                                  body: JSON.stringify({ words: importedWords })
                                });
                                const gradedWords = await res.json();

                                const existingList = newVocab[storyId] || [];
                                const mergedList = [...existingList];

                                for (const w of gradedWords) {
                                  const index = mergedList.findIndex(existing => existing.word === w.word);
                                  if (index >= 0) {
                                    mergedList[index] = { ...mergedList[index], ...w };
                                  } else {
                                    mergedList.push(w);
                                  }
                                }
                                newVocab[storyId] = mergedList;
                              }
                            }
                            localStorage.setItem('contentVocab', JSON.stringify(newVocab));
                          }
                          
                          if (parsed.vocab && Array.isArray(parsed.vocab) && parsed.content && parsed.content.id) {
                            // This is a specific story export format
                            const res = await fetch("/api/update-words", {
                               method: "POST",
                               headers: { "Content-Type": "application/json" },
                               body: JSON.stringify({ words: parsed.vocab })
                            });
                            const gradedWords = await res.json();
                            
                            const newVocab = { ...contentVocab };
                            const storyId = parsed.content.id;
                            const existingList = newVocab[storyId] || [];
                            const mergedList = [...existingList];

                            for (const w of gradedWords) {
                               const index = mergedList.findIndex(existing => existing.word === w.word);
                               if (index >= 0) {
                                 mergedList[index] = { ...mergedList[index], ...w };
                               } else {
                                 mergedList.push(w);
                               }
                            }
                            newVocab[storyId] = mergedList;
                            localStorage.setItem('contentVocab', JSON.stringify(newVocab));

                            // Also save the custom content if it's not a pre-installed one
                            if (!INITIAL_CONTENT.find(c => c.id === storyId)) {
                               const savedCustom = localStorage.getItem('customContent');
                               let customArr = savedCustom ? JSON.parse(savedCustom) : [];
                               const existIdx = customArr.findIndex((c: any) => c.id === storyId);
                               if (existIdx >= 0) customArr[existIdx] = parsed.content;
                               else customArr.unshift(parsed.content);
                               localStorage.setItem('customContent', JSON.stringify(customArr));
                            }
                          }

                          alert('Data imported successfully! Reloading...');
                          window.location.reload();
                        } catch (err) {
                          alert('Failed to parse JSON backup file or calculate scores.');
                          console.error(err);
                        }
                      };
                      reader.readAsText(file);
                    }}
                  />
                </label>
              
                <div className="flex items-center gap-2">
                  {isConfirmingReset ? (
                    <div className="flex items-center gap-3">
                      <span className="text-xs text-gray-500 font-medium">Are you sure?</span>
                      <button 
                        onClick={() => {
                          clearKnownWords();
                          setIsConfirmingReset(false);
                        }}
                        className="text-xs text-red-600 font-bold hover:text-red-700 uppercase tracking-widest bg-red-50 px-2 py-1 rounded"
                      >
                        Yes, reset
                      </button>
                      <button 
                        onClick={() => setIsConfirmingReset(false)}
                        className="text-xs text-gray-500 hover:text-gray-700"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button 
                      onClick={() => setIsConfirmingReset(true)}
                      className="text-xs text-red-500 hover:text-red-700 underline underline-offset-4"
                    >
                      Reset Progress
                    </button>
                  )}
                </div>
              </div>
            </div>

            <div className="bg-white p-8 rounded-3xl border border-gray-100 shadow-sm">
              <h3 className="text-lg font-semibold mb-6 flex items-center gap-2">
                <CheckCircle className="w-5 h-5 text-green-500" /> 
                Known Words ({knownWords.size})
              </h3>
              {knownWords.size === 0 ? (
                <p className="text-gray-500 italic pb-4">You haven't learned any words yet. Start a lesson!</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {Array.from(knownWords).map(w => {
                    // Try to find the WordInfo to show on click
                    const info = (Object.values(contentVocab).flat() as WordInfo[]).find(x => x.word === w);
                    return (
                      <button 
                        key={w} 
                        onClick={() => info && setEditingWord(info)}
                        className={`px-3 py-1.5 bg-green-50 border border-green-100 text-green-800 rounded-lg text-sm font-medium transition-colors ${info ? 'hover:bg-green-100 cursor-pointer' : ''}`}
                      >
                        {w}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="bg-white p-8 rounded-3xl border border-gray-100 shadow-sm">
              <h3 className="text-lg font-semibold mb-6 text-gray-800">
                Words You'll Learn Soon
              </h3>
              <p className="text-sm text-gray-500 mb-6">These are words extracted from upcoming content that you haven't learned yet. Click a word to view details or edit it.</p>
              <div className="flex flex-wrap gap-2">
                {/* Aggregate a sample of unknown words from loaded content */}
                {Array.from(new Set(
                  (Object.values(contentVocab).flat() as WordInfo[])
                    .map(w => w.word)
                    .filter(w => !knownWords.has(w))
                )).slice(0, 100).map(w => {
                  const info = (Object.values(contentVocab).flat() as WordInfo[]).find(x => x.word === w);
                  return (
                    <button 
                      key={`unknown-${w}`} 
                      onClick={() => info && setEditingWord(info)}
                      className="px-3 py-1.5 bg-gray-50 border border-gray-200 text-gray-600 rounded-lg text-sm font-medium flex items-center gap-1 group relative hover:bg-gray-100 transition-colors"
                    >
                      <span className="opacity-0 group-hover:opacity-100 absolute z-10 bottom-full mb-2 left-1/2 -translate-x-1/2 bg-gray-800 text-white text-xs px-2 py-1 rounded pointer-events-none whitespace-nowrap transition-opacity">
                        {info?.meaning || w}
                      </span>
                      {w}
                    </button>
                  );
                })}
                
                {(Object.values(contentVocab).flat() as WordInfo[]).length > 100 && (
                  <span className="px-3 py-1.5 text-gray-400 text-sm font-medium italic">
                    + thousands more
                  </span>
                )}
              </div>
            </div>

            <div className="bg-white p-8 rounded-3xl border border-gray-100 shadow-sm">
              <h3 className="text-lg font-semibold mb-6 text-gray-800">
                Words with Unknown Meanings
              </h3>
              <p className="text-sm text-gray-500 mb-6">These are words the dictionary couldn't find a meaning for. Often these are names, rare expressions, or mis-parsed segments.</p>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {(() => {
                  const allVocab = Object.values(contentVocab).flat() as WordInfo[];
                  const uniqueUnknownMeaningWordsMap = new Map<string, WordInfo>();
                  for (const w of allVocab) {
                    if (w.meaning === 'Unknown meaning' && !uniqueUnknownMeaningWordsMap.has(w.word)) {
                      uniqueUnknownMeaningWordsMap.set(w.word, w);
                    }
                  }
                  const unknownMeaningWords = Array.from(uniqueUnknownMeaningWordsMap.values());
                  
                  if (unknownMeaningWords.length === 0) {
                    return <p className="text-gray-400 italic">No unknown meanings found.</p>;
                  }
                  
                  return unknownMeaningWords.map((w, i) => (
                    <div 
                      key={i} 
                      onClick={() => setEditingWord(w)}
                      className="border border-red-100 bg-red-50/30 rounded-xl p-4 flex flex-col gap-2 hover:border-red-300 transition-colors cursor-pointer group relative"
                    >
                      <div className="absolute top-4 right-4 text-red-300 group-hover:text-red-500 transition-colors">
                        <span className="text-xs font-semibold uppercase tracking-widest">Edit</span>
                      </div>
                      <div>
                        <div className="text-xs text-gray-500">{w.reading}</div>
                        <div className="font-bold text-lg text-gray-900">{w.word}</div>
                        <div className="text-sm font-medium text-red-500 mt-1">{w.meaning}</div>
                      </div>
                      <div className="bg-white border border-gray-200 p-3 rounded-lg text-xs space-y-1 mt-2">
                         <div className="flex justify-between font-semibold border-b border-gray-100 pb-1 mb-1">
                           <span>Total Score</span>
                           <span className="text-red-600">{w.score}</span>
                         </div>
                         <div className="flex justify-between text-gray-500">
                           <span>JLPT {w.jlpt === 0 ? 'Native/N1+' : `~N${w.jlpt || '?'}`}</span>
                           <span>{w.breakdown?.jlptScore || '?'} pts</span>
                         </div>
                      </div>
                    </div>
                  ));
                })()}
              </div>
            </div>
          </section>
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
