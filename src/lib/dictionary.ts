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

  async initialize(): Promise<void> {
    try {
      // Test if we can reach Jisho API
      const testRes = await this.fetchFromJisho("test");
      if (testRes) {
        this.initialized = true;
        console.log("[Dictionary] Jisho API initialized (max 2 concurrent requests)");
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
          resolve(lookupResult);
        } catch (e) {
          console.error("[Dictionary.Jisho] Lookup error for", word, ":", (e as any).message);
          this.cache.set(word, null);
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

      // Find exact match or best match
      const bestMatch = results.find(
        (r) =>
          r.kana.some((k: any) => k.text === word) ||
          r.kanji.some((k: any) => k.text === word)
      ) || results[0];

      // Extract all meanings (senses ordered by frequency in jmdict-simplified)
      const meanings: string[] = [];
      for (const sense of bestMatch.sense) {
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
}

// ==================== Dictionary Factory ====================
export class DictionaryManager {
  private primary: Dictionary | null = null;
  private fallback: Dictionary | null = null;

  async initialize(
    usePrimary: "jmdict" | "jisho" | "kanjidata" = "jisho",
    jmdictPath?: string,
    jmdictFile?: string
  ): Promise<void> {
    if (usePrimary === "jmdict" && jmdictPath && jmdictFile) {
      const jmdictDict = new JmdictDictionary();
      await jmdictDict.initialize(jmdictPath, jmdictFile);
      if (jmdictDict.isInitialized()) {
        this.primary = jmdictDict;
        this.fallback = new JishoApiDictionary();
        await (this.fallback as JishoApiDictionary).initialize();
        return;
      }
      // If jmdict failed, fall through to try jisho
    }

    if (usePrimary === "jisho" || usePrimary === "jmdict") {
      const jishoDict = new JishoApiDictionary();
      await jishoDict.initialize();
      if (jishoDict.isInitialized()) {
        this.primary = jishoDict;
        this.fallback = new KanjiDataDictionary();
        await (this.fallback as KanjiDataDictionary).initialize();
        return;
      }
    }

    // Fall back to kanji-data as primary
    const kanjiDict = new KanjiDataDictionary();
    await kanjiDict.initialize();
    this.primary = kanjiDict;
  }

  async lookup(word: string): Promise<WordLookupResult | null> {
    if (!this.primary) return null;

    const result = await this.primary.lookup(word);
    if (result) return result;

    // Try fallback if primary fails
    if (this.fallback) {
      return await this.fallback.lookup(word);
    }

    return null;
  }
}
