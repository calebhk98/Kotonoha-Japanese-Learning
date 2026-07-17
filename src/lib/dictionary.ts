import { createRequire } from 'module';

export interface WordLookupResult {
  meaning: string;
  meanings?: string[]; // All available meanings/senses
  reading?: string;
  // The language the returned gloss text is actually in (normalised 3-letter
  // tag, e.g. 'spa' | 'eng'), for the requested-vs-served comparison that lets
  // the UI flag English fallback (#260). Only set by JMDict lookups.
  glossLang?: string;
}

/**
 * Optional disambiguation hints from the tokenizer. `pos` is Sudachi's
 * first part-of-speech element for the token (名詞, 動詞, 助動詞, …) and is
 * used to prefer JMDict entries whose senses are grammatically compatible —
 * e.g. a verb token おく should resolve to 置く "to put", never 奥 or 億.
 * `reading` is the token's contextual reading in hiragana (from UniDic via
 * the rebuilt Sudachi WASM) — the strongest homograph signal: 家の前 reads
 * まえ, which rules out the ぜん entry entirely.
 */
export interface LookupHint {
  pos?: string;
  reading?: string;
  // Native-language gloss priority (#260), e.g. ['spa','eng']. When omitted,
  // lookups return English glosses exactly as before. 'eng' should always be
  // last so English remains the mandatory fallback.
  lang?: string[];
}

export interface Dictionary {
  isInitialized(): boolean;
  lookup(word: string, quiet?: boolean, hint?: LookupHint): Promise<WordLookupResult | null>;
}

/**
 * Maps a Sudachi part-of-speech class to a predicate over JMDict sense
 * partOfSpeech tags. Returns null for POS classes we don't map (punctuation,
 * whitespace, unknown) so they contribute no signal.
 */
function jmdictPosMatcher(sudachiPos: string): ((tag: string) => boolean) | null {
  switch (sudachiPos) {
    case '動詞':   return (t) => t.startsWith('v');
    case '形容詞': return (t) => t.startsWith('adj-i') || t === 'adj-ix';
    case '形状詞': return (t) => t === 'adj-na' || t === 'adj-nari';
    case '副詞':   return (t) => t === 'adv' || t === 'adv-to';
    case '代名詞': return (t) => t === 'pn';
    // 名詞 also accepts noun-like suffixes (suf/n-suf) because punctuation can
    // break Sudachi's suffix attachment — 鬼（おに）たち tags たち as a plain
    // noun even though it's the 達 pluralizing suffix. Counters (ctr) stay
    // excluded: a standalone noun token is practically never a counter, and
    // including them made 頭 resolve to "counter for large animals".
    case '名詞':   return (t) => t === 'n' || t.startsWith('n-') || t === 'num' || t === 'suf';
    case '接尾辞': return (t) => t === 'suf' || t === 'n-suf' || t === 'ctr';
    case '接頭辞': return (t) => t === 'pref' || t === 'n-pref';
    case '助動詞': return (t) => t.startsWith('aux');
    case '助詞':   return (t) => t === 'prt';
    case '接続詞': return (t) => t === 'conj';
    case '連体詞': return (t) => t === 'adj-pn';
    case '感動詞': return (t) => t === 'int';
    default:       return null;
  }
}

/** True when any sense of the entry carries a tag the token's POS accepts. */
function entryMatchesPos(entry: any, sudachiPos: string | undefined): boolean {
  if (!sudachiPos) return false;
  const matches = jmdictPosMatcher(sudachiPos);
  if (!matches) return false;
  return (entry.sense || []).some((s: any) =>
    Array.isArray(s.partOfSpeech) && s.partOfSpeech.some(matches)
  );
}

