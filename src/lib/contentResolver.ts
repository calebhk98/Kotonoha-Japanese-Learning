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
import { getGrammarDefinition, getContextualGrammarLabel } from './extraction-helpers.js';
import { mergeFixedExpressions, grammaticalContext, interjectionPos, nextTo, type PositionedToken, type GrammaticalContext } from './tokenContext.js';
import { getDisplayProfile } from './language/registry.js';
import type { LanguageDisplayProfile } from './language/types.js';

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
  lookupCache?: Map<string, any>,
  profile: LanguageDisplayProfile = getDisplayProfile()
): Promise<ResolvedContent> {
  const tokenInfos = await tokenizer.segment(text);

  // ---- position mapping
  const positioned: PositionedToken[] = [];
  let searchStart = 0;
  for (const t of tokenInfos) {
    const segmentIndex = text.indexOf(t.surface, searchStart);
    if (segmentIndex === -1) continue;
    positioned.push({ ...t, startIndex: segmentIndex, endIndex: segmentIndex + t.surface.length });
    searchStart = segmentIndex + t.surface.length;
  }

  // ---- sentence context: re-join split expressions, then classify each
  // token with what its neighbour says about it (see tokenContext.ts).
  const merged = mergeFixedExpressions(positioned, text);

  interface WorkToken extends ResolvedToken {
    baseForm: string;
    isJapanese: boolean;
    grammarLabel?: string;
    context?: GrammaticalContext;
    dictionaryForm?: string;
    idiom?: { expression: string; gloss: string };
  }
  const tokens: WorkToken[] = [];

  merged.forEach((tok, i) => {
    let t = tok;
    const surface = t.surface;
    // Kana いった after に/へ is 行った "went"; Sudachi's lattice often
    // prefers 言った "said" for the bare kana (公園にいった).
    const prev = merged[i - 1];
    if (/^いっ/.test(surface) && t.baseForm === '言う' && prev && nextTo(text, prev, t) && /^[にへ]$/.test(prev.surface)) {
      t = { ...t, baseForm: '行く', dictionaryForm: '行く' };
    }
    // Script decisions go through the language profile (#258). The grammar
    // guard is still the Japanese table directly — it becomes a profile
    // member when a second language actually exists.
    // An exclamation (あれ～？) is looked up by its kana: normalization maps
    // あれ to the pronoun spelling 彼れ, which hides the interjection entry.
    const interjection = interjectionPos(text, t);
    if (interjection) t = { ...t, pos: interjection, baseForm: surface };
    const isJapanese = surface.trim() !== '' && !profile.script.isPunctuation(surface);
    // POS-aware label first (な after 好き is the copula, not the
    // sentence-final particle); null = a content word here (もの "thing").
    const contextual = getContextualGrammarLabel(surface, t.posDetail);
    // A lone kana echoed by the next word's first kana is a drawn-out
    // sound (「おおいしい」 → お + おいしい), not the honorific prefix.
    const next = merged[i + 1];
    const stretched =
      /^[ぁ-ん]$/.test(surface) && next && next.startIndex === t.endIndex && next.surface.startsWith(surface);
    const grammarLabel = stretched
      ? 'drawn-out sound (おおいしい = おいしい, said with feeling)'
      : !isJapanese || contextual === null
        ? undefined
        : contextual ?? getGrammarDefinition(surface, t.baseForm);
    const isMorpheme = grammarLabel !== undefined;
    // A lone kana interjection (あ, え) is a real word ("ah!"), not a fragment.
    const isVocabWord = isJapanese && !isMorpheme && (t.pos === '感動詞' || !profile.script.isGrammarFragment(surface));

    tokens.push({
      surface,
      baseForm: t.baseForm,
      pos: t.pos,
      reading: t.reading,
      startIndex: t.startIndex,
      endIndex: t.endIndex,
      isVocabWord,
      isMorpheme,
      isJapanese,
      grammarLabel,
      context: grammaticalContext(merged[i - 1], t, text),
      dictionaryForm: t.dictionaryForm,
    });
  });

  // ---- idioms: noun + particle + verb that JMDict lists as one expression
  // (実を結ぶ "to bear fruit", 時間をかける "to spend time"). The verb shows
  // the expression's meaning; the noun takes its reading from the expression
  // (UniDic reads standalone 実 as じつ, but in 実を結ぶ it is み).
  const expressionCache = new Map<string, Promise<{ reading: string; gloss: string } | null>>();
  const expression = (text: string) => {
    if (!expressionCache.has(text)) expressionCache.set(text, wordResolver.expression(text));
    return expressionCache.get(text)!;
  };
  for (let i = 2; i < tokens.length; i++) {
    const [n, p, v] = [tokens[i - 2], tokens[i - 1], tokens[i]];
    if (!v.isVocabWord || (v.pos !== '動詞' && v.pos !== '形容詞')) continue;
    if (!n.isVocabWord || !/^[をがにでとはも]$/.test(p.surface)) continue;
    if (n.endIndex !== p.startIndex || !nextTo(text, p, v)) continue;
    // は/も stand in for を/が in running text (時間もかけて = 時間をかけて).
    const particles = /^[はも]$/.test(p.surface) ? ['を', 'が'] : [p.surface];
    let found = false;
    for (const particle of particles) {
    for (const lemma of new Set([v.baseForm, v.dictionaryForm].filter((f): f is string => !!f))) {
      const exprText = n.surface + particle + lemma;
      const hit = await expression(exprText);
      if (!hit) continue;
      v.idiom = { expression: exprText, gloss: hit.gloss };
      // Split the expression reading at the particle where the verb part
      // starts like the verb token's own reading.
      const vFirst = v.reading?.[0];
      for (let k = hit.reading.indexOf(particle); k > 0; k = hit.reading.indexOf(particle, k + 1)) {
        if (!vFirst || hit.reading[k + 1] === vFirst) {
          if (/[一-鿿々]/.test(n.surface)) n.reading = hit.reading.slice(0, k);
          break;
        }
      }
      found = true;
      break;
    }
    if (found) break;
    }
  }

  // ---- build the unique word list (first-appearance order).
  // Keyed by every resolver input (surface + base form + POS + contextual
  // reading), so a homograph that appears in two contexts (この方 かた vs
  // 右の方 ほう) gets one entry per context instead of every occurrence
  // inheriting the first one's resolution. buildWordsResponse still collapses
  // the vocab list to one entry per surface.
  const keyOf = (t: WorkToken) =>
    [t.surface, t.baseForm, t.pos, t.reading, t.grammarLabel, t.context, t.dictionaryForm, t.idiom?.expression].join('\u0000');
  const wordIndexByKey = new Map<string, number>();
  const argumentOverride = new Map<number, number>(); // token index → word index
  const frequency = new Map<string, number>();
  const uniqueTokens: typeof tokens = [];

  for (const token of tokens) {
    if (!token.isJapanese) continue;
    frequency.set(token.surface, (frequency.get(token.surface) ?? 0) + 1);
    const key = keyOf(token);
    if (wordIndexByKey.has(key)) continue;
    wordIndexByKey.set(key, uniqueTokens.length);
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
            meaning: token.grammarLabel || 'Grammatical morpheme',
            jlpt: 0,
            joyo: false,
            score: 0,
            breakdown: EMPTY_BREAKDOWN,
            isMorpheme: true,
          };
        } else if (token.isVocabWord) {
          const { reading, meaning, meanings, jlpt, joyo, score, breakdown } =
            await wordResolver.resolve(token.surface, token.baseForm, lookupCache, token.pos, token.reading, undefined, {
              after: token.context,
              dictionaryForm: token.dictionaryForm,
              notGrammar: true,
              idiom: token.idiom,
            });
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

  // ---- second pass: a verb whose meaning is a near-tie between homographs
  // ("to wipe — or: to blow (of the wind)") is re-resolved with its
  // subject/object noun's English head words, so 風がふく picks 吹く.
  const STOP = new Set(['the', 'and', 'for', 'with', 'one', 'esp', 'etc', 'something', 'someone', 'thing']);
  for (let i = 2; i < tokens.length; i++) {
    const [n, p, v] = [tokens[i - 2], tokens[i - 1], tokens[i]];
    const vi = v.wordIndex ?? wordIndexByKey.get(keyOf(v));
    const ni = wordIndexByKey.get(keyOf(n));
    if (vi === undefined || ni === undefined || v.pos !== '動詞' || v.idiom) continue;
    // 風が、ふきました: a comma may separate the subject from its verb.
    const gap = text.slice(p.endIndex, v.startIndex);
    if (!/^[がを]$/.test(p.surface) || n.endIndex !== p.startIndex || !/^[ \u3000、,]*$/.test(gap)) continue;
    const vWord = words[vi];
    if (!vWord?.meaning?.includes(' — or: ')) continue;
    const head = String(words[ni]?.meaning ?? '').split(/[;,(—]/)[0];
    const argumentWords = (head.toLowerCase().match(/[a-z]{3,}/g) ?? []).filter((w) => !STOP.has(w));
    if (argumentWords.length === 0) continue;
    const r = await wordResolver.resolve(v.surface, v.baseForm, lookupCache, v.pos, v.reading, undefined, {
      after: v.context,
      dictionaryForm: v.dictionaryForm,
      notGrammar: true,
      argumentWords,
    });
    if (r.meaning !== vWord.meaning) {
      // This context gets its own word entry so other occurrences keep theirs.
      const info: any = { ...vWord, reading: r.reading, meaning: r.meaning };
      if (r.meanings) info.meanings = r.meanings;
      words.push(info);
      argumentOverride.set(i, words.length - 1);
    }
  }

  // frequencies (per surface, matching the extraction paths' counts)
  for (const w of words) {
    if (!w.isMorpheme || frequency.has(w.word)) {
      w.frequencyInContent = frequency.get(w.word) ?? 1;
    }
  }

  return {
    formatVersion: RESOLVED_FORMAT_VERSION,
    words,
    tokens: tokens.map((t, idx) => {
      const { baseForm, isJapanese, isVocabWord, isMorpheme, grammarLabel, context, dictionaryForm, idiom, ...rest } = t;
      return {
        ...rest,
        // For the client, isVocabWord doubles as "hoverable": every Japanese
        // token with word info is clickable in the reader.
        isVocabWord: isJapanese,
        isMorpheme,
        wordIndex: isJapanese ? argumentOverride.get(idx) ?? wordIndexByKey.get(keyOf(t)) : undefined,
      };
    }),
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
  // One vocab entry per surface (first context wins); the per-context
  // variants only matter to the reader's token popups.
  const seen = new Set<string>();
  return resolved.words.filter((w) => {
    if (w.isMorpheme && w.meaning === 'Kana particle / expression') return false;
    if (seen.has(w.word)) return false;
    seen.add(w.word);
    return true;
  });
}
