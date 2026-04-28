import { useState } from 'react';
import { ArrowLeft, PlayCircle, GraduationCap, Loader2, BookOpen, Download } from 'lucide-react';
import { Content } from '../data/content';
import { WordInfo } from '../types';
import { LessonProcess } from './LessonProcess';
import { ContentReader } from './ContentReader';
import { AnkiExportModal } from './AnkiExportModal';

interface Status {
  difficulty: number;
  totalUnknownScore: number;
  unknownCount: number;
  totalCount: number;
  score: number;
  unknownWords: WordInfo[];
  knownWords: WordInfo[];
}

export function ContentDetail({
  content,
  onBack,
  status,
  loading,
  markWordsAsKnown,
  onForceReload,
  onUpdateContent,
  onAddWord,
  knownWordSet,
}: {
  content: Content;
  onBack: () => void;
  status: Status;
  loading: boolean;
  markWordsAsKnown: (words: string[]) => void;
  onForceReload?: () => void;
  onUpdateContent?: (updatedContent: Content) => void;
  onAddWord?: (addedWordStr: string) => void;
  knownWordSet?: Set<string>;
}) {
  const [view, setView] = useState<'intro' | 'lesson' | 'consume'>('intro');
  const [isEditing, setIsEditing] = useState(false);
  const [editTitle, setEditTitle] = useState(content.title);
  const [editText, setEditText] = useState(content.text);
  const [showAllWords, setShowAllWords] = useState(false);
  const [showAnkiModal, setShowAnkiModal] = useState(false);

  if (view === 'lesson') {
    return (
      <LessonProcess 
        words={status.unknownWords} 
        onComplete={(learnedWords) => {
          if (learnedWords.length > 0) {
            markWordsAsKnown(learnedWords);
          }
          setView('consume');
        }}
        onCancel={() => setView('intro')}
      />
    );
  }

  if (view === 'consume') {
    return (
      <ContentReader 
        content={content} 
        vocab={[...status.unknownWords, ...status.knownWords]}
        onBack={() => setView('intro')} 
      />
    );
  }

  return (
    <div className="min-h-screen bg-white">
      <div className="relative h-[40vh] bg-gray-900 w-full">
        {content.imageUrl && (
          <img src={content.imageUrl} alt="" className="absolute inset-0 w-full h-full object-cover opacity-60" />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-gray-900 via-gray-900/40 to-transparent" />
        
        <button 
          onClick={onBack}
          className="absolute top-6 left-6 text-white flex items-center gap-2 hover:bg-white/10 px-3 py-1.5 rounded-full transition-colors backdrop-blur-sm"
        >
          <ArrowLeft className="w-5 h-5" />
          <span className="font-medium">Back to library</span>
        </button>

        <div className="absolute bottom-0 left-0 w-full p-8 max-w-5xl mx-auto">
          <div className="inline-block bg-white/20 backdrop-blur-md px-3 py-1 rounded-full text-white text-xs font-semibold uppercase tracking-wider mb-4 border border-white/20">
            {content.type}
          </div>
          {isEditing ? (
            <input 
              type="text" 
              value={editTitle} 
              onChange={e => setEditTitle(e.target.value)}
              className="text-4xl md:text-5xl font-bold text-white mb-4 tracking-tight bg-transparent border-b border-white/50 focus:outline-none w-full"
            />
          ) : (
            <h1 className="text-4xl md:text-5xl font-bold text-white mb-4 tracking-tight">{content.title}</h1>
          )}
          <p className="text-gray-300 max-w-2xl text-lg">{content.description}</p>
          {onUpdateContent && (
             <button 
               onClick={() => {
                 if (isEditing) {
                   onUpdateContent({ ...content, title: editTitle, text: editText });
                   setIsEditing(false);
                 } else {
                   setIsEditing(true);
                 }
               }}
               className="mt-4 text-xs font-bold uppercase tracking-widest bg-white/10 hover:bg-white/20 px-4 py-2 rounded-lg text-white transition-colors"
             >
               {isEditing ? 'Save Changes' : 'Edit Content'}
             </button>
          )}
        </div>
      </div>

      <div className="max-w-5xl mx-auto p-8 grid grid-cols-1 md:grid-cols-3 gap-12">
        <div className="md:col-span-2 space-y-8">
          {isEditing && (
            <div className="space-y-4">
              <h2 className="text-2xl font-semibold">Edit Story Text</h2>
              <textarea
                value={editText}
                onChange={(e) => setEditText(e.target.value)}
                className="w-full h-64 p-4 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-indigo-500 font-serif leading-loose"
              />
            </div>
          )}

          <div>
            <div className="flex flex-wrap items-center justify-between mb-4 gap-2">
              <h2 className="text-2xl font-semibold">Vocabulary Overview</h2>
              <div className="flex gap-2">
                <button 
                  onClick={() => {
                    const newWordStr = prompt("Enter the new word:");
                    if (!newWordStr) return;
                    if (onAddWord) onAddWord(newWordStr);
                  }}
                   className="text-xs font-medium text-blue-600 hover:text-blue-800 bg-blue-50 hover:bg-blue-100 px-3 py-1.5 rounded-lg transition-colors"
                >
                  Add Custom Word
                </button>
                <button
                  onClick={() => {
                    const data = {
                      content,
                      vocab: status.unknownWords.concat(status.knownWords)
                    };
                    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `kotonoha-story-${content.id}.json`;
                    a.click();
                    URL.revokeObjectURL(url);
                  }}
                  className="text-xs font-medium text-green-600 hover:text-green-800 bg-green-50 hover:bg-green-100 px-3 py-1.5 rounded-lg transition-colors"
                >
                  Export Story JSON
                </button>
                <button
                  onClick={() => setShowAnkiModal(true)}
                  disabled={loading || status.totalCount === 0}
                  className="text-xs font-medium text-purple-600 hover:text-purple-800 bg-purple-50 hover:bg-purple-100 px-3 py-1.5 rounded-lg transition-colors flex items-center gap-1 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Download className="w-3.5 h-3.5" /> Export to Anki
                </button>
                {onForceReload && (
                  <button 
                    onClick={onForceReload}
                    className="text-xs font-medium text-indigo-600 hover:text-indigo-800 bg-indigo-50 hover:bg-indigo-100 px-3 py-1.5 rounded-lg transition-colors"
                  >
                    Force Refresh Vocab
                  </button>
                )}
              </div>
            </div>
            {loading ? (
              <div className="flex items-center gap-3 text-gray-500 py-8 bg-gray-50 rounded-2xl justify-center">
                <Loader2 className="w-5 h-5 animate-spin" />
                <span>Analyzing text with AI...</span>
              </div>
            ) : status.unknownCount === 0 ? (
              <div className="bg-green-50 border border-green-100 rounded-2xl p-6 flex items-start gap-4 text-green-800">
                <div className="bg-green-200 p-2 rounded-full">
                  <CheckCircle className="w-6 h-6 text-green-700" />
                </div>
                <div>
                  <h3 className="font-semibold text-lg mb-1">You're ready!</h3>
                  <p className="text-green-700/80">You already know all {status.totalCount} extracted words in this content.</p>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <p className="text-gray-600">
                  There are <strong className="text-indigo-600">{status.unknownCount}</strong> words you haven't learned yet. We recommend doing a quick lesson before jumping in.
                </p>
                <div className="grid grid-cols-1 gap-4">
                  {(showAllWords ? status.unknownWords : status.unknownWords.slice(0, 10)).map((w, i) => (
                    <div key={i} className="border border-gray-100 bg-gray-50 rounded-xl p-4 flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4">
                      <div>
                        <div className="text-xs text-gray-500">{w.reading}</div>
                        <div className="font-bold text-lg">{w.word}</div>
                        <div className="text-sm font-medium text-gray-700 mt-1">{w.meaning}</div>
                      </div>
                      <div className="bg-white border border-gray-200 p-3 rounded-lg text-xs space-y-1 min-w-[200px]">
                        <div className="flex justify-between font-semibold border-b border-gray-100 pb-1 mb-1">
                          <span>Total Score</span>
                          <span className="text-indigo-600">{w.score}</span>
                        </div>
                        <div className="flex justify-between text-gray-500">
                          <span>JLPT {w.jlpt === 0 ? 'Native/N1+' : `~N${w.jlpt || '?'}`}</span>
                          <span>{w.breakdown?.jlptScore || '?'} pts</span>
                        </div>
                        {w.breakdown?.highestGrade !== null && w.breakdown?.highestGrade !== undefined && (
                          <div className="flex justify-between text-gray-500">
                            <span>
                              {w.breakdown.highestGrade <= 6 ? `Grade ${w.breakdown.highestGrade} Joyo` : (w.breakdown.highestGrade === 8 ? 'Middle School Joyo' : 'Non-Joyo')}
                            </span>
                            <span>+{w.breakdown.joyoPenalty} pts</span>
                          </div>
                        )}
                        <div className="flex justify-between text-gray-500">
                          <span>Freq. Penalty {w.breakdown?.priorities?.length ? `(${w.breakdown.priorities[0]})` : ''}</span>
                          <span>{w.breakdown?.freqPenalty > 0 ? '+' : ''}{w.breakdown?.freqPenalty || 0} pts</span>
                        </div>
                      </div>
                    </div>
                  ))}
                  {status.unknownWords.length > 10 && !showAllWords && (
                    <button 
                      onClick={() => setShowAllWords(true)}
                      className="border border-dashed border-gray-300 hover:border-gray-400 hover:bg-gray-50 bg-gray-50/50 rounded-xl p-4 flex items-center justify-center text-gray-600 font-medium transition-colors cursor-pointer"
                    >
                      + {status.unknownWords.length - 10} more words
                    </button>
                  )}
                </div>
              </div>
            )}

            {!loading && status.knownWords && status.knownWords.length > 0 && (
              <div className="pt-8 mt-8 border-t border-gray-100">
                <h3 className="font-semibold text-xl mb-4 flex items-center justify-between">
                  <span className="flex items-center gap-2">
                    <span className="bg-green-100 text-green-700 p-1.5 rounded-lg">
                      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                    </span>
                    Words You Know
                  </span>
                  <span className="text-sm font-normal text-gray-500">
                    Difficulty Impact: <strong className="text-gray-900">+{status.knownWords.reduce((acc, w) => acc + w.score, 0) * 0.5} pts</strong>
                  </span>
                </h3>
                <div className="grid grid-cols-1 gap-4">
                  {(showAllWords ? status.knownWords : status.knownWords.slice(0, 10)).map((w, i) => (
                    <div key={i} className="border border-green-100 bg-white/50 rounded-xl p-3 flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4">
                      <div>
                        <div className="flex items-baseline gap-2">
                          <span className="font-bold text-lg text-gray-900">{w.word}</span>
                          <span className="text-sm text-gray-500">{w.reading}</span>
                        </div>
                        <div className="text-sm font-medium text-gray-600 mt-0.5">{w.meaning}</div>
                      </div>
                      <div className="flex items-center gap-4 bg-gray-50 px-3 py-1.5 rounded-lg border border-gray-100 text-xs text-gray-500 min-w-fit">
                        <div>
                          <span className="block text-[10px] uppercase opacity-70">JLPT</span>
                          <span className="font-medium">{w.jlpt === 0 ? 'Native/N1+' : `~N${w.jlpt || '?'}`}</span>
                        </div>
                        <div className="h-6 w-px bg-gray-200"></div>
                        <div>
                          <span className="block text-[10px] uppercase opacity-70">Total Score</span>
                          <span className="font-medium text-green-700">{w.score}</span>
                        </div>
                      </div>
                    </div>
                  ))}
                  {status.knownWords.length > 10 && !showAllWords && (
                    <button 
                      onClick={() => setShowAllWords(true)}
                      className="border border-dashed border-gray-300 hover:border-gray-400 hover:bg-gray-50 bg-gray-50/50 rounded-xl p-4 flex items-center justify-center text-gray-600 font-medium transition-colors cursor-pointer"
                    >
                      + {status.knownWords.length - 10} more known words
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="space-y-6">
          <div className="bg-[#F9F8F6] p-6 rounded-3xl border border-[#EBE8E0]">
            <h3 className="font-semibold text-lg mb-6">Action Plan</h3>
            
            <div className="space-y-4">
              <button 
                onClick={() => setView('lesson')}
                disabled={loading || status.unknownCount === 0}
                className="w-full flex items-center justify-center gap-2 bg-indigo-600 text-white py-3.5 rounded-xl font-medium hover:bg-indigo-700 transition disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <GraduationCap className="w-5 h-5" />
                Start Prep Lesson
              </button>

              <div className="flex items-center gap-4 py-2">
                <div className="h-[1px] flex-grow bg-gray-200"></div>
                <span className="text-xs font-semibold text-gray-400 uppercase tracking-widest">or</span>
                <div className="h-[1px] flex-grow bg-gray-200"></div>
              </div>

              <button 
                onClick={() => setView('consume')}
                className="w-full flex items-center justify-center gap-2 bg-white text-gray-800 border border-gray-200 shadow-sm py-3.5 rounded-xl font-medium hover:bg-gray-50 transition"
              >
                <PlayCircle className="w-5 h-5 text-gray-500" />
                Dive Right In
              </button>
            </div>
          </div>

          <div className="bg-[#F9F8F6] p-6 rounded-3xl border border-[#EBE8E0]">
             <h3 className="font-semibold text-sm uppercase tracking-wider text-gray-500 mb-4">Content Stats</h3>
             <ul className="space-y-3">
               <li className="flex justify-between items-center text-sm">
                 <span className="text-gray-500">Total Unique Words</span>
                 <span className="font-medium">{loading ? '-' : status.totalCount}</span>
               </li>
               <li className="flex justify-between items-center text-sm">
                 <span className="text-gray-500">Unknown Words</span>
                 <span className="font-medium text-amber-600">{loading ? '-' : status.unknownCount}</span>
               </li>
               <li className="flex justify-between items-center text-sm pt-2 border-t border-[#EBE8E0]">
                 <span className="text-gray-500 font-semibold">Total Score</span>
                 <span className="font-bold text-indigo-600">{loading ? '-' : status.score}</span>
               </li>
             </ul>
          </div>
        </div>
      </div>

      {showAnkiModal && (
        <AnkiExportModal
          contentTitle={content.title}
          words={[...status.unknownWords, ...status.knownWords]}
          knownWordSet={knownWordSet ?? new Set()}
          onClose={() => setShowAnkiModal(false)}
        />
      )}
    </div>
  );
}

// Ensure CheckCircle is imported properly
import { CheckCircle } from 'lucide-react';
