import {
  getCachedDictionaryEntries,
  findBestVariant,
  getWordScoreBreakdown,
  DictionaryVariant,
  DictionaryEntry,
} from './scoring.js';
import { getMorphemeDefinition } from './morphemeDefinitions.js';
import { getGrammarDefinition } from './extraction-helpers.js';
import { getSupplementaryEntry } from '../data/supplementaryDictionary.js';

export interface WordResolution {
  reading: string;
  meaning: string;
  meanings: string[] | undefined;
  variant: DictionaryVariant | null;
  entry: DictionaryEntry | null;
  jlpt: number;
  joyo: boolean;
  score: number;
  // The gloss language actually served (#260), e.g. 'spa' | 'eng'. Undefined
  // when the meaning came from a non-JMDict source (kanji-data, morpheme,
  // compositional fallback), which are English-only for now.
  glossLang?: string;
  breakdown: {
    jlptScore: number;
    joyoPenalty: number;
    highestGrade: number | null;
    freqPenalty: number;
    jlptValues: number[];
    gradeValues: number[];
    priorities: string[];
  };
}

interface DictionaryLike {
  lookup(
    word: string,
    hint?: { pos?: string; reading?: string; lang?: string[] }
  ): Promise<{ reading?: string; meaning?: string; meanings?: string[]; glossLang?: string } | null | false>;
}

/**
 * POS classes whose surface reading equals the word's reading (they don't
 * conjugate), making the tokenizer reading a valid dictionary hint. Verbs,
 * adjectives, and auxiliaries conjugate — their surface reading (よみました)
 * doesn't describe the base form (よむ), so no reading hint is passed.
 */
const NON_CONJUGATING_POS = new Set([
  '名詞', '代名詞', '副詞', '連体詞', '接続詞', '感動詞', '接頭辞', '接尾辞', '形状詞',
]);

/**
 * First gloss only, alternatives stripped — composed meanings would otherwise
 * balloon ("to exist, to live, to be located + …"). Cuts only at TOP-LEVEL
 * commas/semicolons: "to fall (e.g. blossoms, petals)" must survive intact,
 * not truncate to "to fall (e.g. blossoms".
 */
function shortGloss(meaning: string): string {
  const head = meaning.split(' — or:')[0];
  let depth = 0;
  for (let i = 0; i < head.length; i++) {
    const c = head[i];
    if (c === '(') depth++;
    else if (c === ')') depth = Math.max(0, depth - 1);
    else if ((c === ',' || c === ';') && depth === 0) return head.slice(0, i).trim();
  }
  return head.trim();
}

/** Small kana, sokuon, long-vowel mark — never a valid part boundary start. */
const STRETCH_CHARS = /[ぁぃぅぇぉゃゅょっゎァィゥェォャュョッヮー]/;

/** Productive prefixes with fixed glosses (ある夜, 全頭, 同条, 子兎). */
const PREFIX_GLOSSES: Record<string, string> = {
  ある: 'a certain / one', 同: 'the same / said', 全: 'all / whole',
  両: 'both', 各: 'each', 新: 'new', 再: 're- / again', 元: 'former',
  副: 'vice- / assistant', 超: 'super / ultra', 半: 'half',
  子: 'child / young', 大: 'big / great', 小: 'small',
};

/**
 * Productive suffixes with fixed glosses. Multi-char keys (付き, たて) are
 * matched longest-first. Verb-stem suffixes (方, たて) resolve the stem
 * through headCandidates FIRST so 出し方 composes from 出す "to put out",
 * not the noun だし "broth".
 */
const SUFFIX_GLOSSES: Record<string, string> = {
  内: 'within / inside', 後: 'after', 中: 'during / throughout',
  時: 'at the time of', 名: 'name of', 側: 'side',
  費: 'cost / expense', 部: 'department / club', 課: 'section',
  員: 'member / staff', 制: 'system', 産: 'produced in',
  用: 'for use by/as', 式: 'style / ceremony', 的: '-like / -al (adjectival)',
  さ: '-ness (degree noun)', 室: 'room', 棟: 'building / wing',
  目: 'ordinal (-th)', 点: 'point', 展: 'exhibition', 者: 'person',
  化: '-ization / becoming', 先: 'destination / recipient', 日: 'day',
  表: 'chart / table', 着: 'clothing / outfit', 職: 'occupation',
  姿: 'figure / appearance', 書: 'document', 末: 'end of',
  前: 'before / in front of', 形: 'form / shape', 区: 'ward / district',
  法: 'law / method', 条: 'article / clause', 料: 'fee / material',
  付き: 'included / attached',
  方: 'way of doing (how to)', たて: 'freshly / just done',
};
const VERB_STEM_SUFFIXES = new Set(['方', 'たて']);

