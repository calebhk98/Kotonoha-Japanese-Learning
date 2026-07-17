import {
  getCachedDictionaryEntries,
  findBestVariant,
  getWordScoreBreakdown,
  DictionaryVariant,
  DictionaryEntry,
} from './scoring.js';
import { getMorphemeDefinition } from './morphemeDefinitions.js';
import { getGrammarDefinition } from './extraction-helpers.js';

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
    hint?: { pos?: string }
  ): Promise<{ reading?: string; meaning?: string; meanings?: string[] } | null | false>;
}

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
    pos?: string
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
      // The POS hint changes homograph selection (おく as a noun vs as a
      // verb resolve to different entries), so it must be part of the key.
      const hint = pos ? { pos } : undefined;
      const cacheKey = `${baseForm !== wordStr ? baseForm : wordStr}|${pos ?? ''}`;
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

    // (4) Final kana-only fallback.
    if (meaning === 'Unknown meaning' && /^[ぁ-ん]+$/.test(wordStr)) {
      const morphemeFallback = getMorphemeDefinition(wordStr);
      meaning = morphemeFallback || 'Kana particle / expression';
    }

    // (5) Score calculation — always uses the same variant selected above.
    const { jlpt, joyo, score, breakdown } = getWordScoreBreakdown(wordStr, variant);

    return { reading, meaning, meanings, variant, entry, jlpt, joyo, score, breakdown };
  }
}
