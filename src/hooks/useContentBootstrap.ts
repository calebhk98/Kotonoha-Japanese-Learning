import { Dispatch, SetStateAction, useEffect, useMemo, useState } from 'react';
import { Content } from '../data/content';
import { getAllContentWords } from '../lib/api';
import { WaniKaniData } from '../lib/wanikani';
import { applyWaniKaniToWords } from './useContentData';
import { WordInfo } from '../types';

/**
 * Owns the content-loading side of the app shell: fetching disk-based
 * content from /api/content, merging in user-imported customContent
 * (persisted to localStorage), and the background startup job that loads
 * already-processed vocab from the server then batch-extracts whatever is
 * still missing.
 *
 * Extracted from App.tsx (issue #255) — behavior is unchanged, just moved.
 */
export function useContentBootstrap(
  wkData: WaniKaniData | null,
  setContentVocab: Dispatch<SetStateAction<Record<string, WordInfo[]>>>,
) {
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

  const allContent = useMemo(() => {
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
      if (!allContent.length) return;

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
      const missing = allContent.filter(c => !serverVocab[c.id]);
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

    const shouldRun = !batchExtractionAttempted && allContent.length > 0;
    if (shouldRun) {
      const timer = setTimeout(startup, 500);
      return () => clearTimeout(timer);
    }
    // Matches the original App.tsx effect: depend on allContent.length (not
    // the array reference) plus batchExtractionAttempted/wkData.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allContent.length, batchExtractionAttempted, wkData]);

  return {
    diskContent,
    customContent,
    setCustomContent,
    allContent,
  };
}
