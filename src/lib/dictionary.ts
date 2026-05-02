import { createRequire } from 'module';

export interface WordLookupResult {
  meaning: string;
  meanings?: string[]; // All available meanings/senses
  reading?: string;
}

export interface Dictionary {
  isInitialized(): boolean;
  lookup(word: string): Promise<WordLookupResult | null>;
}

// ==================== Kanji Data Dictionary ====================
export class KanjiDataDictionary implements Dictionary {
  private searchWords: any = null;

  async initialize(): Promise<void> {
    try {
      const kanjiData = await import("kanji-data");
      // Handle both default export and named exports
      this.searchWords = kanjiData.searchWords || (kanjiData.default?.searchWords) || kanjiData.default;
      if (!this.searchWords) {
        console.warn("[Dictionary] kanji-data.searchWords not found in module");
      }
    } catch (e) {
      console.warn("[Dictionary] Failed to load kanji-data:", (e as any).message);
    }
  }

  isInitialized(): boolean {
    return this.searchWords !== null;
  }

  async lookup(word: string): Promise<WordLookupResult | null> {
    if (!this.searchWords || typeof this.searchWords !== 'function') {
      console.log(`[Dictionary.KanjiData] searchWords not available`);
      return null;
    }
    const entries = this.searchWords(word) as any[];
    if (!entries || entries.length === 0) {
      console.log(`[Dictionary.KanjiData] No entries for "${word}"`);
      return null;
    }

    // For pure hiragana, prefer entries with matching pronunciation
    let bestEntry = entries[0];
    if (/^[ぁ-ん]+$/.test(word)) {
      for (const entry of entries) {
        const hasMatchingVariant = entry.variants?.some(
          (v: any) => v.pronounced === word || /[ぁ-ん]/.test(v.written)
        );
        if (hasMatchingVariant) {
          bestEntry = entry;
          break;
        }
      }
    }

    const firstMeaning = bestEntry.meanings?.[0]?.glosses?.[0] || "Unknown";
    console.log(`[Dictionary.KanjiData] Found "${word}": ${firstMeaning}`);
    return {
      meaning: firstMeaning,
      reading: word,
    };
  }
}

// ==================== Unofficial Jisho API Dictionary ====================
export class JishoApiDictionary implements Dictionary {
  private initialized = false;
  private cache = new Map<string, WordLookupResult | null>();
  private requestQueue: Array<() => Promise<void>> = [];
  private activeRequests = 0;
  private maxConcurrent = 2; // Limit to 2 concurrent requests to avoid overwhelming Jisho
  private persistentCache: Map<string, WordLookupResult | null>;
  private onCacheUpdate?: (cache: Map<string, WordLookupResult | null>) => void;

  constructor(persistentCache?: Map<string, WordLookupResult | null>, onCacheUpdate?: (cache: Map<string, WordLookupResult | null>) => void) {
    this.persistentCache = persistentCache || new Map();
    this.onCacheUpdate = onCacheUpdate;
    // Load persistent cache into memory
    for (const [key, value] of this.persistentCache.entries()) {
      this.cache.set(key, value);
    }
  }

  async initialize(): Promise<void> {
    try {
      // Test if we can reach Jisho API
      const testRes = await this.fetchFromJisho("test");
      if (testRes) {
        this.initialized = true;
        console.log(`[Dictionary] Jisho API initialized (max 2 concurrent requests, ${this.cache.size} cached)`);
      }
    } catch (e) {
      console.warn("[Dictionary] Jisho API unavailable:", (e as any).message);
      this.initialized = false;
    }
  }

