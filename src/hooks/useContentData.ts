import { useState, useEffect, useCallback, useRef } from 'react';
import { WordInfo } from '../types';
import { extractVocabulary } from '../lib/api';
import { Content } from '../data/content';
import { WaniKaniData, getWaniKaniMultiplier, getWaniKaniSrsStage, loadCachedWaniKaniData } from '../lib/wanikani';

function applyWaniKaniToWords(words: WordInfo[], wkData: WaniKaniData): WordInfo[] {
  return words.map(word => {
    const srsStage = getWaniKaniSrsStage(word.word, wkData);
    const multiplier = getWaniKaniMultiplier(word.word, wkData);

    const updatedWord: WordInfo = { ...word };
    if (srsStage !== null) {
      updatedWord.wkSrsStage = srsStage;
    }

    if (multiplier === 1.0) return updatedWord;
    const baseScore = word.baseScore ?? word.score;
    const adjustedScore = Math.max(1, Math.round(baseScore * multiplier));
    return { ...updatedWord, score: adjustedScore, baseScore, wkMultiplier: multiplier };
  });
}

export function useContentData() {
  const [knownWords, setKnownWords] = useState<Set<string>>(new Set());
  const [contentVocab, setContentVocab] = useState<Record<string, WordInfo[]>>({});
  const [loadingContent, setLoadingContent] = useState<Record<string, boolean>>({});
  const [wkData, setWkData] = useState<WaniKaniData | null>(null);

  // Load from local storage
  useEffect(() => {
    const savedKnownWords = localStorage.getItem('knownWords');
    if (savedKnownWords) {
      try {
        const parsed = JSON.parse(savedKnownWords);
        setKnownWords(new Set(parsed));
        console.log(`[Storage] Restored ${parsed.length} known words from localStorage`);
      } catch (e) {
        console.error("Failed to parse known words from localStorage:", e);
      }
    }

    const savedVocab = localStorage.getItem('contentVocab');
    if (savedVocab) {
      try {
        const parsed = JSON.parse(savedVocab);
        // Validate if old cache format uses baseScore instead of jlptScore
        let isValid = true;
        for (const key of Object.keys(parsed)) {
          const arr = parsed[key];
          if (arr.length > 0 && (!arr[0].breakdown || arr[0].breakdown.jlptScore === undefined || arr[0].breakdown.highestGrade === undefined)) {
            isValid = false;
            break;
          }
        }
        if (isValid) {
          setContentVocab(parsed);
          console.log(`[Storage] Restored vocab cache for ${Object.keys(parsed).length} content items`);
        } else {
          localStorage.removeItem('contentVocab');
          console.warn("[Storage] Discarded outdated vocab cache (missing jlptScore/highestGrade)");
        }
      } catch (e) {
        console.error("Failed to parse content vocab from localStorage:", e);
      }
    }

    const cached = loadCachedWaniKaniData();
    if (cached) {
      setWkData(cached.data);
      console.log(`[WaniKani] Loaded ${cached.kanjiCount} kanji SRS entries from cache`);
    }
  }, []);

  // Re-apply WaniKani multipliers to all cached vocab when wkData changes
  const wkDataRef = useRef<WaniKaniData | null>(null);
  useEffect(() => {
    wkDataRef.current = wkData;
  }, [wkData]);

  const applyWaniKaniToAllVocab = useCallback((data: WaniKaniData) => {
    setContentVocab(prev => {
      const next: Record<string, WordInfo[]> = {};
      for (const [id, words] of Object.entries(prev) as [string, WordInfo[]][]) {
        next[id] = applyWaniKaniToWords(words, data);
      }
      return next;
    });
  }, []);

  const refreshWaniKaniData = useCallback(() => {
    const cached = loadCachedWaniKaniData();
    if (cached) {
      setWkData(cached.data);
      applyWaniKaniToAllVocab(cached.data);
    }
  }, [applyWaniKaniToAllVocab]);

  const markWordAsKnown = useCallback((word: string) => {
    setKnownWords(prev => {
      const next = new Set(prev);
      next.add(word);
      localStorage.setItem('knownWords', JSON.stringify(Array.from(next)));
      return next;
    });
  }, []);

  const markWordsAsKnown = useCallback((words: string[]) => {
    setKnownWords(prev => {
      const next = new Set(prev);
      words.forEach(w => next.add(w));
      localStorage.setItem('knownWords', JSON.stringify(Array.from(next)));
      return next;
    });
  }, []);

  const contentVocabRef = useRef<Record<string, WordInfo[]>>({});
  const loadingContentRef = useRef<Record<string, boolean>>({});

  useEffect(() => {
    contentVocabRef.current = contentVocab;
  }, [contentVocab]);

  useEffect(() => {
    loadingContentRef.current = loadingContent;
  }, [loadingContent]);

  const loadVocabForContent = useCallback(async (content: Content, forceReload = false) => {
    // If we already have it or are loading it, do nothing unless forcing reload
    if (!forceReload && (contentVocabRef.current[content.id] || loadingContentRef.current[content.id])) {
      return;
    }

    loadingContentRef.current[content.id] = true;
    setLoadingContent(prev => ({ ...prev, [content.id]: true }));
    console.log(`[Vocab] Loading vocabulary for "${content.id}"`);
    try {
      let words = await extractVocabulary(content.text);
      console.log(`[Vocab] Loaded ${words.length} words for "${content.id}"`);

      if (wkDataRef.current) {
        words = applyWaniKaniToWords(words, wkDataRef.current);
      }

      setContentVocab(prev => {
        const next = { ...prev, [content.id]: words };
        localStorage.setItem('contentVocab', JSON.stringify(next));
        return next;
      });
    } catch (err) {
      console.error(`[Vocab] Failed to load vocabulary for "${content.id}":`, err);
    } finally {
      loadingContentRef.current[content.id] = false;
      setLoadingContent(prev => ({ ...prev, [content.id]: false }));
    }
  }, []);

  // Difficulty is the average difficulty of UNKNOWN words.
  // If all words are known, difficulty is 0.
  // Words are considered known if: manually marked OR WaniKani SRS stage >= 7 (Master and above)
  const isWordKnown = useCallback((word: WordInfo): boolean => {
    if (knownWords.has(word.word)) return true;
    if (word.wkSrsStage !== undefined && word.wkSrsStage >= 7) return true;
    return false;
  }, [knownWords]);

  const getContentStatus = useCallback((contentId: string) => {
    const words = contentVocab[contentId];
    if (!words) return { difficulty: 0, unknownCount: 0, totalCount: 0, score: 0, totalUnknownScore: 0, unknownWords: [], knownWords: [], comprehension: 0 };

    const unknownWords = words.filter(w => !isWordKnown(w));
    const knownVocab = words.filter(w => isWordKnown(w));

    const totalUnknownScore = unknownWords.reduce((acc, w) => acc + w.score, 0);
    const totalKnownScore = knownVocab.reduce((acc, w) => acc + w.score, 0);

    const avgScore = unknownWords.length > 0 ? Math.round(totalUnknownScore / unknownWords.length) : 0;
    const difficultyScore = totalUnknownScore + (totalKnownScore * 0.5);
    const comprehension = words.length > 0 ? Math.round((knownVocab.length / words.length) * 100) : 0;

    return {
      difficulty: avgScore,
      totalUnknownScore,
      unknownCount: unknownWords.length,
      totalCount: words.length,
      score: difficultyScore,
      unknownWords,
      knownWords: knownVocab,
      comprehension,
    };
  }, [contentVocab, isWordKnown]);

  const clearKnownWords = useCallback(() => {
    setKnownWords(new Set());
    localStorage.removeItem('knownWords');
  }, []);

  const clearContentVocab = useCallback(() => {
    setContentVocab({});
    localStorage.removeItem('contentVocab');
    console.log("[Storage] Vocab cache cleared");
  }, []);

  const updateWord = useCallback((wordStr: string, updatedWord: WordInfo) => {
    setContentVocab(prev => {
      const next: Record<string, WordInfo[]> = {};
      let changed = false;

      for (const [key, words] of Object.entries(prev) as [string, WordInfo[]][]) {
        let listChanged = false;
        const newWords = words.map(w => {
          if (w.word === wordStr) {
            listChanged = true;
            changed = true;
            return updatedWord;
          }
          return w;
        });
        next[key] = listChanged ? newWords : words;
      }

      if (changed) {
        localStorage.setItem('contentVocab', JSON.stringify(next));
        return next;
      }
      return prev;
    });
  }, []);

  return {
    knownWords,
    contentVocab,
    loadingContent,
    wkData,
    markWordAsKnown,
    markWordsAsKnown,
    clearKnownWords,
    clearContentVocab,
    loadVocabForContent,
    getContentStatus,
    updateWord,
    setContentVocab,
    refreshWaniKaniData,
  };
}