/** True when any sense is marked uk ("word usually written using kana alone"). */
function entryIsUsuallyKana(entry: any): boolean {
  return (entry.sense || []).some(
    (s: any) => Array.isArray(s.misc) && s.misc.includes('uk')
  );
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

// ==================== JMDict Helpers (exported for testing) ====================

/**
 * Language-code aliases so callers can pass either the 2-letter form ('en',
 * 'es') or JMDict's native ISO-639-2 tag ('eng', 'spa'). Everything is
 * normalised to the 3-letter tag before comparison.
 *
 * The committed jmdict-all-3.6.2.json ships glosses in: eng, ger, dut, hun,
 * rus, spa, fre, slv, swe (English by far the largest at ~438k senses; Spanish
 * ~68k). Coverage of the non-English languages is partial, so callers must
 * always list 'eng' last as the mandatory fallback (see getGlosses / #260).
 */
const GLOSS_LANG_ALIASES: Record<string, string> = {
  en: 'eng', eng: 'eng',
  es: 'spa', spa: 'spa',
  de: 'ger', ger: 'ger',
  fr: 'fre', fre: 'fre',
  nl: 'dut', dut: 'dut',
  ru: 'rus', rus: 'rus',
  hu: 'hun', hun: 'hun',
  sl: 'slv', slv: 'slv',
  sv: 'swe', swe: 'swe',
};

/** The default gloss language when a caller passes no priority list. */
export const DEFAULT_GLOSS_LANGS = ['eng'];

function normGlossLang(lang: string | undefined): string {
  if (!lang) return '';
  return GLOSS_LANG_ALIASES[lang] ?? lang;
}

/**
 * Language-priority gloss extraction (#260). Walks `langPriority` and returns
 * the gloss strings of the FIRST language the sense actually carries, so a
 * Spanish learner (['spa','eng']) gets Spanish where JMDict has it and English
 * everywhere else. Returns [] when none of the requested languages are present.
 *
 * Language codes are matched loosely (see GLOSS_LANG_ALIASES): 'es' and 'spa'
 * both match JMDict's 'spa' tag, 'en' and 'eng' both match 'en'/'eng'.
 */
export function getGlosses(sense: any, langPriority: string[] = DEFAULT_GLOSS_LANGS): string[] {
  const all = (sense?.gloss as any[]) || [];
  for (const wanted of langPriority) {
    const norm = normGlossLang(wanted);
    const matches = all
      .filter((g) => normGlossLang(g.lang) === norm)
      .map((g) => g.text)
      .filter(Boolean);
    if (matches.length > 0) return matches;
  }
  return [];
}

/**
 * The language a sense's gloss text is actually in, given the caller's
 * priority list — i.e. which entry of `langPriority` getGlosses() matched.
 * Returns the normalised 3-letter tag (e.g. 'spa', 'eng') or null when the
 * sense has no gloss in any requested language. Used to flag English fallback
 * in the UI when the learner asked for another language.
 */
export function getGlossLang(sense: any, langPriority: string[] = DEFAULT_GLOSS_LANGS): string | null {
  const all = (sense?.gloss as any[]) || [];
  for (const wanted of langPriority) {
    const norm = normGlossLang(wanted);
    if (all.some((g) => normGlossLang(g.lang) === norm && g.text)) return norm;
  }
  return null;
}

/**
 * Entry-level gloss-language choice (#260). JMDict-simplified "all" groups an
 * entry's senses BY LANGUAGE (English senses first, then ger/spa/...), each
 * sense carrying glosses in a single language. So the language must be decided
 * once for the whole ENTRY — the first requested language present in ANY sense
 * — and then only that language's senses are used. Per-sense fallback would
 * always pick the leading English senses and never reach Spanish.
 *
 * Returns the normalised tag ('spa' | 'eng' | ...) or null when the entry has
 * no gloss in any requested language.
 */
export function getEntryGlossLang(entry: any, langPriority: string[] = DEFAULT_GLOSS_LANGS): string | null {
  const senses = (entry?.sense as any[]) || [];
  for (const wanted of langPriority) {
    const norm = normGlossLang(wanted);
    const present = senses.some((s: any) =>
      ((s.gloss as any[]) || []).some((g) => normGlossLang(g.lang) === norm && g.text)
    );
    if (present) return norm;
  }
  return null;
}

/**
 * Returns only the English-language gloss strings from a JMDict sense.
 *
 * Fix for #186: the original code had an `else if (sense.gloss[0]?.text)` fallback
 * that pushed the first gloss without a language check. JMDict entries include
 * German (ger), Spanish (spa), and other language glosses, so that fallback could
 * return non-English text as a word's primary definition.
 *
 * Now a thin wrapper over getGlosses (#260); behaviour is byte-identical —
 * ['eng'] normalises 'en'/'eng' the same way the old explicit filter did.
 */
export function getEnglishGlosses(sense: any): string[] {
  return getGlosses(sense, DEFAULT_GLOSS_LANGS);
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

  // No penalty for domain-restricted senses (field: ['comp'], ['food'], …).
  // With order-preserving ranking a later domain sense can never overtake an
  // earlier everyday sense anyway, so a flat field penalty's only observable
  // effect was demoting legitimately-primary tagged senses: 飴's first sense
  // "(hard) candy" is tagged {food} and sank below the untagged "amber /
  // yellowish-brown" colour sense.

  // Penalties ONLY — no bonuses. JMDict already lists the fundamental sense
  // first (verified against 読む, 食べる, 泳ぐ, 走る, 春, 買う, 可愛い), and
  // lookup() falls back to original position for equal scores, so unmarked
  // senses keep their native order. An earlier +2 "more synonyms" bonus was
  // meant as a tiebreaker but became the dominant signal (most senses score 0
  // otherwise) and demoted single-gloss primaries: 読む→"to recite (e.g. a
  // sutra)", 食べる→"to live on (e.g. a salary)", 泳ぐ→"to make one's way
  // through the world". This function's only job is to sink explicitly-marked
  // rare/slang/domain senses below the everyday ones.
  return score;
}

/**
 * Scores a JMDict *entry* (as opposed to a sense) by how likely it is to be
 * the entry a learner searching `word` actually wants.
 *
 * Use the jmdict-simplified `common` flag as the primary signal: an entry
 * marked common is the canonical, everyday form that a learner expects to see.
 * Raw kanji presence is only a weak tiebreaker because many obscure/rare entries
 * also have kanji forms — e.g. いい matches 怡々/謂/飯 (all non-common kanji
 * compounds) as well as the plain kana-only いい entry (common:true). Without
 * heavily weighting the common flag, those obscure entries win on kanji count
 * alone and the canonical meaning ("good") is lost.
 */
export function getEntryCommonness(entry: any, word?: string, hint?: LookupHint): number {
  const hasKanji = entry.kanji && entry.kanji.length > 0;
  const hasCommonKanji = hasKanji && entry.kanji.some((k: any) => k.common === true);
  const hasCommonKana = entry.kana && entry.kana.some((k: any) => k.common === true);
  const wordIsKana = !!word && /^[ぁ-んーァ-ヴ]+$/.test(word);

  let score = 0;

  if (wordIsKana) {
    // The text chose to write this word in kana, so "has a canonical kanji
    // form" is NOT evidence the entry is what the author meant — rewarding it
    // made こぶ resolve to 鼓舞 "encouragement" instead of 瘤 "lump", たち to
    // 太刀 "long sword" instead of the 達 pluralizing suffix, and そこ to
    // 底 "bottom" instead of 其処 "there". For kana searches the signals are:
    // a common kana reading, and JMDict's uk marker ("word usually written
    // using kana alone" — exactly the entries that show up as kana in text).
    // uk is worth more than a POS match (+10): it is direct evidence about
    // the written form we observed. BUT it only applies when the entry is
    // grammatically compatible with the token (or we have no POS at all) —
    // otherwise the uk noun 蛙 "frog" would outrank 帰る for a VERB token
    // かえる. Sudachi's POS classes are reliable; uk must never override them.
    const posKnown = !!hint?.pos && jmdictPosMatcher(hint.pos) !== null;
    if (hasCommonKana) score += 20;
    if (entryIsUsuallyKana(entry) && (!posKnown || entryMatchesPos(entry, hint?.pos))) {
      score += 12;
    }
  } else {
    if (hasCommonKanji) score += 20;           // canonical kanji form (e.g. 猫, 良い)
    else if (hasKanji) score += 3;             // obscure/non-common kanji form

    if (hasCommonKana && !hasKanji) score += 20;  // canonical kana-only word
    else if (hasCommonKana) score += 5;            // common reading of a kanji word
  }

  if (entry.sense && entry.sense.length > 1) score += 2;

  // Grammatical compatibility with the token: Sudachi knows おく in
  // おいていきなさい is a VERB, which rules out 奥 "inner part" and 億
  // "hundred million"; a NOUN 頭 rules out the large-animal counter (ctr).
  if (entryMatchesPos(entry, hint?.pos)) score += 10;

  // Contextual reading from UniDic — the strongest signal when present.
  // 家の前 reads まえ, so the 前(ぜん) entry cannot match; 六人 reads にん,
  // selecting the people-counter over the standalone-noun ひと entry.
  if (hint?.reading && entry.kana?.some((k: any) => k.text === hint.reading)) {
    score += 15;
  }

  // Prefer entries where the searched form is the entry's PRIMARY written
  // form. Multiple common entries can exactly match one written form, and
  // without this the tie was broken by database index order:
  //   本  matched both 元/本/… (もと, "origin") and 本 (ほん, "book") at equal
  //       scores — もと came first in the index, so 本 meant "origin".
  //   たい matched 対 ("versus"), 鯛, 隊, 体, … as well as the kana-only
  //       auxiliary ("want to do") — 対 won and たい meant "versus".
  // JMDict lists the canonical form first within an entry, so kanji[0]===word
  // identifies "this entry IS the word" vs "this entry can also be written as
  // the word". The kana check is restricted to kanji-less entries so that
  // shared readings (対/鯛/体 all read たい) don't earn the same boost.
  if (word) {
    if (hasKanji && entry.kanji[0]?.text === word) score += 8;
    if (!hasKanji && entry.kana?.[0]?.text === word) score += 8;
  }

  return score;
}

/**
 * Picks the JMDict entry a learner searching `word` most likely wants, from a
 * list of entries whose kanji or kana exactly match `word`.
 */
export function pickBestEntry(exactMatches: any[], word: string, hint?: LookupHint): any {
  return exactMatches.reduce((best: any, current: any) => {
    const bestScore = getEntryCommonness(best, word, hint);
    const currentScore = getEntryCommonness(current, word, hint);
    return currentScore > bestScore ? current : best;
  });
}

/**
 * Beginner-facing ambiguity: when a losing homograph scores within a small
 * margin of the winner, we genuinely don't know which the author meant
 * (kana あめ is 飴 or 雨 with identical signals). Rather than pick silently,
 * surface the runner-up's primary gloss so the learner sees both options.
 * Returns strings like "rain (雨)", capped at two.
 */
export function findCloseAlternatives(
  exactMatches: any[],
  best: any,
  word: string,
  hint?: LookupHint
): string[] {
  const MARGIN = 3;
  const bestScore = getEntryCommonness(best, word, hint);
  const alternatives: string[] = [];
  const langPriority = hint?.lang ?? DEFAULT_GLOSS_LANGS;

  for (const entry of exactMatches) {
    if (entry === best || entry.id === best.id) continue;
    if (getEntryCommonness(entry, word, hint) < bestScore - MARGIN) continue;

    // Entry-level language choice (senses are grouped by language), then take
    // the first sense in that language.
    const entryLang = getEntryGlossLang(entry, langPriority) ?? DEFAULT_GLOSS_LANGS[0];
    const firstSense = (entry.sense || []).find((s: any) => getGlosses(s, [entryLang]).length > 0);
    if (!firstSense) continue;
    const gloss = getGlosses(firstSense, [entryLang])[0];

    // Label with the written form that distinguishes it from the searched
    // word: the kanji when the search was kana (雨), the kana otherwise (ぜん).
    const kanjiText = entry.kanji?.[0]?.text;
    const kanaText = entry.kana?.[0]?.text;
    const form = kanjiText && kanjiText !== word ? kanjiText : kanaText !== word ? kanaText : kanjiText;
    alternatives.push(form ? `${gloss} (${form})` : gloss);

    if (alternatives.length >= 2) break;
  }

  return alternatives;
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

  /**
   * Exact-match index scan. The wrapper's index keys are
   * `indexes/{kana|kanji}/{text}-{id}`, so the range [`text-`, `text-️`)
   * yields exactly the entries whose element text IS the word — the previous
   * prefix scan (readingBeginning/kanjiBeginning + filter) fetched every
   * entry merely STARTING with the word first: 13,459 full-entry fetches for
   * し where the exact range holds 40. That made cold lookups take seconds
   * and full-corpus resolution (issue #252) take hours.
   */
  private async searchExact(word: string, kind: 'kana' | 'kanji'): Promise<any[]> {
    const gte = `indexes/${kind}/${word}-`;
    const lt = `indexes/${kind}/${word}-\uFE0F`;
    const ids: string[] = [];
    for await (const id of this.db.values({ gte, lt })) ids.push(id);
    return Promise.all(
      ids.map((i) => this.db.get(`raw/words/${i}`).then((x: string) => JSON.parse(x)))
    );
  }

  async lookup(word: string, quiet: boolean = false, hint?: LookupHint): Promise<WordLookupResult | null> {
    if (!this.db) return null;

    try {
      let exactMatches: any[];
      if (typeof this.db.values === 'function') {
        const [kanaMatches, kanjiMatches] = await Promise.all([
          this.searchExact(word, 'kana'),
          this.searchExact(word, 'kanji'),
        ]);
        exactMatches = [...kanaMatches, ...kanjiMatches];
      } else {
        // Fallback for a db without async value iteration: prefix scan + filter
        // (slow for short kana words, but correct).
        if (!this.readingBeginning || !this.kanjiBeginning) return null;
        const [readingCandidates, kanjiCandidates] = await Promise.all([
          this.readingBeginning(this.db, word, -1),
          this.kanjiBeginning(this.db, word, -1),
        ]);
        exactMatches = [...readingCandidates, ...kanjiCandidates].filter(
          (r) =>
            r.kana.some((k: any) => k.text === word) ||
            r.kanji.some((k: any) => k.text === word)
        );
      }

      if (exactMatches.length === 0) return null;

      // Among exact matches, pick the entry a learner most likely wants.
      // For words like 行く that have multiple variants (行く, 往く), all exact matches
      // refer to the same underlying word — pick the most common entry.
      const bestMatch = pickBestEntry(exactMatches, word, hint);

      // Native-language gloss priority (#260): default ['eng'] keeps the
      // English-only behaviour byte-identical; ['spa','eng'] gives Spanish
      // where JMDict has it and English as the mandatory fallback.
      const langPriority = hint?.lang ?? DEFAULT_GLOSS_LANGS;
      // Decide the gloss language once for the whole entry, then use only that
      // language's senses — JMDict groups senses by language (English first),
      // so per-sense selection would never reach the Spanish senses.
      const primaryGlossLang = getEntryGlossLang(bestMatch, langPriority);

      // Extract all meanings, deprioritising rare/slang/archaic senses (#187).
      const meanings: string[] = [];
      const senseLangFilter = primaryGlossLang ? [primaryGlossLang] : DEFAULT_GLOSS_LANGS;
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
        // Only the chosen language's senses contribute glosses; senses in other
        // languages yield [] and are skipped, so text never leaks in the wrong
        // language as a definition (fix for #186, generalised in #260).
        const glossTexts = getGlosses(sense, senseLangFilter);
        if (glossTexts.length > 0) {
          meanings.push(...glossTexts);
        }
      }

      // Return null when no meanings were found in any requested language —
      // this lets DictionaryManager try the fallback chain (JMnedict →
      // kanji-data) rather than returning "Unknown".
      if (meanings.length === 0) return null;

      // Beginner-facing ambiguity: when a homograph scores within a hair of
      // the winner (kana あめ: 飴 vs 雨), say so instead of picking silently.
      const alternatives = findCloseAlternatives(exactMatches, bestMatch, word, hint);
      let meaning = meanings[0];
      if (alternatives.length > 0) {
        meaning = `${meaning} — or: ${alternatives.join('; ')}`;
        meanings.push(...alternatives.map((a) => `Other possibility: ${a}`));
      }

      // Prefer the kana element matching the contextual reading (頭 read
      // かしら shows かしら, not the entry-first あたま).
      const matchedKana =
        hint?.reading && bestMatch.kana?.some((k: any) => k.text === hint.reading)
          ? hint.reading
          : bestMatch.kana[0]?.text;

      return {
        meaning,
        meanings: meanings.length > 1 ? meanings : undefined,
        reading: matchedKana || word,
        ...(primaryGlossLang ? { glossLang: primaryGlossLang } : {}),
      };
    } catch (e) {
      console.error("[Dictionary] JMDict lookup error:", (e as any).message);
      return null;
    }
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

  async initialize(
    usePrimary: "jmdict" | "kanjidata" = "kanjidata",
    jmdictPath?: string,
    jmdictFile?: string,
    jmnedictFile?: string
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

        // KanjiData as second fallback
        this.fallback2 = new KanjiDataDictionary();
        await (this.fallback2 as KanjiDataDictionary).initialize();
        return;
      }
      // If jmdict failed, fall through to kanji-data below.
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

  async lookup(word: string, hint?: LookupHint): Promise<WordLookupResult | null> {
    if (!this.primary) return null;

    // Try primary dictionary first. The hint only means something to JMDict
    // (homograph entry selection); the other dictionaries ignore extra args.
    const result = await this.primary.lookup(word, false, hint);
    if (result) return result;

    // Try JMnedict for names and proper nouns — these can be hiragana, katakana,
    // or kanji-written (e.g. 和彦, 山城屋). The previous guard limited this to
    // pure-hiragana only, causing kanji-written names to always return null here.
    if (this.fallback1) {
      const jmnedictResult = await this.fallback1.lookup(word);
      if (jmnedictResult) return jmnedictResult;
    }

    // Try remaining fallback: KanjiData
    if (this.fallback2) {
      const result2 = await this.fallback2.lookup(word);
      if (result2) return result2;
    }

    return null;
  }
}