/** Compound-verb auxiliary glosses (kana form; kanji forms map via reading). */
const AUX_VERB_GLOSSES: Record<string, string> = {
  始める: 'begin to', 直す: 'redo / do again', 込む: 'in / thoroughly',
  上がる: 'up / to completion', 上げる: 'finish doing / up',
  出す: 'start suddenly / out', 続ける: 'continue to', 終わる: 'finish',
  かける: 'be on the verge of / partially', きる: 'do completely',
  すぎる: 'do too much', 合う: 'together / mutually', 回る: 'around',
};

/**
 * Single entry point for word resolution (#197).
 *
 * Bundles kanji-data lookup → JMDict lookup → morpheme fallback → score
 * calculation into one call so server endpoints cannot accidentally use only
 * part of the pipeline (the pattern that caused #188).
 *
 * Inject a DictionaryLike (DictionaryManager) at construction time; pass null
 * when the dictionary is not yet available (score-only paths, tests).
 */
export class WordResolver {
  constructor(private dictionary: DictionaryLike | null = null) {}

  async resolve(
    wordStr: string,
    baseForm: string,
    lookupCache?: Map<string, any>,
    pos?: string,
    tokenReading?: string,
    // Native-language gloss priority (#260), e.g. ['spa','eng']. Defaults to
    // English-only, so every existing caller keeps byte-identical behaviour.
    glossLang?: string[]
  ): Promise<WordResolution> {
    // (1) Early-return for known grammatical morphemes.
    //
    // For pure-kana words like ます/ない, the waterfall reaches JMnedict which
    // stores them as proper nouns ("Masu", "Nai"). Checking morphemeDefinitions
    // first prevents that from ever running (#188). The base form is consulted
    // too (via getGrammarDefinition) so conjugated auxiliary surfaces like
    // たく(たい) / なかっ(ない) / でし(です) don't fall through to homograph
    // dictionary lookup (たく used to resolve to 対 "versus").
    {
      const morphemeDef = getGrammarDefinition(wordStr, baseForm);
      if (morphemeDef) {
        const { jlpt, joyo, score, breakdown } = getWordScoreBreakdown(wordStr, null);
        return {
          reading: wordStr,
          meaning: morphemeDef,
          meanings: undefined,
          variant: null,
          entry: null,
          jlpt,
          joyo,
          score,
          breakdown,
        };
      }
    }

    // (1.5) Supplementary dictionary (#257): curated story names, coinages,
    // and folk-song chants. Checked BEFORE the waterfall because some of
    // these resolve to the WRONG homograph otherwise (なつき, a protagonist
    // name, matched 夏季 "summer season").
    {
      const supp = getSupplementaryEntry(wordStr) ?? getSupplementaryEntry(baseForm);
      if (supp) {
        const { jlpt, joyo, score, breakdown } = getWordScoreBreakdown(wordStr, null);
        return {
          reading: tokenReading ?? supp.reading,
          meaning: supp.meaning,
          meanings: undefined,
          variant: null,
          entry: null,
          jlpt,
          joyo,
          score,
          breakdown,
        };
      }
    }

    // (2) kanji-data (fast, synchronous) — reading + fallback meaning.
    let entries = getCachedDictionaryEntries(baseForm);
    if (entries.length === 0 && baseForm !== wordStr) {
      entries = getCachedDictionaryEntries(wordStr);
    }
    const { variant, entry } = findBestVariant(baseForm, entries);

    let reading = wordStr;
    let kanjiMeaning = 'Unknown meaning';
    let kanjiMeanings: string[] | undefined = undefined;

    if (entry && variant) {
      // A pure-kana surface IS its own reading — kanji-data's variant reading
      // only applies to kanji surfaces. Without this guard, ことば (base 言葉)
      // displayed kanji-data's archaic variant reading けとば.
      reading = /[一-鿿々]/.test(wordStr) ? (variant.pronounced || wordStr) : wordStr;
      kanjiMeaning = entry.meanings[0]?.glosses?.join(', ') || kanjiMeaning;
      const allKanjiMeanings: string[] = [];
      const seen = new Set<string>();
      for (const m of entry.meanings) {
        for (const g of m.glosses || []) {
          if (!seen.has(g)) { seen.add(g); allKanjiMeanings.push(g); }
        }
      }
      if (allKanjiMeanings.length > 1) kanjiMeanings = allKanjiMeanings;
    }

    // (3) JMDict lookup — preferred when it returns a real gloss.
    //
    // kanji-data sense ordering is uncontrolled (can surface rare/archaic/slang
    // senses first, e.g. 猫→"submissive partner", 春→"New Year"). JMDict results
    // are sorted by getSenseCommonness() which deprioritises those senses.
    let meaning = kanjiMeaning;
    let meanings = kanjiMeanings;
    // The language the served gloss is actually in (#260); undefined unless a
    // JMDict hit set it. Lets callers flag English fallback when the learner
    // asked for another language.
    let servedGlossLang: string | undefined;

    if (this.dictionary) {
      // The POS/reading hints change homograph selection (おく as a noun vs
      // as a verb; 前 read まえ vs ぜん), so they must be part of the key.
      const hintReading =
        tokenReading && pos && NON_CONJUGATING_POS.has(pos) ? tokenReading : undefined;
      let hint: { pos?: string; reading?: string; lang?: string[] } | undefined;
      if (pos && hintReading) hint = { pos, reading: hintReading };
      else if (pos) hint = { pos };
      else if (hintReading) hint = { reading: hintReading };
      // Native-language gloss priority (#260) only when a non-default language
      // was requested — leaving hint.lang unset keeps English lookups (and
      // their cache keys) byte-identical.
      if (glossLang && glossLang.length > 0) hint = { ...(hint ?? {}), lang: glossLang };
      // Different languages must not share a cache slot, or a Spanish lookup
      // would serve an English-cached gloss (and vice versa).
      const langKey = glossLang ? glossLang.join(',') : '';
      const cacheKey = `${baseForm !== wordStr ? baseForm : wordStr}|${pos ?? ''}|${hintReading ?? ''}|${langKey}`;
      let dictResult: any = lookupCache?.get(cacheKey) ?? null;

      if (dictResult === null) {
        dictResult = await this.dictionary.lookup(baseForm, hint);
        if (!dictResult && baseForm !== wordStr) {
          dictResult = await this.dictionary.lookup(wordStr, hint);
        }
        lookupCache?.set(cacheKey, dictResult ?? false); // false = "looked up, not found"
      }

      if (dictResult && dictResult !== false) {
        const jmdictMeaning = dictResult.meaning;
        if (jmdictMeaning && jmdictMeaning !== 'Unknown') {
          // For uninflected words the JMDict entry we're taking the meaning
          // from also has the right reading (kana[0]) — kanji-data's variant
          // picker often surfaces archaic readings (餅→あも, 誰→た, 家→け).
          // Conjugated surfaces keep the kanji-data reading as before (the
          // JMDict reading describes the base form, not the surface).
          if (wordStr === baseForm || !reading || reading === wordStr) {
            reading = dictResult.reading || reading;
          }
          meaning = jmdictMeaning;
          meanings = dictResult.meanings;
          if (dictResult.glossLang) servedGlossLang = dictResult.glossLang;
        }
      }
    }

    // (3.5) Compositional fallback (#257): when the whole word is unknown
    // but decomposes transparently, compose a meaning from the parts so
    // learners see the structure (試合後 → "match + 後 (after)") instead of
    // "Unknown meaning".
    if (meaning === 'Unknown meaning' && this.dictionary) {
      const composed = await this.composeUnknown(wordStr, baseForm, pos);
      if (composed) {
        meaning = composed.meaning;
        if (composed.reading && (!reading || reading === wordStr)) reading = composed.reading;
      }
    }

    // (4) Final kana-only fallbacks. The morpheme table is consulted first
    // so real grammar definitions are never shadowed. Unresolvable kana
    // adverbs/interjections and ー-stretched tokens get an honest label —
    // they ARE sound effects (チチチ, まーー), and telling a beginner that is
    // better than "Unknown meaning" and safer than guessing a homograph.
    if (meaning === 'Unknown meaning' && /^[ぁ-ん]+$/.test(wordStr)) {
      const morphemeFallback = getMorphemeDefinition(wordStr);
      if (morphemeFallback) meaning = morphemeFallback;
    }
    if (meaning === 'Unknown meaning' && /^[ぁ-ゟ゠-ヿー〜]+$/.test(wordStr)) {
      if (pos === '副詞' || pos === '感動詞') {
        meaning = 'onomatopoeia / sound effect';
      } else if (/[ー〜]/.test(wordStr)) {
        meaning = 'stretched vocalization / sound (no lexical meaning)';
      } else if (/^[ぁ-ん]+$/.test(wordStr)) {
        meaning = 'Kana particle / expression';
      }
    }

    // (4.5) The tokenizer's contextual reading, when present, beats every
    // other source: it is the reading of THIS surface in THIS sentence
    // (読みました→よみました, 家→いえ), which is exactly what furigana
    // should show.
    if (tokenReading) reading = tokenReading;

    // (5) Score calculation — always uses the same variant selected above.
    const { jlpt, joyo, score, breakdown } = getWordScoreBreakdown(wordStr, variant);

    return { reading, meaning, meanings, variant, entry, jlpt, joyo, score, breakdown, glossLang: servedGlossLang };
  }

