import React, { useState, useEffect } from 'react';
import { WordInfo } from '../types';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { WK_STAGE_NAMES, getWaniKaniSrsStage, loadCachedWaniKaniData } from '../lib/wanikani';

interface WordDetailData extends WordInfo {
  entry?: any;
}

export function WordDetailPage({
  word,
  onBack,
  allWords = []
}: {
  word: string;
  onBack: () => void;
  allWords?: WordInfo[];
}) {
  const [wordData, setWordData] = useState<WordDetailData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [wkSrsStage, setWkSrsStage] = useState<number | null>(null);
  const [relatedWords, setRelatedWords] = useState<WordInfo[]>([]);

  const handleBack = () => {
    const scrollPos = window.history.state?.scrollPos;
    onBack();
    if (scrollPos !== undefined) {
      setTimeout(() => window.scrollTo(0, scrollPos), 0);
    }
  };

  useEffect(() => {
    const fetchWordData = async () => {
      try {
        setLoading(true);
        setError(null);
        const response = await fetch(`/api/word/${encodeURIComponent(word)}`);
        if (!response.ok) {
          throw new Error('Failed to fetch word details');
        }
        const data = await response.json();
        setWordData(data);

        // Load WaniKani data from localStorage
        const wkCache = loadCachedWaniKaniData();
        if (wkCache) {
          const stage = getWaniKaniSrsStage(word, wkCache.data);
          setWkSrsStage(stage);
        }

        // Find related words by kanji
        const wordKanjis = new Set<string>();
        const wordRegex = /[一-龯]/g;
        const matches = word.match(wordRegex);
        if (matches) {
          matches.forEach(k => wordKanjis.add(k));
        }

        const relatedList: WordInfo[] = [];
        if (wordKanjis.size > 0) {
          const seen = new Set<string>([word]);
          for (const w of allWords) {
            if (seen.has(w.word)) continue;
            const wMatches = w.word.match(wordRegex);
            if (wMatches) {
              for (const k of wMatches) {
                if (wordKanjis.has(k)) {
                  relatedList.push(w);
                  seen.add(w.word);
                  break;
                }
              }
            }
          }
        }
        setRelatedWords(relatedList.slice(0, 10));
      } catch (e) {
        setError((e as any).message || 'Failed to load word details');
      } finally {
        setLoading(false);
      }
    };

    fetchWordData();
  }, [word, allWords]);

  if (loading) {
    return (
      <div className="min-h-screen bg-[#F5F2ED] text-gray-900 font-sans flex flex-col">
        <header className="bg-white/80 backdrop-blur-md sticky top-0 z-10 px-6 py-4 border-b border-gray-200">
          <div className="max-w-3xl mx-auto flex items-center">
            <button
              onClick={handleBack}
              className="flex items-center gap-2 text-gray-600 hover:text-black transition"
            >
              <ArrowLeft className="w-5 h-5" />
              <span className="font-medium text-sm">Back</span>
            </button>
          </div>
        </header>
        <main className="flex-grow flex items-center justify-center">
          <Loader2 className="w-8 h-8 text-indigo-600 animate-spin" />
        </main>
      </div>
    );
  }

  if (error || !wordData) {
    return (
      <div className="min-h-screen bg-[#F5F2ED] text-gray-900 font-sans flex flex-col">
        <header className="bg-white/80 backdrop-blur-md sticky top-0 z-10 px-6 py-4 border-b border-gray-200">
          <div className="max-w-3xl mx-auto flex items-center">
            <button
              onClick={handleBack}
              className="flex items-center gap-2 text-gray-600 hover:text-black transition"
            >
              <ArrowLeft className="w-5 h-5" />
              <span className="font-medium text-sm">Back</span>
            </button>
          </div>
        </header>
        <main className="flex-grow flex items-center justify-center">
          <div className="text-center">
            <p className="text-gray-600 text-lg">{error || 'Failed to load word details'}</p>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F5F2ED] text-gray-900 font-sans flex flex-col">
      <header className="bg-white/80 backdrop-blur-md sticky top-0 z-10 px-6 py-4 border-b border-gray-200">
        <div className="max-w-3xl mx-auto flex items-center">
          <button
            onClick={onBack}
            className="flex items-center gap-2 text-gray-600 hover:text-black transition"
          >
            <ArrowLeft className="w-5 h-5" />
            <span className="font-medium text-sm">Back</span>
          </button>
        </div>
      </header>

      <main className="flex-grow max-w-3xl mx-auto w-full p-6 pb-24">
        <div className="bg-white p-8 md:p-12 rounded-3xl shadow-sm border border-gray-100 space-y-8">
          {/* Word Header */}
          <div className="space-y-4">
            <div className="space-y-2">
              <h1 className="text-5xl md:text-6xl font-bold font-serif">{wordData.word}</h1>
              <p className="text-xl text-gray-600">{wordData.reading}</p>
            </div>
            <div className="w-16 h-1 bg-indigo-600 rounded-full" />
          </div>

          {/* Primary Meaning */}
          <div className="space-y-3 border-t border-gray-100 pt-6">
            <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-widest">Primary Meaning</h2>
            <p className="text-lg text-gray-800">{wordData.meaning}</p>
          </div>

          {/* All Definitions */}
          {wordData.meanings && wordData.meanings.length > 1 && (
            <div className="space-y-3 border-t border-gray-100 pt-6">
              <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-widest">All Definitions</h2>
              <ul className="space-y-2">
                {wordData.meanings.map((def, idx) => (
                  <li key={idx} className="flex gap-3">
                    <span className="font-semibold text-gray-400 text-sm min-w-6">{idx + 1}.</span>
                    <span className="text-gray-700">{def}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Frequency Data */}
          <div className="space-y-3 border-t border-gray-100 pt-6">
            <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-widest">Frequency Data</h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="bg-gray-50 p-4 rounded-lg">
                <p className="text-xs text-gray-500 font-medium mb-1">Difficulty Score</p>
                <p className="text-2xl font-bold text-indigo-600">{wordData.score}</p>
              </div>

              {wordData.jlpt > 0 && (
                <div className="bg-gray-50 p-4 rounded-lg">
                  <p className="text-xs text-gray-500 font-medium mb-1">JLPT Level</p>
                  <p className="text-2xl font-bold text-blue-600">N{wordData.jlpt}</p>
                </div>
              )}

              {wordData.joyo && (
                <div className="bg-gray-50 p-4 rounded-lg">
                  <p className="text-xs text-gray-500 font-medium mb-1">Joyo Kanji</p>
                  <p className="text-lg font-bold text-green-600">Yes</p>
                </div>
              )}

              <div className="bg-gray-50 p-4 rounded-lg">
                <p className="text-xs text-gray-500 font-medium mb-1">WaniKani</p>
                {wkSrsStage !== null ? (
                  <>
                    <p className="text-sm font-bold text-purple-600">
                      Stage {wkSrsStage}
                    </p>
                    <p className="text-xs text-gray-500 mt-1">
                      {WK_STAGE_NAMES[wkSrsStage.toString()] || 'Unknown'}
                    </p>
                  </>
                ) : (
                  <p className="text-sm font-medium text-gray-400">N/A</p>
                )}
              </div>
            </div>
          </div>

          {/* Score Breakdown */}
          {wordData.breakdown && (
            <div className="space-y-3 border-t border-gray-100 pt-6">
              <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-widest">Score Breakdown</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                <div className="bg-gray-50 p-4 rounded-lg">
                  <p className="text-gray-600">JLPT Base Score</p>
                  <p className="text-xl font-bold text-gray-900">{wordData.breakdown.jlptScore}</p>
                </div>
                <div className="bg-gray-50 p-4 rounded-lg">
                  <p className="text-gray-600">Joyo Penalty</p>
                  <p className="text-xl font-bold text-gray-900">{wordData.breakdown.joyoPenalty}</p>
                </div>
                <div className="bg-gray-50 p-4 rounded-lg">
                  <p className="text-gray-600">Frequency Penalty</p>
                  <p className="text-xl font-bold text-gray-900">{wordData.breakdown.freqPenalty}</p>
                </div>
                {wordData.breakdown.highestGrade !== undefined && wordData.breakdown.highestGrade !== null && (
                  <div className="bg-gray-50 p-4 rounded-lg">
                    <p className="text-gray-600">Highest Grade</p>
                    <p className="text-xl font-bold text-gray-900">{wordData.breakdown.highestGrade}</p>
                  </div>
                )}
              </div>

              {wordData.breakdown.priorities && wordData.breakdown.priorities.length > 0 && (
                <div className="bg-gray-50 p-4 rounded-lg">
                  <p className="text-gray-600 text-sm mb-2">JMDict Priorities</p>
                  <div className="flex flex-wrap gap-2">
                    {wordData.breakdown.priorities.map((p, idx) => (
                      <span key={idx} className="bg-indigo-100 text-indigo-700 text-xs font-medium px-3 py-1 rounded-full">
                        {p}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Entry Details */}
          {wordData.entry && (
            <div className="space-y-3 border-t border-gray-100 pt-6">
              <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-widest">Dictionary Entry</h2>
              <div className="bg-gray-50 p-4 rounded-lg space-y-3 text-sm">
                {wordData.entry.meanings && wordData.entry.meanings.length > 0 && (
                  <div>
                    <p className="font-semibold text-gray-600 mb-2">All Senses:</p>
                    {wordData.entry.meanings.map((sense: any, idx: number) => (
                      <div key={idx} className="mb-2 pb-2 border-b border-gray-200 last:border-0">
                        <p className="text-xs text-gray-500 mb-1">
                          {sense.partOfSpeech?.join(', ')}
                        </p>
                        <p className="text-gray-700">
                          {sense.glosses?.join('; ')}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Related Words */}
          {relatedWords.length > 0 && (
            <div className="space-y-3 border-t border-gray-100 pt-6">
              <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-widest">Related Words</h2>
              <p className="text-sm text-gray-600">Words that share kanji with this word:</p>
              <div className="flex flex-wrap gap-2">
                {relatedWords.map((w, idx) => (
                  <button
                    key={idx}
                    onClick={() => window.location.hash = `/word/${encodeURIComponent(w.word)}`}
                    className="px-3 py-2 bg-indigo-50 border border-indigo-200 text-indigo-700 rounded-lg text-sm font-medium hover:bg-indigo-100 transition-colors"
                  >
                    {w.word}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
