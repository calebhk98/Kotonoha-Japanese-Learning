import { Content } from '../data/content';
import { WordInfo } from '../types';
import { ArrowLeft, Play, Pause } from 'lucide-react';
import { useState, useRef, useEffect, useMemo } from 'react';

function getYouTubeId(url: string) {
  const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=)([^#&?]*).*/;
  const match = url.match(regExp);
  return (match && match[2].length === 11) ? match[2] : null;
}

const segmenter = new Intl.Segmenter('ja-JP', { granularity: 'word' });

export function ContentReader({ content, vocab, onBack }: { content: Content; vocab?: WordInfo[]; onBack: () => void }) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [showFurigana, setShowFurigana] = useState(true);
  const [showHoverDefs, setShowHoverDefs] = useState(true);
  const audioRef = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    if (audioRef.current) {
      if (isPlaying) {
        audioRef.current.play().catch(() => setIsPlaying(false));
      } else {
        audioRef.current.pause();
      }
    }
  }, [isPlaying]);

  // We can format the story text to be split by paragraphs
  const paragraphs = content.text.split('\n').filter(p => p.trim() !== '');

  const vocabMap = useMemo(() => {
    const map = new Map<string, WordInfo>();
    if (vocab) {
      for (const w of vocab) {
        map.set(w.word, w);
      }
    }
    return map;
  }, [vocab]);

  const renderParagraph = (p: string) => {
    if (!showFurigana && !showHoverDefs) return p;
    const segments = Array.from(segmenter.segment(p)).map(s => s.segment);
    return segments.map((seg: string, i: number) => {
      const info = vocabMap.get(seg);
      if (!info) return <span key={i}>{seg}</span>;

      const hasFurigana = showFurigana && info.reading && info.reading !== seg && /[\u4e00-\u9faf]/.test(seg);
      const inner = hasFurigana ? (
        <ruby className="leading-loose">
          {seg}
          <rt className="text-xs text-gray-500 font-medium select-none">{info.reading}</rt>
        </ruby>
      ) : (
        <span>{seg}</span>
      );

      if (showHoverDefs) {
        return (
          <span key={i} className="relative group cursor-pointer inline-block mx-0.5 border-b border-dashed border-gray-300 hover:border-indigo-500 transition-colors">
            {inner}
            <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-max max-w-[200px] sm:max-w-xs bg-gray-900 border border-gray-700 text-white p-3 rounded-xl shadow-xl opacity-0 group-hover:opacity-100 transition-opacity z-50 pointer-events-none text-left">
              <div className="flex flex-col gap-1">
                <span className="text-xs text-gray-400 font-medium">{info.reading}</span>
                <span className="font-bold text-base">{info.word}</span>
                <span className="text-sm border-t border-gray-700 pt-1 mt-1 text-gray-200">{info.meaning}</span>
                <div className="flex gap-2 mt-1 text-xs text-gray-400 font-medium">
                  {info.jlpt > 0 && <span>N{info.jlpt}</span>}
                  <span>Score: {info.score}</span>
                </div>
              </div>
              <div className="absolute top-full left-1/2 -translate-x-1/2 w-0 h-0 border-x-6 border-x-transparent border-t-6 border-t-gray-900" />
            </span>
          </span>
        );
      }

      return <span key={i}>{inner}</span>;
    });
  };

  return (
    <div className="min-h-screen bg-[#F5F2ED] text-gray-900 font-sans flex flex-col">
      <header className="bg-white/80 backdrop-blur-md sticky top-0 z-10 px-6 py-4 border-b border-gray-200">
        <div className="max-w-3xl mx-auto flex items-center justify-between">
          <button 
            onClick={onBack}
            className="flex items-center gap-2 text-gray-600 hover:text-black transition"
          >
            <ArrowLeft className="w-5 h-5" />
            <span className="font-medium text-sm">Exit</span>
          </button>
          <div className="flex items-center gap-3">
             <button 
               onClick={() => setShowFurigana(!showFurigana)}
               className={`text-xs font-bold uppercase tracking-widest px-3 py-1 rounded-full border transition-colors ${showFurigana ? 'bg-indigo-100 text-indigo-700 border-indigo-200' : 'bg-gray-100 text-gray-600 border-gray-200'}`}
             >
               ふりがな {showFurigana ? 'ON' : 'OFF'}
             </button>
             <button 
               onClick={() => setShowHoverDefs(!showHoverDefs)}
               className={`text-xs font-bold uppercase tracking-widest px-3 py-1 rounded-full border transition-colors ${showHoverDefs ? 'bg-green-100 text-green-700 border-green-200' : 'bg-gray-100 text-gray-600 border-gray-200'}`}
             >
               Hover {showHoverDefs ? 'ON' : 'OFF'}
             </button>
             <span className="text-xs font-bold uppercase tracking-widest text-indigo-600 bg-indigo-50 px-3 py-1 rounded-full">{content.type}</span>
          </div>
        </div>
      </header>

      <main className="flex-grow max-w-3xl mx-auto w-full p-6 space-y-12 pb-24">
        {(content.type === 'video' || content.type === 'music') && (
          <div className="w-full aspect-video bg-gray-900 rounded-3xl overflow-hidden relative shadow-xl shadow-black/5">
            {content.mediaUrl && (content.mediaUrl.includes('youtube.com') || content.mediaUrl.includes('youtu.be')) ? (
               <iframe
                 src={`https://www.youtube.com/embed/${getYouTubeId(content.mediaUrl)}`}
                 title="YouTube video player"
                 frameBorder="0"
                 allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                 allowFullScreen
                 className="w-full h-full"
               ></iframe>
            ) : (
              <>
                {content.imageUrl && (
                  <img src={content.imageUrl} alt="" className={`w-full h-full object-cover transition-opacity duration-700 ${isPlaying ? 'opacity-40' : 'opacity-80'}`} />
                )}
                {content.mediaUrl && !content.mediaUrl.includes('youtube') && (
                  <audio 
                    ref={audioRef}
                    src={content.mediaUrl} 
                    className="hidden" 
                    controls 
                    onPlay={() => setIsPlaying(true)} 
                    onPause={() => setIsPlaying(false)} 
                  />
                )}
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  {(!content.mediaUrl || !content.mediaUrl.includes('youtube')) && (
                    <button 
                      onClick={() => setIsPlaying(!isPlaying)}
                      className="w-20 h-20 bg-white/20 hover:bg-white/30 backdrop-blur-md rounded-full flex items-center justify-center text-white transition-all transform hover:scale-105 pointer-events-auto"
                    >
                      {isPlaying ? <Pause className="w-8 h-8" /> : <Play className="w-8 h-8 ml-2" />}
                    </button>
                  )}
                </div>
              </>
            )}
          </div>
        )}

        <article className="space-y-8 bg-white p-8 md:p-12 rounded-3xl shadow-sm border border-gray-100">
          <div>
            <h1 className="text-3xl md:text-5xl font-bold font-serif mb-6 leading-tight">{content.title}</h1>
            <div className="w-16 h-1 bg-indigo-600 rounded-full mb-8" />
          </div>

          <div className="space-y-6 text-lg md:text-xl leading-relaxed text-gray-800">
            {paragraphs.map((p, i) => (
              <div key={i}>{renderParagraph(p)}</div>
            ))}
          </div>
        </article>
      </main>
    </div>
  );
}