  /** Dictionary lookup that only returns real glosses (never "Unknown"). */
  private async lookupPart(word: string): Promise<{ meaning: string; reading?: string } | null> {
    if (!this.dictionary) return null;
    const r = await this.dictionary.lookup(word);
    if (r && typeof r === 'object' && r.meaning && r.meaning !== 'Unknown') {
      return { meaning: r.meaning, reading: r.reading };
    }
    return null;
  }

  /**
   * lookupPart for COMPOSITION parts. Additionally rejects proper-noun
   * glosses on kana-only or single-character parts — those are nearly always
   * JMnedict name noise (いしさ→"Ishisa", スケース→"Scase", 繋→"Kei") that
   * turned review samples into false info. Multi-kanji proper nouns stay
   * allowed: addresses NEED 東京 (Tokyo) / 渋谷区 (Shibuya Ward).
   */
  private async lookupPartStrict(part: string): Promise<{ meaning: string; reading?: string } | null> {
    const r = await this.lookupPart(part);
    if (!r) return null;
    const kanaOnly = /^[ぁ-ゟ゠-ヿー]+$/.test(part);
    if ((kanaOnly || part.length === 1) && /^[A-Z]/.test(r.meaning)) return null;
    return r;
  }

  /**
   * Composes a meaning for an unknown word from its transparent parts
   * (#257). Ordered from most to least specific; every branch requires a
   * successful dictionary hit on the remainder, so nonsense can't compose.
   */
  private async composeUnknown(
    wordStr: string,
    baseForm: string,
    pos?: string
  ): Promise<{ meaning: string; reading?: string } | null> {
    // Mimetics: JMDict lists many only in their 〜と form (ぎゅっ→ぎゅっと,
    // ギュッ→ぎゅっと). Katakana variants retry via their hiragana reading.
    if (/^[ぁ-んーァ-ヴ]+[っッ]$/.test(wordStr)) {
      const hira = wordStr.replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
      const r = await this.lookupPart(hira + 'と');
      if (r) return { meaning: r.meaning, reading: hira };
    }

    // Reduplicated onomatopoeia: JMDict lists the doubled unit (ぱちぱち,
    // どんどん) but stories triple it (パチパチパチ). Retry the doubled unit.
    {
      const hira = baseForm.replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
      const m = /^[ぁ-ゟー]+$/.test(hira) ? hira.match(/^(.{2,4})\1+$/) : null;
      if (m && m[1] + m[1] !== hira) {
        const r = await this.lookupPartStrict(m[1] + m[1]);
        if (r) return { meaning: `${shortGloss(r.meaning)} (repeated)` };
      }
    }

    // Trailing vocal stretch (song dialect): 達ァ → 達, ぽっぽっ → ぽっぽ.
    // Only sokuon/long-vowel marks strip after kana — small VOWELS are part
    // of the preceding mora (ぷしゅっ must not decay to ぷし, which resolves
    // to a homograph). After a kanji, small vowels are pure stretch (達ァ).
    // The remainder must be ≥2 chars or a kanji — a single leftover kana
    // (れー→れ) would resolve to a proverb headword, worse than no meaning.
    {
      const m =
        wordStr.match(/^(.+[一-鿿々])[ぁぃぅぇぉゃゅょっゎァィゥェォャュョッヮー〜]+$/) ??
        wordStr.match(/^(.+?)[っッー〜]+$/);
      if (m && (m[1].length >= 2 || /[一-鿿々]/.test(m[1]))) {
        const r = await this.lookupPartStrict(m[1]);
        if (r) return { meaning: `${shortGloss(r.meaning)} (stretched)`, reading: r.reading };
      }
    }

    // Honorific prefix: お財布 / ご利用 → (polite) + remainder. Sudachi
    // normalizes お/ご to 御 in the base form (お財布→御財布), so the surface
    // must be checked too — matching only the base form misses every
    // kanji-normalized honorific (the #257 follow-up bug). Strict lookup:
    // kana remainders otherwise surface JMnedict names (おいしさ→"Ishisa").
    if (
      (/^[おご御]./.test(baseForm) && baseForm.length >= 3) ||
      (/^[おご]./.test(wordStr) && wordStr.length >= 3)
    ) {
      const remainders = [
        /^[おご御]/.test(baseForm) ? baseForm.slice(1) : null,
        /^[おご]/.test(wordStr) ? wordStr.slice(1) : null,
      ].filter((s): s is string => !!s && s.length >= 2);
      for (const remainder of remainders) {
        const r = await this.lookupPartStrict(remainder);
        if (r) {
          const prefixChar = /^[おご]/.test(wordStr) ? wordStr[0] : 'お';
          return {
            meaning: `(polite お/ご) ${r.meaning}`,
            reading: r.reading ? prefixChar + r.reading : undefined,
          };
        }
      }
    }

    // 何 prefix: 何枚 / 何線 → "how many/which" + counter.
    if (baseForm.length >= 2 && baseForm.startsWith('何')) {
      const r = await this.lookupPart(baseForm.slice(1));
      if (r) return { meaning: `how many / which + ${r.meaning}` };
    }

    // Productive prefixes with fixed glosses (ある夜, 全頭, 同条, 子兎).
    // The dictionary can't help with the prefix itself — ある would resolve
    // to the verb "to exist", not the prenominal "a certain". A single-char
    // remainder that is a known suffix uses the curated suffix gloss too:
    // bare-kanji lookups pick homographs (同条 → 条 came back as "muscle").
    for (const [pfx, gloss] of Object.entries(PREFIX_GLOSSES)) {
      if (baseForm.length > pfx.length && baseForm.startsWith(pfx)) {
        const rest = baseForm.slice(pfx.length);
        if (rest.length === 1 && SUFFIX_GLOSSES[rest]) {
          return { meaning: `${pfx} (${gloss}) + ${rest} (${SUFFIX_GLOSSES[rest]})` };
        }
        const r = await this.lookupPartStrict(rest);
        if (r) return { meaning: `${pfx} (${gloss}) + ${shortGloss(r.meaning)}` };
      }
    }

    // の-compounds Sudachi keeps whole: 次の日 → next + day.
    {
      const m = baseForm.match(/^(.{1,6})の(.{1,6})$/);
      if (m) {
        const [a, b] = await Promise.all([this.lookupPartStrict(m[1]), this.lookupPartStrict(m[2])]);
        if (a && b) return { meaning: `${a.meaning} + の + ${b.meaning}` };
      }
    }

    // Suffix composition; keys from the module table, longest first.
    {
      const suffixKeys = Object.keys(SUFFIX_GLOSSES).sort((a, b) => b.length - a.length);
      for (const sfx of suffixKeys) {
        if (baseForm.length > sfx.length && baseForm.endsWith(sfx)) {
          const stem = baseForm.slice(0, -sfx.length);
          const gloss = SUFFIX_GLOSSES[sfx];
          if (VERB_STEM_SUFFIXES.has(sfx)) {
            for (const head of WordResolver.headCandidates(stem)) {
              const r = await this.lookupPart(head);
              if (r) return { meaning: `${r.meaning} + ${sfx} (${gloss})` };
            }
          }
          const r = await this.lookupPartStrict(stem);
          if (r) return { meaning: `${r.meaning} + ${sfx} (${gloss})` };
          break; // longest matching suffix only — don't cascade to shorter ones
        }
      }
    }

    if (pos === '動詞') {
      // Compound verbs, pass 1: V-stem + known auxiliary (kana form).
      for (const [aux, gloss] of Object.entries(AUX_VERB_GLOSSES)) {
        if (baseForm.length > aux.length && baseForm.endsWith(aux)) {
          const stem = baseForm.slice(0, -aux.length);
          for (const head of WordResolver.headCandidates(stem)) {
            const r = await this.lookupPart(head);
            if (r) return { meaning: `${r.meaning} + ${aux} (${gloss})` };
          }
        }
      }

      // Pass 2: passive/potential and causative base forms — BEFORE the
      // generic split, which would otherwise cut them at a bogus boundary
      // (行かす → 行(やる "to do") + かす "to lend").
      const A_TO_U: Record<string, string> = {
        か: 'く', が: 'ぐ', さ: 'す', た: 'つ', な: 'ぬ',
        ば: 'ぶ', ま: 'む', わ: 'う', ら: 'る',
      };
      const derivedHeads: Array<{ head: string; label: string }> = [];
      const ichidanPassive = baseForm.match(/^(.+)られる$/);
      if (ichidanPassive) derivedHeads.push({ head: ichidanPassive[1] + 'る', label: 'passive/potential form' });
      const godanPassive = baseForm.match(/^(.+)([かがさたなばまわら])れる$/);
      if (godanPassive) derivedHeads.push({ head: godanPassive[1] + A_TO_U[godanPassive[2]], label: 'passive form' });
      const causative = baseForm.match(/^(.+)([かがさたなばまわら])(?:す|せる)$/);
      if (causative) derivedHeads.push({ head: causative[1] + A_TO_U[causative[2]], label: 'causative form' });
      for (const { head, label } of derivedHeads) {
        const r = await this.lookupPartStrict(head);
        if (r) return { meaning: `${shortGloss(r.meaning)} (${label})` };
      }

      // Pass 3: generalized V1-stem + V2 split. The aux table only covers
      // common auxiliaries in kana; Sudachi base forms use kanji (傾き掛ける)
      // and stories are full of lexical two-verb compounds (流し入れる,
      // 掴み殺す). The tail must START WITH KANJI: kana-initial tails split
      // at the wrong boundary (解き捨てる → 解 + き捨てる). The tail's
      // reading maps kanji aux forms back to the table (掛ける→かける) so
      // they keep their curated gloss.
      for (let i = 1; i <= baseForm.length - 2; i++) {
        const stem = baseForm.slice(0, i);
        const tail = baseForm.slice(i);
        if (!/^[一-鿿々]/.test(tail)) continue;
        const r2 = await this.lookupPart(tail);
        if (!r2) continue;
        for (const head of WordResolver.headCandidates(stem)) {
          const r1 = await this.lookupPart(head);
          if (r1) {
            const auxGloss = AUX_VERB_GLOSSES[tail] ?? (r2.reading ? AUX_VERB_GLOSSES[r2.reading] : undefined);
            return auxGloss
              ? { meaning: `${r1.meaning} + ${tail} (${auxGloss})` }
              : { meaning: `${shortGloss(r1.meaning)} + ${tail} (${shortGloss(r2.meaning)})` };
          }
        }
      }
    }

    // Verbal nouns: the masu-stem used as a noun (振り返り→振り返る).
    if (pos === '名詞' && /[きぎしじちにひびみりいえけげせぜてでねべめれ]$/.test(baseForm)) {
      for (const head of WordResolver.headCandidates(baseForm)) {
        const r = await this.lookupPartStrict(head);
        if (r) return { meaning: `${shortGloss(r.meaning)} (noun form of ${head})` };
      }
    }

    // Generic noun-noun compound split — the largest remaining unknown class
    // (ガラスケース, 変更点… and recursive for addresses: 東京都渋谷区).
    // Only for strings containing kanji or katakana: pure-hiragana "nouns"
    // reaching this point are song dialect (あすだ, てぃんさぐ) and every
    // split of them is a homograph accident. Every part must resolve, so
    // nonsense can't compose; the best-scored covering wins (fewest parts,
    // then most-balanced), which picks ガラス+ケース over ガラ+スケース.
    if (pos === '名詞' && /[一-鿿々ァ-ヴ]/.test(baseForm) && !/\s/.test(baseForm)) {
      // A trailing known suffix decomposes with its CURATED gloss first:
      // 女性活躍推進法 must become 女性+活躍+推進 + 法 (law), not pick up a
      // JMnedict entry for an unrelated statute whose name ends the same way.
      const last = baseForm.slice(-1);
      if (SUFFIX_GLOSSES[last] && baseForm.length > 3) {
        const stemParts = await this.bestNounParts(baseForm.slice(0, -1), 3, new Map());
        if (stemParts) {
          const joined = stemParts.map((p) => `${p.surface} (${shortGloss(p.meaning)})`).join(' + ');
          return { meaning: `${joined} + ${last} (${SUFFIX_GLOSSES[last]})` };
        }
      }
      const parts = await this.bestNounParts(baseForm, 3, new Map());
      if (parts && parts.length >= 2) {
        return { meaning: parts.map((p) => `${p.surface} (${shortGloss(p.meaning)})`).join(' + ') };
      }
    }

    return null;
  }

