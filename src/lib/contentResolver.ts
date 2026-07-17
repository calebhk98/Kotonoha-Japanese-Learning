/**
 * Shared content-resolution pipeline (issue #252).
 *
 * Turns a content item's text into BOTH artifacts the app needs, in one
 * tokenization pass:
 *   - `tokens`: positioned reader tokens (what /api/process-story serves)
 *   - `words`:  the unique vocab/morpheme list (what /api/content/:id/words
 *               and the startup extraction produce)
 *
 * Used by server.ts at request time (live fallback) and by
 * scripts/resolve-content.ts at build time, which writes the result as
 * `resolved.json` next to the content so the server can serve it statically.
 * Keeping ONE implementation here is what guarantees the precomputed and
 * live paths cannot drift (the #188/#197 lesson).
 *
 * resolved.json is committed, so output must be DETERMINISTIC: no
 * timestamps, no machine-local data, stable ordering (first-appearance
 * order for words, text order for tokens).
 */

import type { Tokenizer, TokenInfo } from './tokenizers.js';
import type { WordResolver } from './wordResolver.js';
import { isPunctuation, isSingleKana, getGrammarDefinition } from './extraction-helpers.js';

export const RESOLVED_FORMAT_VERSION = 1;

export interface ResolvedToken {
  surface: string;
  startIndex: number;
  endIndex: number;
  isVocabWord: boolean;
  isMorpheme: boolean;
  pos?: string;
  reading?: string;
  /** Index into ResolvedContent.words for this token's word info, if any. */
  wordIndex?: number;
}

export interface ResolvedContent {
  formatVersion: number;
  words: any[];
  tokens: ResolvedToken[];
}

const EMPTY_BREAKDOWN = {
  jlptScore: 0, joyoPenalty: 0, highestGrade: null,
  freqPenalty: 0, jlptValues: [], gradeValues: [], priorities: [],
};

/**
 * Resolve a content item's full text into reader tokens + vocab words.
 * Mirrors the classification rules used by the extraction paths:
 *   - grammar morphemes (incl. conjugated aux surfaces via base form) get
 *     morpheme-table definitions and zero scores
 *   - other Japanese tokens resolve through WordResolver (pos+reading hints)
 *   - single kana with no table entry get a generic fallback (never JMDict)
 */
export async function resolveContent(
  text: string,
  tokenizer: Tokenizer,
  wordResolver: WordResolver,
  lookupCache?: Map<string, any>
): Promise<ResolvedContent> {
  const tokenInfos = await tokenizer.segment(text);

  // ---- position mapping + classification (same rules as processStoryText)
  interface WorkToken extends ResolvedToken { baseForm: string; isJapanese: boolean }
  const tokens: WorkToken[] = [];
  let searchStart = 0;

  for (const t of tokenInfos) {
    const surface = t.surface;
    const segmentIndex = text.indexOf(surface, searchStart);
    if (segmentIndex === -1) continue;

    const isJapanese = surface.trim() !== '' && !isPunctuation(surface);
    const isMorpheme = isJapanese && getGrammarDefinition(surface, t.baseForm) !== undefined;
    const isVocabWord = isJapanese && !isMorpheme && !isSingleKana(surface);

    tokens.push({
      surface,
      baseForm: t.baseForm,
      pos: t.pos,
      reading: t.reading,
      startIndex: segmentIndex,
      endIndex: segmentIndex + surface.length,
      isVocabWord,
      isMorpheme,
      isJapanese,
    });
    searchStart = segmentIndex + surface.length;
  }

  // ---- build the unique word list (first-appearance order, keyed by surface)
  const wordIndexBySurface = new Map<string, number>();
  const frequency = new Map<string, number>();
  const uniqueTokens: typeof tokens = [];

  for (const token of tokens) {
    if (!token.isJapanese) continue;
    frequency.set(token.surface, (frequency.get(token.surface) ?? 0) + 1);
    if (wordIndexBySurface.has(token.surface)) continue;
    wordIndexBySurface.set(token.surface, uniqueTokens.length);
    uniqueTokens.push(token);
  }

  // Dictionary lookups are independent — resolve with bounded concurrency
  // (each vocab word costs two LevelDB index scans; sequential resolution
  // made full-corpus generation take hours). Output order stays the
  // deterministic first-appearance order regardless of completion order.
  const CONCURRENCY = 8;
  const words: any[] = new Array(uniqueTokens.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, uniqueTokens.length) }, async () => {
      while (next < uniqueTokens.length) {
        const i = next++;
        const token = uniqueTokens[i];
        if (token.isMorpheme) {
          words[i] = {
            word: token.surface,
            reading: token.reading ?? token.surface,
            meaning: getGrammarDefinition(token.surface, token.baseForm) || 'Grammatical morpheme',
            jlpt: 0,
            joyo: false,
            score: 0,
            breakdown: EMPTY_BREAKDOWN,
            isMorpheme: true,
          };
        } else if (token.isVocabWord) {
          const { reading, meaning, meanings, jlpt, joyo, score, breakdown } =
            await wordResolver.resolve(token.surface, token.baseForm, lookupCache, token.pos, token.reading);
          const info: any = { word: token.surface, reading, meaning, jlpt, joyo, score, breakdown };
          if (meanings) info.meanings = meanings;
          if (token.pos) info.pos = token.pos;
          words[i] = info;
        } else {
          // Single kana with no morpheme-table entry — still hoverable, but a
          // JMDict homograph lookup would be nonsense (ね→根 "root").
          words[i] = {
            word: token.surface,
            reading: token.surface,
            meaning: 'Kana particle / expression',
            jlpt: 0,
            joyo: false,
            score: 0,
            breakdown: EMPTY_BREAKDOWN,
            isMorpheme: true,
          };
        }
      }
    })
  );

  // frequencies (per surface, matching the extraction paths' counts)
  for (const w of words) {
    if (!w.isMorpheme || frequency.has(w.word)) {
      w.frequencyInContent = frequency.get(w.word) ?? 1;
    }
  }

  return {
    formatVersion: RESOLVED_FORMAT_VERSION,
    words,
    tokens: tokens.map(({ baseForm, isJapanese, isVocabWord, isMorpheme, ...rest }) => ({
      ...rest,
      // For the client, isVocabWord doubles as "hoverable": every Japanese
      // token with word info is clickable in the reader.
      isVocabWord: isJapanese,
      isMorpheme,
      wordIndex: wordIndexBySurface.get(rest.surface),
    })),
  };
}

/**
 * Reconstructs the /api/process-story response shape (tokens with inline
 * wordInfo) from a ResolvedContent.
 */
export function buildStoryResponse(resolved: ResolvedContent): any[] {
  return resolved.tokens.map(({ wordIndex, ...token }) => {
    if (wordIndex === undefined) return token;
    return { ...token, wordInfo: resolved.words[wordIndex] };
  });
}

/**
 * Reconstructs the /api/content/:id/words response shape (vocab list —
 * morphemes included, generic single-kana fallback entries excluded, same
 * as the extraction paths which never emitted those).
 */
export function buildWordsResponse(resolved: ResolvedContent): any[] {
  return resolved.words.filter(
    (w) => !(w.isMorpheme && w.meaning === 'Kana particle / expression')
  );
}