  private async fetchFromJisho(word: string): Promise<any> {
    const encoded = encodeURIComponent(word);
    const url = `https://jisho.org/api/v1/search/words?keyword=${encoded}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) return null;
    return await res.json();
  }

  private async processQueue(): Promise<void> {
    if (this.activeRequests >= this.maxConcurrent || this.requestQueue.length === 0) {
      return;
    }

    this.activeRequests++;
    const task = this.requestQueue.shift();
    if (task) {
      try {
        await task();
      } catch (e) {
        console.error("[Dictionary] Queue task error:", (e as any).message);
      }
    }
    this.activeRequests--;

    if (this.requestQueue.length > 0) {
      this.processQueue();
    }
  }

  isInitialized(): boolean {
    return this.initialized;
  }

  async lookup(word: string): Promise<WordLookupResult | null> {
    if (!this.initialized) {
      console.log(`[Dictionary.Jisho] Not initialized, returning null for "${word}"`);
      return null;
    }

    // Check cache first
    if (this.cache.has(word)) {
      const cached = this.cache.get(word);
      console.log(`[Dictionary.Jisho] Cache hit for "${word}": ${cached?.meaning || 'null'}`);
      return cached || null;
    }

    // Queue the request
    return new Promise((resolve) => {
      this.requestQueue.push(async () => {
        try {
          const result = await this.fetchFromJisho(word);
          let lookupResult: WordLookupResult | null = null;

          if (result?.data && result.data.length > 0) {
            const firstResult = result.data[0];
            const meanings = firstResult.senses
              ?.flatMap((sense: any) => sense.english_definitions || [])
              .filter(Boolean);

            if (meanings && meanings.length > 0) {
              lookupResult = {
                meaning: meanings[0],
                meanings,
                reading: word,
              };
              console.log(`[Dictionary.Jisho] Found "${word}": ${meanings[0]}`);
            }
          } else {
            console.log(`[Dictionary.Jisho] No results from Jisho API for "${word}"`);
          }

          this.cache.set(word, lookupResult);
          this.persistentCache.set(word, lookupResult);
          this.onCacheUpdate?.(this.persistentCache);
          resolve(lookupResult);
        } catch (e) {
          console.error("[Dictionary.Jisho] Lookup error for", word, ":", (e as any).message);
          this.cache.set(word, null);
          this.persistentCache.set(word, null);
          this.onCacheUpdate?.(this.persistentCache);
          resolve(null);
        } finally {
          this.processQueue();
        }
      });

      this.processQueue();
    });
  }
}

// ==================== JMDict Wrapper Dictionary ====================
export class JmdictDictionary implements Dictionary {
  private db: any = null;
  private initialized = false;
  private readingAnywhere: any = null;
  private kanjiAnywhere: any = null;

  async initialize(jmdictPath: string, jmdictFile: string): Promise<void> {
    try {
      const require = createRequire(import.meta.url);
      const { setup: setupJmdict, readingAnywhere, kanjiAnywhere } = require("jmdict-wrapper");
      this.readingAnywhere = readingAnywhere;
      this.kanjiAnywhere = kanjiAnywhere;

      const result = await setupJmdict(jmdictPath, jmdictFile, false);
      this.db = result.db;
      this.initialized = true;
      console.log(`[Dictionary] JMDict initialized - dictionary date: ${result.dictDate}`);
    } catch (e) {
      console.warn("[Dictionary] Failed to initialize JMDict:", (e as any).message);
      this.initialized = false;
    }
  }

  isInitialized(): boolean {
    return this.initialized && this.db !== null;
  }

  async lookup(word: string): Promise<WordLookupResult | null> {
    if (!this.db || !this.readingAnywhere || !this.kanjiAnywhere) return null;

    try {
      let results: any[] = await this.readingAnywhere(this.db, word, 10);
      if (results.length === 0) {
        results = await this.kanjiAnywhere(this.db, word, 10);
      }
      if (results.length === 0) return null;

      // Find best match: prioritize entries with exact kana/kanji match + common words
      let bestMatch = results.find(
        (r) =>
          r.kana.some((k: any) => k.text === word) ||
          r.kanji.some((k: any) => k.text === word)
      );

      // If no exact match, score all results by commonness
      if (!bestMatch) {
        bestMatch = results.reduce((best: any, current: any) => {
          const bestScore = this.getEntryCommonness(best);
          const currentScore = this.getEntryCommonness(current);
          return currentScore > bestScore ? current : best;
        });
      }

      // Extract all meanings (prioritize more common senses)
      const meanings: string[] = [];
      const sensesWithScores = (bestMatch.sense || []).map((sense: any, idx: number) => ({
        sense,
        order: idx,
        commonness: this.getSenseCommonness(sense)
      }));

      // Sort by commonness (higher first)
      sensesWithScores.sort((a, b) => b.commonness - a.commonness);

      for (const { sense } of sensesWithScores) {
        if (sense.gloss && sense.gloss.length > 0) {
          const glossTexts = (sense.gloss as any[])
            .filter((g) => g.lang === "en")
            .map((g) => g.text);
          if (glossTexts.length > 0) {
            meanings.push(...glossTexts);
          } else if (sense.gloss[0]?.text) {
            meanings.push(sense.gloss[0].text);
          }
        }
      }

      const meaning = meanings[0] || "Unknown";
      return {
        meaning,
        meanings: meanings.length > 0 ? meanings : undefined,
        reading: bestMatch.kana[0]?.text || word,
      };
    } catch (e) {
      console.error("[Dictionary] JMDict lookup error:", (e as any).message);
      return null;
    }
  }

  private getEntryCommonness(entry: any): number {
    // Score entries by how "common" they appear
    let score = 0;

    // Prefer entries with kanji (more concrete words)
    if (entry.kanji && entry.kanji.length > 0) {
      score += 10;
    }

    // Prefer entries with multiple kanji variants (widely used)
    if (entry.kanji && entry.kanji.length > 1) {
      score += 5;
    }

    // Prefer entries with multiple senses (more established)
    if (entry.sense && entry.sense.length > 1) {
      score += 3;
    }

    return score;
  }

  private getSenseCommonness(sense: any): number {
    // Score senses by how "common" they are
    let score = 0;

    // Prefer senses with multiple glosses (well-established meanings)
    if (sense.gloss && Array.isArray(sense.gloss) && sense.gloss.length > 1) {
      score += 5;
    }

    // Penalize specialized meanings
    const gloss = sense.gloss?.[0]?.text || '';
    const specializedTerms = ['esp.', 'rare', 'archaic', 'obsolete', 'old', 'dated', 'specialized'];
    if (specializedTerms.some(term => gloss.toLowerCase().includes(term))) {
      score -= 10;
    }

    // Prefer common grammatical terms
    if (gloss.toLowerCase().includes('copula') || gloss.toLowerCase().includes('auxiliary')) {
      score += 3;
    }

    return score;
  }
}

// ==================== JMnedict Dictionary ====================
export class JmnedictDictionary implements Dictionary {
  private entries: Map<string, WordLookupResult> = new Map();
  private initialized = false;
  private cache = new Map<string, WordLookupResult | null>();

  async initialize(jmnedictFile?: string): Promise<void> {
    try {
      // Load JMnedict data from file or download
      if (jmnedictFile) {
        await this.loadFromFile(jmnedictFile);
      } else {
        // Fallback to minimal initialization
        this.initialized = true;
        console.log(`[Dictionary] JMnedict initialized (fallback mode, no data file)`);
        return;
      }
      this.initialized = true;
      console.log(`[Dictionary] JMnedict initialized with ${this.entries.size} entries`);
    } catch (e) {
      console.warn("[Dictionary] Failed to initialize JMnedict:", (e as any).message);
      this.initialized = true; // Allow initialization to proceed even if data loading fails
    }
  }

  private async loadFromFile(filePath: string): Promise<void> {
    try {
      const fs = (await import('fs')).promises;
      const data = await fs.readFile(filePath, 'utf-8');
      const jsonData = JSON.parse(data);

      // Parse JMnedict JSON format
      if (Array.isArray(jsonData)) {
        for (const entry of jsonData) {
          const kana = entry.kana || entry.reading;
          const kanji = entry.kanji || entry.written;
          const meanings = entry.meanings || entry.gloss || [];

          if (kana) {
            // Primary entry by kana reading
            if (!this.entries.has(kana)) {
              this.entries.set(kana, {
                meaning: Array.isArray(meanings) ? meanings[0] : meanings || "Unknown",
                meanings: Array.isArray(meanings) ? meanings : [meanings],
                reading: kana,
              });
            }
          }

          if (kanji && kanji !== kana) {
            // Also index by kanji/written form
            if (!this.entries.has(kanji)) {
              this.entries.set(kanji, {
                meaning: Array.isArray(meanings) ? meanings[0] : meanings || "Unknown",
                meanings: Array.isArray(meanings) ? meanings : [meanings],
                reading: kana || kanji,
              });
            }
          }
        }
      }
    } catch (e) {
      console.warn("[Dictionary.JMnedict] Failed to load from file:", (e as any).message);
    }
  }

  isInitialized(): boolean {
    return this.initialized;
  }

  async lookup(word: string): Promise<WordLookupResult | null> {
    // Check cache first
    if (this.cache.has(word)) {
      return this.cache.get(word) || null;
    }

    // Look up in entries
    const result = this.entries.get(word) || null;

    // Cache the result (including null results to avoid repeated lookups)
    this.cache.set(word, result);

    if (result) {
      console.log(`[Dictionary.JMnedict] Found "${word}": ${result.meaning}`);
    } else {
      console.log(`[Dictionary.JMnedict] No entry for "${word}"`);
    }

    return result;
  }
}

// ==================== Dictionary Factory ====================
export class DictionaryManager {
  private primary: Dictionary | null = null;
  private fallback1: Dictionary | null = null;
  private fallback2: Dictionary | null = null;
  private fallback3: Dictionary | null = null;

  async initialize(
    usePrimary: "jmdict" | "jisho" | "kanjidata" = "jisho",
    jmdictPath?: string,
    jmdictFile?: string,
    jmnedictFile?: string,
    jishoCache?: Map<string, WordLookupResult | null>,
    onJishoCacheUpdate?: (cache: Map<string, WordLookupResult | null>) => void
  ): Promise<void> {
    if (usePrimary === "jmdict" && jmdictPath && jmdictFile) {
      const jmdictDict = new JmdictDictionary();
      await jmdictDict.initialize(jmdictPath, jmdictFile);
      if (jmdictDict.isInitialized()) {
        this.primary = jmdictDict;

        // Add JMnedict as first fallback
        const jmnedictDict = new JmnedictDictionary();
        await jmnedictDict.initialize(jmnedictFile);
        this.fallback1 = jmnedictDict;

        // Jisho API as second fallback
        this.fallback2 = new JishoApiDictionary(jishoCache, onJishoCacheUpdate);
        await (this.fallback2 as JishoApiDictionary).initialize();

        // KanjiData as third fallback
        this.fallback3 = new KanjiDataDictionary();
        await (this.fallback3 as KanjiDataDictionary).initialize();
        return;
      }
      // If jmdict failed, fall through to try jisho
    }

    if (usePrimary === "jisho" || usePrimary === "jmdict") {
      const jishoDict = new JishoApiDictionary(jishoCache, onJishoCacheUpdate);
      await jishoDict.initialize();
      if (jishoDict.isInitialized()) {
        this.primary = jishoDict;

        // Add JMnedict as first fallback
        const jmnedictDict = new JmnedictDictionary();
        await jmnedictDict.initialize(jmnedictFile);
        this.fallback1 = jmnedictDict;

        // KanjiData as second fallback
        this.fallback2 = new KanjiDataDictionary();
        await (this.fallback2 as KanjiDataDictionary).initialize();
        return;
      }
    }

    // Fall back to kanji-data as primary
    const kanjiDict = new KanjiDataDictionary();
    await kanjiDict.initialize();
    this.primary = kanjiDict;

    // Still add JMnedict as fallback for hiragana proper nouns
    const jmnedictDict = new JmnedictDictionary();
    await jmnedictDict.initialize(jmnedictFile);
    this.fallback1 = jmnedictDict;
  }

  async lookup(word: string): Promise<WordLookupResult | null> {
    if (!this.primary) return null;

    // For pure hiragana words, try JMnedict first (before other fallbacks)
    // This gives priority to proper nouns for hiragana-only words
    const isPureHiragana = /^[ぁ-ん]+$/.test(word);
    if (isPureHiragana && this.fallback1) {
      const jmnedictResult = await this.fallback1.lookup(word);
      if (jmnedictResult) return jmnedictResult;
    }

    const result = await this.primary.lookup(word);
    if (result) return result;

    // Try remaining fallback chain: Jisho API → KanjiData
    if (this.fallback2) {
      const result2 = await this.fallback2.lookup(word);
      if (result2) return result2;
    }

    if (this.fallback3) {
      const result3 = await this.fallback3.lookup(word);
      if (result3) return result3;
    }

    return null;
  }
}
