import { useState, useMemo } from 'react';
import { WordInfo } from '../types';
import { X, Check } from 'lucide-react';

export function LessonProcess({ 
  words, 
  onComplete, 
  onCancel 
}: { 
  words: WordInfo[]; 
  onComplete: (learned: string[]) => void; 
  onCancel: () => void; 
}) {
  const [queue, setQueue] = useState<WordInfo[]>(() => words.slice(0, 50));
  const [currentIndex, setCurrentIndex] = useState(0);
  const [showAnswer, setShowAnswer] = useState(false);
  const [learnedWords, setLearnedWords] = useState<string[]>([]);
  
  if (queue.length === 0) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
        <div className="text-center max-w-md">
          <h2 className="text-2xl font-bold mb-4">You already know all these words!</h2>
          <button 
            onClick={() => onComplete([])}
            className="w-full bg-indigo-600 text-white py-3 rounded-xl font-medium"
          >
            Continue to Content
          </button>
        </div>
      </div>
    );
  }

  const currentWord = queue[currentIndex];
  // Calculate progress on the original size, or the current index relative to the total queue (including repeats)
  const isLast = currentIndex === queue.length - 1;

  const handleNext = (learned: boolean) => {
    let nextQueue = [...queue];
    const updatedLearned = learned ? [...learnedWords, currentWord.word] : learnedWords;
    
    if (learned) {
      setLearnedWords(updatedLearned);
    } else {
      // Put it at the end of the line
      nextQueue.push(currentWord);
      setQueue(nextQueue);
    }
    
    if (currentIndex + 1 >= nextQueue.length) {
      onComplete(updatedLearned);
    } else {
      setCurrentIndex(prev => prev + 1);
      setShowAnswer(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-900 text-white flex flex-col">
      <div className="p-6 flex items-center justify-between">
        <button onClick={onCancel} className="text-gray-400 hover:text-white transition">
          <X className="w-6 h-6" />
        </button>
        <div className="flex-grow max-w-xs mx-auto">
          <div className="h-2 bg-gray-800 rounded-full overflow-hidden">
            <div 
              className="h-full bg-indigo-500 transition-all duration-300"
              style={{ width: `${((currentIndex) / queue.length) * 100}%` }}
            />
          </div>
          <div className="text-center text-xs text-gray-400 mt-2 font-mono">
            {currentIndex + 1} / {queue.length}
          </div>
        </div>
        <div className="w-6" /> {/* spacer for alignment */}
      </div>

      <div className="flex-grow flex items-center justify-center p-6">
        <div className="w-full max-w-lg perspective-[1000px]">
          <div 
            className={`w-full aspect-[4/3] relative transition-transform duration-500 preserve-3d cursor-pointer ${showAnswer ? 'rotate-y-180' : ''}`}
            onClick={() => setShowAnswer(true)}
          >
            {/* FRONT */}
            <div className={`absolute inset-0 bg-white rounded-3xl shadow-2xl flex flex-col items-center justify-center p-8 text-black backface-hidden ${showAnswer ? 'pointer-events-none' : ''}`}>
              <span className="text-gray-400 text-sm font-medium tracking-widest uppercase mb-4">Click to reveal</span>
              {currentWord.reading !== currentWord.word && (
                <span className="text-xl text-gray-500 mb-2">{currentWord.reading}</span>
              )}
              <span className="text-6xl font-bold">{currentWord.word}</span>
            </div>

            {/* BACK */}
            <div className={`absolute inset-0 bg-indigo-50 rounded-3xl shadow-2xl flex flex-col items-center justify-center p-8 text-center text-black backface-hidden transform rotate-y-180`}>
              <span className="text-indigo-600 font-medium mb-4">Meaning</span>
              <span className="text-4xl font-bold text-gray-900 mb-6">{currentWord.meaning}</span>
              
              <div className="flex gap-4 text-sm text-gray-500 bg-white px-4 py-2 rounded-full shadow-sm">
                {currentWord.jlpt > 0 && <span>JLPT N{currentWord.jlpt}</span>}
                {currentWord.jlpt > 0 && <span>•</span>}
                <span>Difficulty: {currentWord.score}/100</span>
              </div>
            </div>
          </div>

          <div className={`mt-12 transition-all duration-500 ${showAnswer ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4 pointer-events-none'}`}>
            <div className="grid grid-cols-2 gap-4">
              <button 
                onClick={() => handleNext(false)}
                className="bg-gray-800 text-gray-300 py-4 rounded-2xl font-medium hover:bg-gray-700 transition"
              >
                Still Learning
              </button>
              <button 
                onClick={() => handleNext(true)}
                className="bg-indigo-600 text-white flex items-center justify-center gap-2 py-4 rounded-2xl font-medium hover:bg-indigo-500 transition shadow-lg shadow-indigo-600/20"
              >
                <Check className="w-5 h-5" />
                Got it
              </button>
            </div>
            {isLast ? (
              <p className="text-center mt-6 text-gray-400 text-sm">This is the last word for this lesson.</p>
            ) : (
               <p className="text-center mt-6 text-gray-500 text-sm">Both options track your progress</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
