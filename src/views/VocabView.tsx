import { CheckCircle, Library } from 'lucide-react';
import React from 'react';
import { WordInfo } from '../types';

function VocabView({
  setDisplayCount,
  setIsConfirmingReset,
  setEditingWord,
  clearContentVocab,
  clearKnownWords,
  navigateToWord,

  knownWords,
  contentVocab,
  diskContent,
  isConfirmingReset,
}: VocabViewProps) {
  return (
    <section className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-8 gap-4">
        <h2 className="text-2xl font-semibold tracking-tight">
          <Library className="w-6 h-6 inline-block mr-2 text-indigo-600" /> Your
          Vocabulary
        </h2>
        <div className="flex flex-col sm:flex-row items-end sm:items-center gap-4">
          <button
            onClick={() => {
              clearContentVocab();
              setDisplayCount(12);
            }}
            className="text-xs text-indigo-600 hover:text-indigo-800 bg-indigo-50 hover:bg-indigo-100 px-3 py-1.5 rounded-lg transition-colors font-medium border border-indigo-200"
          >
            Clear Vocab Cache
          </button>

          <button
            onClick={() => {
              const data = {
                knownWords: Array.from(knownWords),
                contentVocab,
              };
              const blob = new Blob([JSON.stringify(data, null, 2)], {
                type: 'application/json',
              });
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
                      const newKnown = new Set([
                        ...Array.from(knownWords),
                        ...parsed.knownWords,
                      ]);
                      localStorage.setItem(
                        'knownWords',
                        JSON.stringify(Array.from(newKnown)),
                      );
                    }

                    if (
                      parsed.contentVocab &&
                      typeof parsed.contentVocab === 'object'
                    ) {
                      const newVocab = { ...contentVocab };
                      for (const [storyId, importedWords] of Object.entries(
                        parsed.contentVocab,
                      )) {
                        if (Array.isArray(importedWords)) {
                          // Hit API to calculate missing metrics for imported words
                          const res = await fetch('/api/update-words', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ words: importedWords }),
                          });
                          const gradedWords = await res.json();

                          const existingList = newVocab[storyId] || [];
                          const mergedList = [...existingList];

                          for (const w of gradedWords) {
                            const index = mergedList.findIndex(
                              (existing) => existing.word === w.word,
                            );
                            if (index >= 0) {
                              mergedList[index] = {
                                ...mergedList[index],
                                ...w,
                              };
                            } else {
                              mergedList.push(w);
                            }
                          }
                          newVocab[storyId] = mergedList;
                        }
                      }
                      localStorage.setItem(
                        'contentVocab',
                        JSON.stringify(newVocab),
                      );
                    }

                    if (
                      parsed.vocab &&
                      Array.isArray(parsed.vocab) &&
                      parsed.content &&
                      parsed.content.id
                    ) {
                      // This is a specific story export format
                      const res = await fetch('/api/update-words', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ words: parsed.vocab }),
                      });
                      const gradedWords = await res.json();

                      const newVocab = { ...contentVocab };
                      const storyId = parsed.content.id;
                      const existingList = newVocab[storyId] || [];
                      const mergedList = [...existingList];

                      for (const w of gradedWords) {
                        const index = mergedList.findIndex(
                          (existing) => existing.word === w.word,
                        );
                        if (index >= 0) {
                          mergedList[index] = { ...mergedList[index], ...w };
                        } else {
                          mergedList.push(w);
                        }
                      }
                      newVocab[storyId] = mergedList;
                      localStorage.setItem(
                        'contentVocab',
                        JSON.stringify(newVocab),
                      );

                      // Also save the custom content if it's not a pre-installed one
                      if (!diskContent.find((c) => c.id === storyId)) {
                        const savedCustom =
                          localStorage.getItem('customContent');
                        let customArr = savedCustom
                          ? JSON.parse(savedCustom)
                          : [];
                        const existIdx = customArr.findIndex(
                          (c: any) => c.id === storyId,
                        );
                        if (existIdx >= 0) customArr[existIdx] = parsed.content;
                        else customArr.unshift(parsed.content);
                        localStorage.setItem(
                          'customContent',
                          JSON.stringify(customArr),
                        );
                      }
                    }

                    alert('Data imported successfully! Reloading...');
                    window.location.reload();
                  } catch (err) {
                    alert(
                      'Failed to parse JSON backup file or calculate scores.',
                    );
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
                <span className="text-xs text-gray-500 font-medium">
                  Are you sure?
                </span>
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
          <p className="text-gray-500 italic pb-4">
            You haven't learned any words yet. Start a lesson!
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {Array.from(knownWords).map((w: string) => {
              // Try to find the WordInfo to show on click
              const info = (
                Object.values(contentVocab).flat() as WordInfo[]
              ).find((x) => x.word === w);
              return (
                <div key={w} className="flex items-center gap-1">
                  <button
                    onClick={() => navigateToWord(w)}
                    className={`px-3 py-1.5 bg-green-50 border border-green-100 text-green-800 rounded-lg text-sm font-medium transition-colors hover:bg-green-100 cursor-pointer`}
                  >
                    {w}
                  </button>
                  {info && (
                    <button
                      onClick={() => setEditingWord(info)}
                      className="px-2 py-1.5 text-gray-400 hover:text-gray-600 transition-colors text-xs font-medium"
                      title="Edit"
                    >
                      ✏️
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="bg-white p-8 rounded-3xl border border-gray-100 shadow-sm">
        <h3 className="text-lg font-semibold mb-6 text-gray-800">
          Words You'll Learn Soon
        </h3>
        <p className="text-sm text-gray-500 mb-6">
          These are words extracted from upcoming content that you haven't
          learned yet. Click a word to view details or edit it.
        </p>
        <div className="flex flex-wrap gap-2">
          {/* Aggregate a sample of unknown words from loaded content */}
          {Array.from(
            new Set(
              (Object.values(contentVocab).flat() as WordInfo[])
                .map((w) => w.word)
                .filter((w) => !knownWords.has(w)),
            ),
          )
            .slice(0, 100)
            .map((w: string) => {
              const info = (
                Object.values(contentVocab).flat() as WordInfo[]
              ).find((x) => x.word === w);
              return (
                <div key={`unknown-${w}`} className="flex items-center gap-1">
                  <button
                    onClick={() => navigateToWord(w)}
                    className="px-3 py-1.5 bg-gray-50 border border-gray-200 text-gray-600 rounded-lg text-sm font-medium group relative hover:bg-gray-100 transition-colors"
                  >
                    <span className="opacity-0 group-hover:opacity-100 absolute z-10 bottom-full mb-2 left-1/2 -translate-x-1/2 bg-gray-800 text-white text-xs px-2 py-1 rounded pointer-events-none whitespace-nowrap transition-opacity">
                      {info?.meaning || w}
                    </span>
                    {w}
                  </button>
                  {info && (
                    <button
                      onClick={() => setEditingWord(info)}
                      className="px-1.5 py-1.5 text-gray-300 hover:text-gray-600 transition-colors text-xs font-medium"
                      title="Edit"
                    >
                      ✏️
                    </button>
                  )}
                </div>
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
        <p className="text-sm text-gray-500 mb-6">
          These are words the dictionary couldn't find a meaning for. Often
          these are names, rare expressions, or mis-parsed segments.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {(() => {
            const allVocab = Object.values(contentVocab).flat() as WordInfo[];
            const uniqueUnknownMeaningWordsMap = new Map<string, WordInfo>();
            for (const w of allVocab) {
              if (
                w.meaning === 'Unknown meaning' &&
                !uniqueUnknownMeaningWordsMap.has(w.word)
              ) {
                uniqueUnknownMeaningWordsMap.set(w.word, w);
              }
            }
            const unknownMeaningWords = Array.from(
              uniqueUnknownMeaningWordsMap.values(),
            );

            if (unknownMeaningWords.length === 0) {
              return (
                <p className="text-gray-400 italic">
                  No unknown meanings found.
                </p>
              );
            }

            return unknownMeaningWords.map((w, i) => (
              <button
                key={i}
                onClick={() => navigateToWord(w.word)}
                className="border border-red-100 bg-red-50/30 hover:bg-red-50/60 hover:border-red-200 rounded-xl p-4 flex flex-col gap-2 transition-colors cursor-pointer group relative text-left w-full"
              >
                <div className="absolute top-4 right-4 text-red-300 group-hover:text-red-500 transition-colors">
                  <span className="text-xs font-semibold uppercase tracking-widest">
                    View
                  </span>
                </div>
                <div>
                  <div className="text-xs text-gray-500">{w.reading}</div>
                  <div className="font-bold text-lg text-gray-900">
                    {w.word}
                  </div>
                  <div className="text-sm font-medium text-red-500 mt-1">
                    {w.meaning}
                  </div>
                </div>
                <div className="bg-white border border-gray-200 p-3 rounded-lg text-xs space-y-1 mt-2">
                  <div className="flex justify-between font-semibold border-b border-gray-100 pb-1 mb-1">
                    <span>Total Score</span>
                    <span className="text-red-600">{w.score}</span>
                  </div>
                  <div className="flex justify-between text-gray-500">
                    <span>
                      JLPT {w.jlpt === 0 ? 'Native/N1+' : `~N${w.jlpt || '?'}`}
                    </span>
                    <span>{w.breakdown?.jlptScore || '?'} pts</span>
                  </div>
                </div>
              </button>
            ));
          })()}
        </div>
      </div>
    </section>
  );
}

type VocabViewProps = {
  setDisplayCount: React.Dispatch<React.SetStateAction<number>>;
  setIsConfirmingReset: React.Dispatch<React.SetStateAction<boolean>>;
  setEditingWord: React.Dispatch<React.SetStateAction<WordInfo | null>>;
  clearContentVocab: () => void;
  clearKnownWords: () => void;
  navigateToWord: (word: string) => void;

  knownWords: Set<string>;
  contentVocab: Record<string, WordInfo[]>;
  diskContent: { id: string; title: string }[];
  isConfirmingReset: boolean;
};

export default VocabView;