  /**
   * A string is usable as a compound part when it can plausibly stand alone:
   * no whitespace, no stretch-mark/ん start, single chars only if kanji, and
   * no hiragana-leading mixed parts (い水 from 貰い水 is never a word).
   */
  private static isValidPart(p: string): boolean {
    if (/\s/.test(p)) return false;
    if (p.length === 1) return /[一-鿿々]/.test(p);
    if (STRETCH_CHARS.test(p[0]) || p[0] === 'ん' || p[0] === 'ン' || p[0] === 'ー') return false;
    if (/^[ぁ-ん]/.test(p) && /[一-鿿々]/.test(p)) return false;
    return true;
  }

  /**
   * Best full covering of `str` by dictionary-resolvable parts, or null.
   * Scoring: fewer parts, then larger smallest-part. Memoized per top call.
   */
  private async bestNounParts(
    str: string,
    depth: number,
    memo: Map<string, Array<{ surface: string; meaning: string }> | null>
  ): Promise<Array<{ surface: string; meaning: string }> | null> {
    const cached = memo.get(str);
    if (cached !== undefined) return cached;
    let best: Array<{ surface: string; meaning: string }> | null = null;
    if (WordResolver.isValidPart(str)) {
      const direct = await this.lookupPartStrict(str);
      if (direct) best = [{ surface: str, meaning: direct.meaning }];
    }
    if (depth > 0 && str.length >= 2) {
      for (let i = 1; i < str.length; i++) {
        const left = str.slice(0, i);
        if (!WordResolver.isValidPart(left)) continue;
        const lr = await this.lookupPartStrict(left);
        if (!lr) continue;
        const sub = await this.bestNounParts(str.slice(i), depth - 1, memo);
        if (!sub) continue;
        const cand = [{ surface: left, meaning: lr.meaning }, ...sub];
        if (WordResolver.betterParts(cand, best)) best = cand;
      }
    }
    memo.set(str, best);
    return best;
  }

  private static betterParts(
    a: Array<{ surface: string }>,
    b: Array<{ surface: string }> | null
  ): boolean {
    if (!b) return true;
    if (a.length !== b.length) return a.length < b.length;
    const minLen = (parts: Array<{ surface: string }>) => Math.min(...parts.map((p) => p.surface.length));
    return minLen(a) > minLen(b);
  }

  /**
   * Dictionary-form candidates for a masu-stem: ichidan (stem+る) first,
   * then the godan mapping of the final kana (動き→動く, 読み→読む).
   */
  private static headCandidates(stem: string): string[] {
    const candidates = [stem + 'る'];
    const GODAN: Record<string, string> = {
      き: 'く', ぎ: 'ぐ', し: 'す', ち: 'つ', に: 'ぬ',
      ひ: 'ふ', び: 'ぶ', み: 'む', り: 'る', い: 'う',
    };
    const last = stem.slice(-1);
    if (GODAN[last]) candidates.push(stem.slice(0, -1) + GODAN[last]);
    return candidates;
  }
}
