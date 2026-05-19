import { createRequire } from 'module';

export interface WordLookupResult {
  meaning: string;
  meanings?: string[]; // All available meanings/senses
  reading?: string;
}

export interface Dictionary {
  isInitialized(): boolean;
  lookup(word: string, quiet?: boolean): Promise<WordLookupResult | null>;
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

  async lookup(word: string, quiet: boolean = false): Promise<WordLookupResult | null> {
    if (!this.searchWords || typeof this.searchWords !== 'function') {
      if (!quiet) console.log(`[Dictionary.KanjiData] searchWords not available`);
      return null;
    }
    const entries = this.searchWords(word) as any[];
    if (!entries || entries.length === 0) {
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

  async lookup(word: string, quiet: boolean = false): Promise<WordLookupResult | null> {
    if (!this.initialized) {
      return null;
    }

    // Check cache first
    if (this.cache.has(word)) {
      const cached = this.cache.get(word);
      return cached || null;
    }

    // Queue the request
    return new Promise((resolve) => {
      this.requestQueue.push(async () => {
        try {
          const result = await this.fetchFromJisho(word);
          let lookupResult: WordLookupResult | null = null;

          if (result?.data && result.data.length > 0) {
            // Pick the best result: prefer particles/grammar (no word field), or entry with most senses
            let bestResult = result.data[0];

            // Look for entries without a word (these are particles/grammar words)
            const particleEntry = result.data.find((entry: any) => !entry.japanese?.[0]?.word);
            if (particleEntry) {
              bestResult = particleEntry;
            } else {
              // Otherwise pick the entry with the most senses (usually the most common/complete)
              bestResult = result.data.reduce((best: any, current: any) => {
                const bestSenseCount = best.senses?.length || 0;
                const currentSenseCount = current.senses?.length || 0;
                return currentSenseCount > bestSenseCount ? current : best;
              });
            }

            const meanings = bestResult.senses
              ?.flatMap((sense: any) => sense.english_definitions || [])
              .filter(Boolean);

            if (meanings && meanings.length > 0) {
              lookupResult = {
                meaning: meanings[0],
                meanings,
                reading: word,
              };
            }
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

// ==================== JMDict Helpers (exported for testing) ====================

// ==================== JMDict Helpers (exported for testing) ====================

/**
 * Returns only the English-language gloss strings from a JMDict sense.
 *
 * Fix for #186: the original code had an `else if (sense.gloss[0]?.text)` fallback
 * that pushed the first gloss without a language check. JMDict entries include
 * German (ger), Spanish (spa), and other language glosses, so that fallback could
 * return non-English text as a word's primary definition.
 */
export function getEnglishGlosses(sense: any): string[] {
  return ((sense.gloss as any[]) || [])
    .filter((g) => g.lang === "en" || g.lang === "eng")
    .map((g) => g.text)
    .filter(Boolean);
}

/**
 * Scores a JMDict sense by how "common" / everyday it is.
 *
 * Fix for #187: the original implementation only scanned gloss *text* for strings
 * like "rare" or "archaic", completely missing JMDict's structured `misc` array.
 * JMDict editors mark register in misc[], e.g.:
 *   sl=slang, arch=archaic, obs=obsolete, rare=rare, vulg=vulgar,
 *   derog=derogatory, X=rude/X-rated, id=idiomatic
 * Because misc[] was never read, senses like 猫→"submissive partner" (sl) and
 * 桜→"hired applauder" (arch) scored identically to plain everyday meanings and
 * could sort to the top as the primary definition.
 */
export function getSenseCommonness(sense: any): number {
  let score = 0;
  const misc: string[] = sense.misc || [];

  // Heavy penalty for any explicit register/usage marker. -50 is intentionally
  // large so that even a slang sense with multiple glosses (which earns a +5/+10
  // bonus below) still ranks well below a single-gloss plain sense.
  const uncommonMarkers = ['sl', 'arch', 'obs', 'rare', 'vulg', 'derog', 'X', 'id'];
  if (misc.some((m) => uncommonMarkers.includes(m))) {
    score -= 50;
  }

  // Mild penalty for domain-restricted senses (e.g. computing, music). These
  // are legitimate meanings but rarely what a beginner is looking for.
  if (sense.field && Array.isArray(sense.field) && sense.field.length > 0) {
    score -= 10;
  }

  // Small flat bonus when a sense has more than one English synonym. JMDict
  // editors tend to add glosses for well-established meanings (e.g. 可愛い
  // "cute/adorable/charming" beats the sparse "dainty" sense). The bonus is
  // deliberately small (+2) so it only acts as a tiebreaker between senses
  // that are otherwise indistinguishable — not a primary ordering signal.
  // A progressive bonus (+5 / +10 for more glosses) caused regression: 春
  // "prime (of life)" (3 glosses, +10) outranked "spring (season)" (2 glosses,
  // +5), and 買う "to value (highly)" (3 glosses) outranked "to buy" (1 gloss).
  const enGlosses = getEnglishGlosses(sense);
  if (enGlosses.length > 1) score += 2;

  return score;
}

// ==================== JMDict Wrapper Dictionary ====================
export class JmdictDictionary implements Dictionary {
  private db: any = null;
  private initialized = false;
  private readingAnywhere: any = null;
  private kanjiAnywhere: any = null;
  private readingBeginning: any = null;
  private kanjiBeginning: any = null;

  async initialize(jmdictPath: string, jmdictFile: string): Promise<void> {
    try {
      const require = createRequire(import.meta.url);
      const {
        setup: setupJmdict,
        readingAnywhere,
        kanjiAnywhere,
        readingBeginning,
        kanjiBeginning,
      } = require("jmdict-wrapper");
      this.readingAnywhere = readingAnywhere;
      this.kanjiAnywhere = kanjiAnywhere;
      this.readingBeginning = readingBeginning;
      this.kanjiBeginning = kanjiBeginning;

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

  async lookup(word: string, quiet: boolean = false): Promise<WordLookupResult | null> {
    if (!this.db || !this.readingBeginning || !this.kanjiBeginning) return null;

    try {
      // Use the exact-form indexes (indexes/kana/{word}-* and indexes/kanji/{word}-*)
      // rather than the partial indexes. The partial scan (readingAnywhere / kanjiAnywhere)
      // is limited to 20 results and may miss the target entry when many other words
      // contain the search string as a substring (e.g. 'いい' in おおきい, etc.).
      // readingBeginning / kanjiBeginning scan the prefix-keyed exact-form index which
      // only returns entries where the kana/kanji text STARTS WITH the search word, so
      // we then filter to exact matches. No artificial result limit needed here.
      const [readingCandidates, kanjiCandidates] = await Promise.all([
        this.readingBeginning(this.db, word, -1),
        this.kanjiBeginning(this.db, word, -1),
      ]);

      const allCandidates = [...readingCandidates, ...kanjiCandidates];

      // Keep only entries where a kana or kanji text is EXACTLY the search word.
      const exactMatches = allCandidates.filter(
        (r) =>
          r.kana.some((k: any) => k.text === word) ||
          r.kanji.some((k: any) => k.text === word)
      );

      if (exactMatches.length === 0) return null;

      // Among exact matches, pick the entry with the most senses (most complete entry).
      // For words like 行く that have multiple variants (行く, 往く), all exact matches
      // refer to the same underlying word — pick the most common entry.
      const bestMatch = exactMatches.reduce((best: any, current: any) => {
        const bestScore = this.getEntryCommonness(best);
        const currentScore = this.getEntryCommonness(current);
        return currentScore > bestScore ? current : best;
      });

      // Extract all meanings, deprioritising rare/slang/archaic senses (#187).
      const meanings: string[] = [];
      const sensesWithScores = (bestMatch.sense || []).map((sense: any, idx: number) => ({
        sense,
        order: idx,
        commonness: this.getSenseCommonness(sense)
      }));

      // Sort by commonness descending; use original order as tiebreaker.
      sensesWithScores.sort((a, b) => {
        const diff = b.commonness - a.commonness;
        return diff !== 0 ? diff : a.order - b.order;
      });

      for (const { sense } of sensesWithScores) {
        // getEnglishGlosses() only returns lang:"en" entries, so non-English
        // JMDict senses are silently skipped rather than leaking German/Spanish
        // text as definitions (fix for #186).
        const glossTexts = getEnglishGlosses(sense);
        if (glossTexts.length > 0) {
          meanings.push(...glossTexts);
        }
      }

      // Return null when no English meanings were found — this lets DictionaryManager
      // try the fallback chain (JMnedict → Jisho) rather than returning "Unknown".
      if (meanings.length === 0) return null;

      return {
        meaning: meanings[0],
        meanings: meanings.length > 1 ? meanings : undefined,
        reading: bestMatch.kana[0]?.text || word,
      };
    } catch (e) {
      console.error("[Dictionary] JMDict lookup error:", (e as any).message);
      return null;
    }
  }

  private getEntryCommonness(entry: any): number {
    // Use the jmdict-simplified `common` flag as the primary signal: an entry
    // marked common is the canonical, everyday form that a learner expects to see.
    // Raw kanji presence is only a weak tiebreaker because many obscure/rare entries
    // also have kanji forms — e.g. いい matches 怡々/謂/飯 (all non-common kanji
    // compounds) as well as the plain kana-only いい entry (common:true). Without
    // heavily weighting the common flag, those obscure entries win on kanji count
    // alone and the canonical meaning ("good") is lost.
    const hasKanji = entry.kanji && entry.kanji.length > 0;
    const hasCommonKanji = hasKanji && entry.kanji.some((k: any) => k.common === true);
    const hasCommonKana = entry.kana && entry.kana.some((k: any) => k.common === true);

    let score = 0;
    if (hasCommonKanji) score += 20;           // canonical kanji form (e.g. 猫, 良い)
    else if (hasKanji) score += 3;             // obscure/non-common kanji form

    if (hasCommonKana && !hasKanji) score += 20;  // canonical kana-only word (e.g. いい)
    else if (hasCommonKana) score += 5;            // common reading of a kanji word

    if (entry.sense && entry.sense.length > 1) score += 2;
    return score;
  }

  // Delegates to the module-level getSenseCommonness so the logic can be
  // unit-tested without instantiating the class or touching the database.
  private getSenseCommonness(sense: any): number {
    return getSenseCommonness(sense);
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

  async lookup(word: string, quiet: boolean = false): Promise<WordLookupResult | null> {
    // Check cache first
    if (this.cache.has(word)) {
      return this.cache.get(word) || null;
    }

    // Look up in entries
    const result = this.entries.get(word) || null;

    // Cache the result (including null results to avoid repeated lookups)
    this.cache.set(word, result);

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

    // Try primary dictionary first (Jisho API cache is fastest)
    const result = await this.primary.lookup(word);
    if (result) return result;

    // Try JMnedict for names and proper nouns — these can be hiragana, katakana,
    // or kanji-written (e.g. 和彦, 山城屋). The previous guard limited this to
    // pure-hiragana only, causing kanji-written names to always return null here.
    if (this.fallback1) {
      const jmnedictResult = await this.fallback1.lookup(word);
      if (jmnedictResult) return jmnedictResult;
    }

    // Try remaining fallback chain: KanjiData
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
