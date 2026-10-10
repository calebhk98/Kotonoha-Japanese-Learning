import { createRequire } from 'module';

export interface WordLookupResult {
  meaning: string;
  meanings?: string[]; // All available meanings/senses
  /** Glosses per sense, in `meanings` order (JMDict only). */
  senseSizes?: number[];
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
  /** Grammatical context from the previous token (tokenContext.ts), e.g. 'te'. */
  after?: string;
  /** Kana lemma (Sudachi dictionary_form) when the lookup key is a kanji spelling. */
  kanaForm?: string;
  /** The text writes this word in kana (lookup key may be a kanji spelling). */
  kanaSurface?: boolean;
  /** Sudachi tags the token as a proper noun (固有名詞). */
  properNoun?: boolean;
  /** ...specifically a person/place/organization name (人名/地名/組織). */
  nameType?: boolean;
  /**
   * English head words of the verb's subject/object noun (風が → ['wind']).
   * Among near-tied homographs, the entry whose glosses mention one wins:
   * 風がふく is 吹く "to blow (of the wind)", not 拭く "to wipe".
   */
  argumentWords?: string[];
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

/** jmdict-simplified restriction lists: "*" (or absent/empty) = applies to all. */
function restrictionAllows(list: string[] | undefined, form: string): boolean {
  return !list || list.length === 0 || list.includes('*') || list.includes(form);
}

/**
 * The senses of `entry` that can apply to this occurrence, in JMDict order.
 * Each filter only narrows when something survives it, so an entry never
 * ends up with no senses:
 *   1. spelling: sense.appliesToKanji / appliesToKana must allow the form
 *      that was looked up
 *   2. reading: for a kanji form, the token's contextual reading must be in
 *      sense.appliesToKana (生物 せいぶつ vs なまもの style splits)
 *   3. POS: the sense's partOfSpeech must fit the token's Sudachi POS, so a
 *      verb token doesn't lead with a noun sense of the same entry
 */
export function selectSenses(entry: any, word: string, hint?: LookupHint): any[] {
  let senses: any[] = entry.sense || [];
  const narrow = (keep: (s: any) => boolean) => {
    const kept = senses.filter(keep);
    if (kept.length > 0) senses = kept;
  };
  const isKanjiForm = (entry.kanji || []).some((k: any) => k.text === word);
  narrow((s) =>
    isKanjiForm ? restrictionAllows(s.appliesToKanji, word) : restrictionAllows(s.appliesToKana, word)
  );
  if (isKanjiForm && hint?.reading && (entry.kana || []).some((k: any) => k.text === hint.reading)) {
    narrow((s) => restrictionAllows(s.appliesToKana, hint.reading!));
  }
  const matches = hint?.pos ? jmdictPosMatcher(hint.pos) : null;
  if (matches) narrow((s) => Array.isArray(s.partOfSpeech) && s.partOfSpeech.some(matches));
  // A proper noun's capitalised sense (日産: "daily output" → "Nissan").
  if (hint?.properNoun) {
    const proper = senses.filter((sn) => /^[A-Z]/.test(getGlosses(sn, ['eng'])[0] ?? ''));
    if (proper.length > 0) senses = [...proper, ...senses.filter((sn) => !proper.includes(sn))];
  }

  // 4. grammatical context: JMDict notes context-bound senses in `info`
  //    ("after the -te form of a verb"). Senses whose note matches this
  //    occurrence's context go first; context-bound senses whose context is
  //    absent go last (ください with no te-form before it is "please give
  //    me", not "please do for me"). Order is otherwise JMDict's.
  // 5. kana spelling as a sense signal, for the few verbs where it is
  //    reliable. A generic "prefer uk senses for kana" rule was measured and
  //    rejected: it turns kana いく into a slang sense and あう into "to have
  //    an accident". Kana あげる, though, is the everyday "to give" (the
  //    "raise" senses are written 上げる).
  const preferred = hint?.kanaSurface ? KANA_PREFERRED_SENSE[word] : undefined;
  if (preferred) {
    const hit = senses.filter((s) => getGlosses(s, ['eng'])[0] === preferred);
    if (hit.length > 0) senses = [...hit, ...senses.filter((s) => !hit.includes(s))];
  }

  const fits = (s: any) => senseFitsHint(s, hint);
  const bound = (s: any) => senseInfo(s).some((i) => /\bafter\b/i.test(i));
  return [
    ...senses.filter((s) => fits(s)),
    ...senses.filter((s) => !fits(s) && !bound(s)),
    ...senses.filter((s) => !fits(s) && bound(s)),
  ];
}

/** Lemma → head gloss of the sense a KANA spelling of it means. */
const KANA_PREFERRED_SENSE: Record<string, string> = {
  上げる: 'to give',
};

const CONTEXT_INFO: Record<string, RegExp> = {
  te: /te[- ]?form/i,
  masu: /-?masu[- ]stem/i,
  'adj-stem': /adj(ective)?\.?[- ]stem/i,
  'verb-plain': /(present|plain|dictionary)[- ](non-past )?form of a verb/i,
  'verb-past': /past form of a verb/i,
};

const senseInfo = (s: any): string[] => (Array.isArray(s.info) ? s.info : []);

/**
 * True when the sense is the one this occurrence's grammatical context
 * calls for: its JMDict note fits ("after the -te form"), or, after a noun,
 * its note marks a compound use (ラーメンバカ: バカ "fervent enthusiast",
 * noted "usu. in compounds").
 * lookup() lets such a sense outrank the slang/rare penalty — バカ's
 * enthusiast sense is tagged sl.
 */
export function senseFitsHint(s: any, hint?: LookupHint): boolean {
  if (!hint?.after) return false;
  // Only senses JMDict NOTES as compound/after-noun uses: a blanket "prefer
  // n-suf senses after a noun" rule was measured on the corpus and lost
  // (一 "best", 回 "episode", 畑 "field of specialization", 箱 "counter").
  // "after a noun" itself is too broad (前's "portion, helping" in 二年前).
  if (hint.after === 'noun') return senseInfo(s).some((i) => /usu\. in compounds|after a (name|person)/i.test(i));
  return senseFitsContext(s, hint.after);
}

/** True when a gloss of the sense names one of the hint's argument words. */
export function senseMentionsArgument(s: any, hint?: LookupHint): boolean {
  const words = hint?.argumentWords;
  if (!words?.length) return false;
  return getGlosses(s, ['eng']).some((g: string) => words.some((w) => new RegExp(`\\b${w}s?\\b`, 'i').test(g)));
}

/** True when the sense's JMDict note fits this grammatical context ('te', …). */
export function senseFitsContext(s: any, after: string): boolean {
  const re = CONTEXT_INFO[after];
  return !!re && senseInfo(s).some((i) => re.test(i));
}

/** True when a sense only applies in a grammatical context ("after ..."). */
export function isContextBoundSense(s: any): boolean {
  return senseInfo(s).some((i) => /\bafter\b/i.test(i));
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
  const posMatcher = hint?.pos ? jmdictPosMatcher(hint.pos) : null;
  if (posMatcher && !entryMatchesPos(entry, hint?.pos)) {
    // No sense fits the token's POS at all (好き tagged as a verb vs the
    // adverb 良く/好く): a common-but-wrong-POS entry must not win on its
    // common flag alone.
    score -= 8;
  }
  if (entryMatchesPos(entry, hint?.pos)) {
    score += 10;
    // 感動詞 is only hinted for clear exclamations (Sudachi's own tag, or
    // tokenContext.interjectionPos for あれ～？), where an interjection entry
    // beats a more common pronoun/noun homograph.
    if (hint?.pos === '感動詞') score += 10;
  }

  // Contextual reading from UniDic — the strongest signal when present.
  // 家の前 reads まえ, so the 前(ぜん) entry cannot match; 六人 reads にん,
  // selecting the people-counter over the standalone-noun ひと entry.
  if (hint?.reading && entry.kana?.some((k: any) => k.text === hint.reading)) {
    // For a kanji word the contextual reading is the strongest signal there
    // is (第2種 しゅ "kind" vs たね "seed"; 等 とう vs ら): it must beat a
    // more common homograph's common-flag lead. Known-bad UniDic readings
    // are corrected before this point (READING_CORRECTIONS etc.).
    score += word && /[一-鿿々]/.test(word) ? 30 : 15;
  } else if (hint?.kanaForm && entry.kana?.some((k: any) => k.text === hint.kanaForm)) {
    // Same signal for conjugating words: the kana lemma (拘る written
    // こだわる) names the entry's reading.
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
    const firstSense = selectSenses(entry, word, hint).find((s: any) => getGlosses(s, [entryLang]).length > 0);
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

/**
 * The one-line meaning a reader sees on hover. The first sense alone often
 * isn't the one in use (肉 "flesh" vs "meat", 結ぶ "to tie" vs "to bear
 * fruit"), so: up to two glosses of the first sense, plus "(also: …)" with
 * the head gloss of the next sense when it is ordinary (not slang/archaic/
 * specialist, not bound to a grammatical context) and the line stays short.
 */
function buildHeadline(sorted: { sense: any; commonness: number }[], langs: string[]): string | undefined {
  const usable = sorted.filter(({ sense }) => getGlosses(sense, langs).length > 0);
  if (usable.length === 0) return undefined;
  const first = getGlosses(usable[0].sense, langs).slice(0, 2).join(', ');
  const second = usable[1];
  // A second sense is only worth showing when it is everyday Japanese: not
  // historical/rare/slang/abbreviation and not a specialist field (大学's
  // "former imperial university (ritsuryō system)" is noise).
  const niche = (sn: any) =>
    (sn.field ?? []).length > 0 ||
    (sn.misc ?? []).some((m: string) => ['hist', 'arch', 'obs', 'rare', 'sl', 'vulg', 'derog', 'abbr', 'dated', 'poet', 'X'].includes(m));
  if (!second || second.commonness < 0 || niche(second.sense) || isContextBoundSense(second.sense) || first.length >= 40) return first;
  const extra = getGlosses(second.sense, langs)[0];
  if (!extra || first.includes(extra)) return first;
  // Marked as secondary: graded on 120 corpus tokens, the extra sense was
  // the right one 8 times where the first was wrong, and odd-but-harmless
  // noise 19 times; "(also: …)" keeps the first sense visibly primary.
  return `${first} (also: ${extra})`;
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

  private forms: Promise<Set<string>> | null = null;

  /**
   * Every JMDict written form (kanji and kana), loaded once from the
   * LevelDB index keys (`indexes/{kana|kanji}/{text}-{id}`). Lets callers
   * test "is this span of tokens a dictionary word?" without a lookup per
   * span (longest-match merging in contentResolver).
   */
  hasForm(text: string): Promise<boolean> {
    if (!this.forms) {
      this.forms = (async () => {
        const set = new Set<string>();
        if (!this.db || typeof this.db.keys !== 'function') return set;
        for (const kind of ['kana', 'kanji']) {
          const prefix = `indexes/${kind}/`;
          for await (const key of this.db.keys({ gte: prefix, lt: `indexes/${kind}0` })) {
            const k = String(key);
            set.add(k.slice(prefix.length, k.lastIndexOf('-')));
          }
        }
        return set;
      })();
    }
    return this.forms.then((set) => set.has(text));
  }

  /**
   * Every exact-match entry for `word` with the score pickBestEntry ranks it
   * by, for inspection tooling (scripts/inspect-text.ts). Not used by lookup.
   */
  async candidates(word: string, hint?: LookupHint): Promise<{ entry: any; score: number; picked: boolean }[]> {
    if (!this.db || typeof this.db.values !== 'function') return [];
    const [kana, kanji] = await Promise.all([this.searchExact(word, 'kana'), this.searchExact(word, 'kanji')]);
    const seen = new Set<string>();
    const all = [...kana, ...kanji].filter((e) => !seen.has(e.id) && seen.add(e.id));
    if (all.length === 0) return [];
    const best = pickBestEntry(all, word, hint);
    return all
      .map((entry) => ({ entry, score: getEntryCommonness(entry, word, hint), picked: entry.id === best.id }))
      .sort((a, b) => b.score - a.score);
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
      let bestMatch = pickBestEntry(exactMatches, word, hint);
      if (hint?.argumentWords?.length) {
        const bestScore = getEntryCommonness(bestMatch, word, hint);
        const mentions = (e: any) =>
          (e.sense ?? []).some((sn: any) =>
            getGlosses(sn, ['eng']).some((g: string) =>
              hint.argumentWords!.some((w) => new RegExp(`\\b${w}\\b`, 'i').test(g))
            )
          );
        if (!mentions(bestMatch)) {
          const alt = exactMatches.find(
            (e) => e !== bestMatch && getEntryCommonness(e, word, hint) >= bestScore - 3 && mentions(e)
          );
          if (alt) bestMatch = alt;
        }
      }

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
      // How many glosses each sense contributed, in `meanings` order, so a
      // later step can treat them as senses again (the translation context
      // step picks a sense, not a gloss).
      const senseSizes: number[] = [];
      const senseLangFilter = primaryGlossLang ? [primaryGlossLang] : DEFAULT_GLOSS_LANGS;
      const sensesWithScores = selectSenses(bestMatch, word, hint).map((sense: any, idx: number) => ({
        sense,
        order: idx,
        commonness:
          this.getSenseCommonness(sense) +
          (senseFitsHint(sense, hint) ? 100 : 0) +
          // A sense whose gloss names this verb's actual object/subject
          // (契約を結ぶ → "to conclude (e.g. a contract)") is the one in use.
          (senseMentionsArgument(sense, hint) ? 60 : 0),
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
          senseSizes.push(glossTexts.length);
        }
      }

      // Return null when no meanings were found in any requested language —
      // this lets DictionaryManager try the fallback chain (JMnedict →
      // kanji-data) rather than returning "Unknown".
      if (meanings.length === 0) return null;

      // Beginner-facing ambiguity: when a homograph scores within a hair of
      // the winner (kana あめ: 飴 vs 雨), say so instead of picking silently.
      const alternatives = findCloseAlternatives(exactMatches, bestMatch, word, hint);
      let meaning = buildHeadline(sensesWithScores, senseLangFilter) || meanings[0];
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
        ...(senseSizes.length > 1 ? { senseSizes } : {}),
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
  /** Every reading of a kanji-written name (京子: あつこ, きょうこ, …). */
  private readingsByWritten: Map<string, { kana: string; meanings: string[] }[]> = new Map();
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

          if (kanji && kanji !== kana && kana && Array.isArray(meanings)) {
            const list = this.readingsByWritten.get(kanji) ?? [];
            list.push({ kana, meanings });
            this.readingsByWritten.set(kanji, list);
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

  async lookup(word: string, quiet: boolean = false, hint?: LookupHint): Promise<WordLookupResult | null> {
    const cacheKey = `${word}|${hint?.reading ?? ''}`;
    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey) || null;
    }

    // A kanji name has many readings (京子 → Atsuko, Kyōko, …); the
    // contextual reading picks the one the text means.
    const byReading = hint?.reading
      ? this.readingsByWritten.get(word)?.find((r) => r.kana === hint.reading)
      : undefined;
    const base = byReading
      ? { meaning: byReading.meanings[0], meanings: byReading.meanings, reading: byReading.kana }
      : this.entries.get(word) || null;
    // Name entries list romanization variants of ONE name (エリン: Hellin,
    // Ellin, Elyn, Erin); show them together and say it is a name, rather
    // than presenting the first variant as the meaning.
    const result = base
      ? { ...base, meaning: `${(base.meanings ?? [base.meaning]).slice(0, 4).join(' / ')} (name)` }
      : null;

    this.cache.set(cacheKey, result);
    return result;
  }
}

// ==================== Dictionary Factory ====================
export class DictionaryManager {
  private primary: Dictionary | null = null;
  private fallback1: Dictionary | null = null;
  private fallback2: Dictionary | null = null;

  /**
   * False when JMDict could not be opened (most often: another process holds
   * the jmdict-db LevelDB lock) and lookups silently degraded to kanji-data,
   * which produces confident nonsense (狐 "to rule a country requires many
   * great men"). Batch tools must refuse to run in that state.
   */
  async usingJmdict(): Promise<boolean> {
    // A locked LevelDB still reports initialized; only a real read tells.
    if (!(this.primary instanceof JmdictDictionary)) return false;
    try {
      return await this.primary.hasForm('猫');
    } catch {
      return false;
    }
  }

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

  /**
   * True when `text` (all kana) is a headword that is actually WRITTEN in
   * kana: a kana-only entry, a usually-kana (uk) sense, or a grammatical
   * expression. と|なり must not merge into 隣 "next to" just because
   * となり is that word's reading.
   */
  async isKanaHeadword(text: string): Promise<boolean> {
    if (!(this.primary instanceof JmdictDictionary)) return false;
    const cands = await this.primary.candidates(text);
    const GRAMMATICAL = new Set(['exp', 'conj', 'adv', 'int', 'prt', 'aux', 'aux-v', 'aux-adj', 'pn', 'adj-pn']);
    return cands.some(({ entry }) =>
      (entry.kana ?? []).some((k: any) => k.text === text) &&
      ((entry.kanji ?? []).length === 0 ||
        (entry.sense ?? []).some((sn: any) => (sn.misc ?? []).includes('uk') || (sn.partOfSpeech ?? []).some((p: string) => GRAMMATICAL.has(p))))
    );
  }

  /** True when every JMDict entry written `text` is only a conjunction. */
  async isConjunctionOnly(text: string): Promise<boolean> {
    if (!(this.primary instanceof JmdictDictionary)) return false;
    const cands = await this.primary.candidates(text);
    return cands.length > 0 && cands.every(({ entry }) =>
      (entry.sense ?? []).every((sn: any) => (sn.partOfSpeech ?? []).every((p: string) => p === 'conj' || p === 'exp'))
      && (entry.sense ?? []).some((sn: any) => (sn.partOfSpeech ?? []).includes('conj')));
  }

  /** True when JMDict has an entry written exactly `text`. */
  async hasForm(text: string): Promise<boolean> {
    return this.primary instanceof JmdictDictionary ? this.primary.hasForm(text) : false;
  }

  /** JMDict exact-match candidates for inspection tooling; [] without JMDict. */
  async candidates(word: string, hint?: LookupHint) {
    return this.primary instanceof JmdictDictionary ? this.primary.candidates(word, hint) : [];
  }

  async lookup(word: string, hint?: LookupHint): Promise<WordLookupResult | null> {
    if (!this.primary) return null;

    // Try primary dictionary first. The hint only means something to JMDict
    // (homograph entry selection); the other dictionaries ignore extra args.
    const result = await this.primary.lookup(word, false, hint);
    // Sudachi says proper noun: JMDict's proper-noun sense wins when it has
    // one (日本 "Japan", 日産 "Nissan" — selectSenses puts capitalised
    // senses first); otherwise the name dictionary does (平作 "Heisaku",
    // バリ "Bali"), not a common-noun homograph ("normal crop", "burr").
    if (hint?.properNoun && hint.nameType && this.fallback1 && !(result && /^[A-Z]/.test(result.meaning))) {
      const name = await this.fallback1.lookup(word, false, hint);
      if (name) return name;
    }
    if (result) return result;

    // Try JMnedict for names and proper nouns — these can be hiragana, katakana,
    // or kanji-written (e.g. 和彦, 山城屋). The previous guard limited this to
    // pure-hiragana only, causing kanji-written names to always return null here.
    if (this.fallback1) {
      const jmnedictResult = await this.fallback1.lookup(word, false, hint);
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
