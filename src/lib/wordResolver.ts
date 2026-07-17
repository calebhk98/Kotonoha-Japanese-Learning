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
    hint?: { pos?: string; reading?: string }
  ): Promise<{ reading?: string; meaning?: string; meanings?: string[] } | null | false>;
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
    tokenReading?: string
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

    if (this.dictionary) {
      // The POS/reading hints change homograph selection (おく as a noun vs
      // as a verb; 前 read まえ vs ぜん), so they must be part of the key.
      const hintReading =
        tokenReading && pos && NON_CONJUGATING_POS.has(pos) ? tokenReading : undefined;
      let hint: { pos?: string; reading?: string } | undefined;
      if (pos && hintReading) hint = { pos, reading: hintReading };
      else if (pos) hint = { pos };
      else if (hintReading) hint = { reading: hintReading };
      const cacheKey = `${baseForm !== wordStr ? baseForm : wordStr}|${pos ?? ''}|${hintReading ?? ''}`;
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

    // (4) Final kana-only fallback.
    if (meaning === 'Unknown meaning' && /^[ぁ-ん]+$/.test(wordStr)) {
      const morphemeFallback = getMorphemeDefinition(wordStr);
      meaning = morphemeFallback || 'Kana particle / expression';
    }

    // (4.5) The tokenizer's contextual reading, when present, beats every
    // other source: it is the reading of THIS surface in THIS sentence
    // (読みました→よみました, 家→いえ), which is exactly what furigana
    // should show.
    if (tokenReading) reading = tokenReading;

    // (5) Score calculation — always uses the same variant selected above.
    const { jlpt, joyo, score, breakdown } = getWordScoreBreakdown(wordStr, variant);

    return { reading, meaning, meanings, variant, entry, jlpt, joyo, score, breakdown };
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

    // Honorific prefix: お財布 / ご利用 → (polite) + remainder.
    if (/^[おご]./.test(baseForm) && baseForm.length >= 3) {
      const r = await this.lookupPart(baseForm.slice(1));
      if (r) {
        return {
          meaning: `(polite お/ご) ${r.meaning}`,
          reading: r.reading ? baseForm[0] + r.reading : undefined,
        };
      }
    }

    // 何 prefix: 何枚 / 何線 → "how many/which" + counter.
    if (baseForm.length >= 2 && baseForm.startsWith('何')) {
      const r = await this.lookupPart(baseForm.slice(1));
      if (r) return { meaning: `how many / which + ${r.meaning}` };
    }

    // の-compounds Sudachi keeps whole: 次の日 → next + day.
    {
      const m = baseForm.match(/^(.{1,6})の(.{1,6})$/);
      if (m) {
        const [a, b] = await Promise.all([this.lookupPart(m[1]), this.lookupPart(m[2])]);
        if (a && b) return { meaning: `${a.meaning} + の + ${b.meaning}` };
      }
    }

    // Productive single-kanji suffixes with fixed glosses.
    const SUFFIX_GLOSSES: Record<string, string> = {
      内: 'within / inside', 後: 'after', 中: 'during / throughout',
      時: 'at the time of', 名: 'name of', 側: 'side',
      費: 'cost / expense', 部: 'department / club', 課: 'section',
      員: 'member / staff', 制: 'system', 産: 'produced in',
      用: 'for use by/as', 式: 'style / ceremony', 的: '-like / -al (adjectival)',
      さ: '-ness (degree noun)', 室: 'room', 棟: 'building / wing',
      目: 'ordinal (-th)',
    };
    const lastChar = baseForm.slice(-1);
    if (SUFFIX_GLOSSES[lastChar] && baseForm.length >= 2) {
      const r = await this.lookupPart(baseForm.slice(0, -1));
      if (r) return { meaning: `${r.meaning} + ${lastChar} (${SUFFIX_GLOSSES[lastChar]})` };
    }

    // Compound verbs: V-stem + productive auxiliary verb.
    const AUX_VERB_GLOSSES: Record<string, string> = {
      始める: 'begin to', 直す: 'redo / do again', 込む: 'in / thoroughly',
      上がる: 'up / to completion', 上げる: 'finish doing / up',
      出す: 'start suddenly / out', 続ける: 'continue to', 終わる: 'finish',
      かける: 'be on the verge of / partially', きる: 'do completely',
      すぎる: 'do too much', 合う: 'together / mutually', 回る: 'around',
    };
    if (pos === '動詞') {
      for (const [aux, gloss] of Object.entries(AUX_VERB_GLOSSES)) {
        if (baseForm.length > aux.length && baseForm.endsWith(aux)) {
          const stem = baseForm.slice(0, -aux.length);
          for (const head of WordResolver.headCandidates(stem)) {
            const r = await this.lookupPart(head);
            if (r) return { meaning: `${r.meaning} + ${aux} (${gloss})` };
          }
        }
      }
    }

    return null;
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
