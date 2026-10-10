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
import { getMorphemeDefinition } from './morphemeDefinitions.js';
import { getWordScoreBreakdown } from './scoring.js';
import { atClauseStart, counterReading, numberValue, mergeFixedExpressions, mergeDictionaryWords, markParenthesizedReadings, markGlossaryTerms, formalNounMeaning, grammaticalContext, interjectionPos, nextTo, type PositionedToken, type GrammaticalContext } from './tokenContext.js';
import { getDisplayProfile } from './language/registry.js';
import type { LanguageDisplayProfile } from './language/types.js';
import { chooseSense, type ContextModel, type ContextSentenceIn } from './contextModel.js';
import { splitSentences } from './sentenceSplitter.js';
import { namesInTranslations, nameKatakanaRuns, kanaNameIn } from './nameFromTranslation.js';

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
  /** Sentence translations (only when resolved with a ContextModel). */
  sentences?: { start: number; end: number; translation: string | null }[];
}

const EMPTY_BREAKDOWN = {
  jlptScore: 0, joyoPenalty: 0, highestGrade: null,
  freqPenalty: 0, jlptValues: [], gradeValues: [], priorities: [],
};

/**
 * Furigana in parentheses after kanji (行（い）きました, 猫（ねこ）が): the text
 * without it, and for each stripped index its index in the original (one
 * extra entry for the end). Null when there is none. A parenthesised kana
 * run counts as furigana when it could be a reading of the kanji before it
 * (at most 5 kana per kanji).
 */
export function stripFurigana(text: string): { stripped: string; map: number[] } | null {
  const re = /([一-鿿々ヶ〆]+)[（(]([ぁ-ゖ]+)[）)]/g;
  const cuts: [number, number][] = [];
  for (let m; (m = re.exec(text)); ) {
    if (m[2].length > m[1].length * 5) continue;
    const open = m.index + m[1].length;
    cuts.push([open, open + m[2].length + 2]);
  }
  if (cuts.length === 0) return null;
  let stripped = '';
  const map: number[] = [];
  let k = 0;
  for (let i = 0; i < text.length; i++) {
    if (k < cuts.length && i === cuts[k][0]) {
      i = cuts[k][1] - 1;
      k++;
      continue;
    }
    stripped += text[i];
    map.push(i);
  }
  map.push(text.length);
  return { stripped, map };
}

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
  profile: LanguageDisplayProfile = getDisplayProfile(),
  context?: ContextModel
): Promise<ResolvedContent> {
  // Furigana written into the text (行（い）きました, 猫（ねこ）が): resolve the
  // text without it, then map positions back. Graded on 100 random corpus
  // items, 70 of which carry furigana: 行 alone read as the name "Kō" and
  // きました as "came".
  const ruby = stripFurigana(text);
  if (ruby) {
    const r = await resolveContent(ruby.stripped, tokenizer, wordResolver, lookupCache, profile, context);
    const start = (i: number) => ruby.map[i];
    const end = (i: number) => (i > 0 ? ruby.map[i - 1] + 1 : 0);
    return {
      ...r,
      ...(r.sentences ? { sentences: r.sentences.map((x) => ({ ...x, start: start(x.start), end: end(x.end) })) } : {}),
      tokens: r.tokens.map((t) => {
        const startIndex = start(t.startIndex);
        const endIndex = end(t.endIndex);
        return { ...t, startIndex, endIndex, surface: text.slice(startIndex, endIndex) };
      }),
    };
  }
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
  let merged = await mergeDictionaryWords(
    mergeFixedExpressions(markGlossaryTerms(markParenthesizedReadings(positioned, text), text), text),
    text,
    (s) => wordResolver.hasForm(s),
    (s) => wordResolver.isKanaHeadword(s),
    (s) => getMorphemeDefinition(s) !== undefined,
    (s) => wordResolver.isConjunctionOnly(s),
    (s) => wordResolver.headwordPos(s),
    (s) => wordResolver.commonKanaWord(s)
  );

  // Katakana names the translation spells as English names (ゾル|タン →
  // "Zoltan", レッド "Red" not "red"): one proper-noun token each.
  if (context?.translate) {
    const spans = splitSentences(text);
    const translations = await context.translate(spans.map((s) => text.slice(s.start, s.end)));
    const names = namesInTranslations(translations);
    if (names.length > 0) merged = nameKatakanaRuns(merged, names);
    // Hiragana names: the translation keeps a name romanized (ゆき → "Yuki")
    // where it translates the word ("snow"). One confirmed occurrence names
    // every occurrence. A hiragana word Sudachi tagged as a name that the
    // translation does NOT spell, and that is a common word, is the word
    // (げんき "healthy", not "Genki").
    const translationAt = (t: PositionedToken) => translations[spans.findIndex((s) => t.startIndex >= s.start && t.startIndex < s.end)];
    const HONORIFIC = /^(さん|ちゃん|くん|君|様|さま)$/;
    const confirmed = new Map<string, string>();
    merged.forEach((t, k) => {
      if (t.posDetail?.[0] !== '名詞' || t.fixed) return;
      const tagged = t.posDetail?.[1] === '固有名詞' || HONORIFIC.test(merged[k + 1]?.surface ?? '');
      const name = kanaNameIn(t.surface, translationAt(t), tagged);
      if (name && !confirmed.has(t.surface)) confirmed.set(t.surface, name);
    });
    const renamed: PositionedToken[] = [];
    for (let k = 0; k < merged.length; k++) {
      const t = merged[k];
      const name = t.posDetail?.[0] === '名詞' && !t.fixed ? confirmed.get(t.surface) : undefined;
      if (name) {
        renamed.push({ ...t, posDetail: ['名詞', '固有名詞', '人名', '一般'], fixed: { meaning: `${name} (name)`, reading: t.surface } });
      } else if (
        t.posDetail?.[1] === '固有名詞' && /^[ぁ-ゖー]+$/.test(t.surface) && translationAt(t) &&
        !HONORIFIC.test(merged[k + 1]?.surface ?? '') && (await wordResolver.commonKanaWord(t.surface)).size > 0
      ) {
        renamed.push({ ...t, posDetail: ['名詞', '普通名詞', '一般'] });
      } else {
        renamed.push(t);
      }
    }
    merged = renamed;
  }

  interface WorkToken extends ResolvedToken {
    baseForm: string;
    isJapanese: boolean;
    grammarLabel?: string;
    fixed?: { meaning: string; reading?: string };
    context?: GrammaticalContext;
    dictionaryForm?: string;
    idiom?: { expression: string; gloss: string };
    posDetail?: string[];
    /** Sound-changed counter reading (20分 → ぷん), kept over the resolver's. */
    counterReading?: string;
    /** The token is a whole utterance (「ただいま！」): set phrases apply. */
    utterance?: boolean;
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
    // Sudachi tags で/が after a Latin-script name or a parenthesised reading
    // (DJIで, NHKが, 影法師（かげぼうし）が) as the sentence-opening
    // conjunction; mid-clause it is the particle.
    if ((surface === 'で' || surface === 'が') && t.posDetail?.[0] === '接続詞' && !atClauseStart(text, t.startIndex)) {
      t = { ...t, pos: '助詞', posDetail: ['助詞', '格助詞'] };
    }
    // Counter reading after a number: 20分 じゅっぷん, 3本 さんぼん.
    if (prev && prev.posDetail?.[1] === '数詞' && prev.endIndex === t.startIndex) {
      const r = counterReading(numberValue(prev.surface), surface);
      if (r) t = { ...t, reading: r, counterReading: r };
    }
    // Noun + 共: the plural suffix ども (猿共 "the monkeys", 狼共), which
    // UniDic reads とも "together with".
    if (surface === '共' && prev && prev.endIndex === t.startIndex && prev.posDetail?.[0] === '名詞' && prev.posDetail?.[1] !== '数詞') {
      t = { ...t, reading: 'ども', fixed: { meaning: 'plural suffix (often humble or scornful: 猿共 "the monkeys")', reading: 'ども' } };
    }
    // 都 on its own is みやこ "the capital" (都へ上る); UniDic reads と as
    // in 東京都, which only applies right after a place name.
    if (surface === '都' && t.reading === 'と' && !(prev && prev.endIndex === t.startIndex && prev.posDetail?.[2] === '地名')) {
      t = { ...t, reading: 'みやこ' };
    }
    // NにVなれる: the potential of なる "can become", not 慣れる.
    if (/^なれ/.test(surface) && /^(慣れる|なれる|成れる)$/.test(t.baseForm) && prev && prev.endIndex === t.startIndex && /^[にと]$/.test(prev.surface)) {
      t = { ...t, baseForm: '成る', fixed: { meaning: 'can become (potential of なる)', reading: surface } };
    }
    // 何 before を/が/も is なに (何をしている), which UniDic reads なん.
    if (surface === '何' && t.reading === 'なん' && /^[をがも]/.test(text.slice(t.endIndex, t.endIndex + 1))) {
      t = { ...t, reading: 'なに' };
    }
    // AといったB "B such as A": kana いった is 言う, not 結う "do up hair".
    if (surface === 'いった' && prev?.surface === 'と' && prev.endIndex === t.startIndex && merged[i + 1]?.posDetail?.[0] === '名詞') {
      t = { ...t, baseForm: '言う', fixed: { meaning: 'such as, like (AといったB "B such as A")', reading: 'いった' } };
    }
    // もの right after an amount is emphatic も + の: 88.5㎜もの大雨
    // "as much as 88.5 mm of rain".
    if (surface === 'もの' && prev && prev.endIndex === t.startIndex &&
      (prev.posDetail?.[1] === '数詞' || prev.posDetail?.includes('助数詞') || /[0-9０-９㎜㎝㎞㎏㎡℃%％]$/.test(prev.surface))) {
      t = { ...t, fixed: { meaning: 'as many as, as much as (emphasis after an amount: 10人もの "as many as ten people")' } };
    }
    // POS-aware label first (な after 好き is the copula, not the
    // sentence-final particle); null = a content word here (もの "thing").
    let contextual = getContextualGrammarLabel(surface, t.posDetail, t.baseForm);
    // Sudachi tags の before a space or line break as sentence-final (れんの
    // てを in spaced kids' text); only a real sentence end makes it one.
    if (surface === 'の' && t.posDetail?.[1] === '終助詞' && !/^[。！？!?」』…〜～]?$/.test(text.slice(t.endIndex, t.endIndex + 1))) {
      contextual = getContextualGrammarLabel(surface, ['助詞', '格助詞'], t.baseForm);
    }
    // Name + め: the derogatory suffix (彦一め "that rascal Hikoichi"),
    // not -ish (早め).
    if (surface === 'め' && t.posDetail?.[0] === '接尾辞' && (prev?.posDetail?.[2] === '人名' || prev?.posDetail?.[0] === '代名詞')) {
      contextual = 'derogatory suffix after a name or pronoun (彦一め "that rascal Hikoichi")';
    }
    // Volitional + と + する: "try to" (しようとする, 救おうとした).
    if (surface === 'と' && (/^(う|よう)$/.test(prev?.surface ?? '') || prev?.posDetail?.some((p) => p.startsWith('意志推量形'))) && merged[i + 1]?.baseForm === '為る') {
      contextual = 'trying to / about to (〜ようとする "try to do")';
    }
    // UniDic reads standalone 他 as た; ほか is the everyday reading except
    // in その他 (そのた).
    if (surface === '他' && t.reading === 'た' && merged[i - 1]?.surface !== 'その') {
      t = { ...t, reading: 'ほか' };
    }
    // 後 opening a parenthetical in encyclopedic text ((後の東京都…),
    // （後に…）) is のち "later", which UniDic reads あと "behind".
    if ((surface === '後' || surface === '後に') && /[（(、]$/.test(text.slice(0, t.startIndex))) {
      t = { ...t, reading: surface === '後' ? 'のち' : 'のちに', pos: surface === '後' ? '名詞' : '副詞' };
    }
    // An adverb-capable noun (副詞可能) that modifies a predicate instead of
    // taking a particle is an adverb: いつも食う "always", 挙句に… — the
    // noun-only POS filter would show いつも "usual".
    const following = merged[i + 1];
    if (
      t.posDetail?.[0] === '名詞' && t.posDetail?.[2] === '副詞可能' &&
      following && !['助詞', '助動詞'].includes(following.posDetail?.[0] ?? following.pos ?? '') &&
      following.surface !== 'の'
    ) {
      t = { ...t, pos: '副詞' };
    }
    // Formal nouns after a modifier are grammar (補助金のため "because of").
    const formal = formalNounMeaning(merged[i - 1], t, text);
    if (formal) t = { ...t, fixed: { meaning: formal } };
    // A lone kana echoed by the next word's first kana is a drawn-out
    // sound (「おおいしい」 → お + おいしい), not the honorific prefix.
    const next = merged[i + 1];
    // Vowels only, never a particle: は before はがき is the topic marker.
    const stretched =
      /^[あいうえお]$/.test(surface) && t.pos !== '助詞' && next && next.startIndex === t.endIndex && next.surface.startsWith(surface);
    const grammarLabel = t.fixed
      ? undefined
      : stretched
      ? 'drawn-out sound (おおいしい = おいしい, said with feeling)'
      : !isJapanese || contextual === null
        ? undefined
        : contextual ?? getGrammarDefinition(surface, t.baseForm);
    const isMorpheme = grammarLabel !== undefined;
    // A lone kana interjection (あ, え) is a real word ("ah!"), not a fragment.
    const isVocabWord =
      isJapanese && !isMorpheme && (!!t.fixed || t.pos === '感動詞' || !profile.script.isGrammarFragment(surface));

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
      context: (() => {
        const c = grammaticalContext(merged[i - 1], t, text);
        // "after the plain/past form of a verb" senses (ところ "about to",
        // "just did") are the construction 〜ところだ; without the copula
        // after it, ところ is the plain noun ("place, point").
        if ((c === 'verb-plain' || c === 'verb-past') && !/^(だ|です|でし|だっ|である)/.test(merged[i + 1]?.surface ?? '')) return undefined;
        return c;
      })(),
      dictionaryForm: t.dictionaryForm,
      posDetail: t.posDetail,
      fixed: t.fixed,
      counterReading: t.counterReading,
      utterance: (() => {
        // Only a kana noun reads differently on its own (ただいま, ごめん);
        // other tokens keep one word entry wherever they stand.
        if (t.posDetail?.[0] !== '名詞' || !/^[ぁ-んー]+$/.test(surface) || !atClauseStart(text, t.startIndex)) return false;
        // Sentence-final particles may follow (ごめんね。).
        let j = i + 1;
        let end = t.endIndex;
        while (merged[j] && merged[j].startIndex === end && merged[j].posDetail?.[1] === '終助詞') end = merged[j++].endIndex;
        return /^[ 　]*([。！？!?」』\n～〜ー…]|$)/.test(text.slice(end));

      })(),
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
    [t.surface, t.baseForm, t.pos, t.reading, t.grammarLabel, t.context, t.dictionaryForm, t.idiom?.expression, t.fixed?.meaning, t.utterance ? 'U' : ''].join('\u0000');
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
        if (token.fixed) {
          const { jlpt, joyo, score, breakdown } = getWordScoreBreakdown(token.surface, null);
          words[i] = {
            word: token.surface,
            reading: token.fixed.reading ?? token.reading ?? token.surface,
            meaning: token.fixed.meaning,
            jlpt, joyo, score, breakdown,
          };
        } else if (token.isMorpheme) {
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
          const { reading, meaning, meanings, senseSizes, jlpt, joyo, score, breakdown } =
            await wordResolver.resolve(token.surface, token.baseForm, lookupCache, token.pos, token.reading, undefined, {
              after: token.context,
              dictionaryForm: token.dictionaryForm,
              notGrammar: true,
              idiom: token.idiom,
              commonNoun: token.posDetail?.[0] === '名詞' && token.posDetail?.[1] === '普通名詞',
              properNoun: token.posDetail?.[1] === '固有名詞',
              placeName: token.posDetail?.[1] === '固有名詞' && token.posDetail?.[2] === '地名',
              nameType: token.posDetail?.[1] === '固有名詞' && ['人名', '地名', '組織'].includes(token.posDetail?.[2] ?? ''),
              utterance: token.utterance,
            });
          const info: any = { word: token.surface, reading: token.counterReading ?? reading, meaning, jlpt, joyo, score, breakdown };
          if (meanings) info.meanings = meanings;
          if (meanings && senseSizes) info.senseSizes = senseSizes;
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
    // Every verb with an object/subject is re-checked: the argument can pick
    // the entry (near-tied homographs) or the sense (結ぶ "to conclude (a
    // contract)"); only a changed meaning gets its own word entry.
    if (!vWord?.meaning) continue;
    const head = String(words[ni]?.meaning ?? '').split(/[;,(—]/)[0];
    const argumentWords = (head.toLowerCase().match(/[a-z]{4,}/g) ?? []).filter((w) => !STOP.has(w));
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

  // ---- translation context (optional): translate each sentence and let a
  // content word switch to another sense of the SAME dictionary entry when
  // the translation clearly favours it (see contextModel.ts for the
  // measured margin). The switched occurrence gets its own word entry.
  let sentences: ResolvedContent['sentences'];
  if (context) {
    const spans = splitSentences(text);
    const senseGroups = (w: any): string[][] | null => {
      const sizes: number[] | undefined = w?.senseSizes;
      if (!sizes || sizes.length < 2 || !Array.isArray(w.meanings)) return null;
      const groups: string[][] = [];
      let o = 0;
      for (const n of sizes) {
        groups.push(w.meanings.slice(o, o + n));
        o += n;
      }
      // Only when the headline still shows sense 1 (not an idiom, a
      // composed meaning or a fixed label that replaced it).
      return String(w.meaning ?? '').startsWith(groups[0][0]) ? groups : null;
    };
    const CONTENT_POS = new Set(['名詞', '動詞', '形容詞', '形状詞']);
    const tokenWord = (idx: number) => argumentOverride.get(idx) ?? wordIndexByKey.get(keyOf(tokens[idx]));
    const asked: { idx: number; groups: string[][] }[][] = [];
    const request: ContextSentenceIn[] = spans.map((s) => {
      const mine: { idx: number; groups: string[][] }[] = [];
      tokens.forEach((t, idx) => {
        if (t.startIndex < s.start || t.startIndex >= s.end || !t.isVocabWord || t.isMorpheme || t.fixed || t.idiom) return;
        // Sudachi POS only: merged expressions (no POS), pronouns and
        // proper nouns keep their dictionary sense.
        if (!CONTENT_POS.has(t.posDetail?.[0] ?? '') || t.posDetail?.[1] === '固有名詞') return;
        // Graded on 100 random corpus items (91 better / 44 worse): kana-only
        // spellings (かぜ "wind" → "cold", いい → "profitable"), dependent
        // helper verbs (〜ておく, 〜きれる), numerals and counter-type nouns
        // (一 "beginning", 日 in 土よう日) switched to wrong senses; keep them.
        if (!/[一-鿿々]/.test(t.surface) || ['非自立可能', '数詞'].includes(t.posDetail?.[1] ?? '') || t.posDetail?.[2] === '助数詞可能') return;
        const wi = tokenWord(idx);
        const groups = wi === undefined ? null : senseGroups(words[wi]);
        if (groups) mine.push({ idx, groups });
      });
      asked.push(mine);
      return {
        text: text.slice(s.start, s.end),
        candidates: mine.map(({ idx, groups }) => ({
          start: tokens[idx].startIndex - s.start,
          end: tokens[idx].endIndex - s.start,
          senses: groups,
        })),
      };
    });
    const answers = await context.enrich(request);
    sentences = spans.map((s, i) => ({ start: s.start, end: s.end, translation: answers[i]?.translation ?? null }));
    const switched = new Map<string, number>(); // `${wordIndex}:${sense}` → new word index
    asked.forEach((mine, si) => {
      mine.forEach(({ idx, groups }, ci) => {
        const answer = answers[si]?.candidates[ci];
        const sense = chooseSense(answer?.sims ?? [], answer?.aligned ?? [], groups);
        if (sense === 0 || sense >= groups.length) return;
        const base = tokenWord(idx)!;
        const key = `${base}:${sense}`;
        if (!switched.has(key)) {
          const w = words[base];
          const order = [groups[sense], ...groups.filter((_, k) => k !== sense)];
          words.push({
            ...w,
            meaning: `${groups[sense].slice(0, 2).join(', ')} (also: ${groups[0][0]})`,
            meanings: order.flat(),
            senseSizes: order.map((g) => g.length),
            contextSense: sense,
          });
          switched.set(key, words.length - 1);
        }
        argumentOverride.set(idx, switched.get(key)!);
      });
    });
  }

  // frequencies (per surface, matching the extraction paths' counts)
  for (const w of words) {
    if (!w.isMorpheme || frequency.has(w.word)) {
      w.frequencyInContent = frequency.get(w.word) ?? 1;
    }
  }

  return {
    formatVersion: RESOLVED_FORMAT_VERSION,
    ...(sentences ? { sentences } : {}),
    words,
    tokens: tokens.map((t, idx) => {
      const { baseForm, isJapanese, isVocabWord, isMorpheme, grammarLabel, context, dictionaryForm, idiom, posDetail, fixed, utterance, ...rest } = t;
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
  // One vocab row per (word, meaning) the text actually uses: 方 "person"
  // and 方 "direction" are two rows, while one meaning resolved in several
  // contexts is one row. Each row counts the tokens showing that meaning.
  const tokensPerWord = new Map<number, number>();
  for (const t of resolved.tokens) {
    if (t.wordIndex !== undefined) tokensPerWord.set(t.wordIndex, (tokensPerWord.get(t.wordIndex) ?? 0) + 1);
  }
  const rows = new Map<string, any>();
  resolved.words.forEach((w, i) => {
    if (w.isMorpheme && w.meaning === 'Kana particle / expression') return;
    // Grammar morphemes are one row (their label variants describe one
    // particle, not separate words to study); content words compare on the
    // headline gloss, ignoring the "(also: …)" / "— or: …" tails.
    const headline = String(w.meaning ?? '').split(/ \(also: | — or: /)[0];
    const key = w.isMorpheme ? w.word : `${w.word}\u0000${headline}`;
    const n = tokensPerWord.get(i) ?? 0;
    // An entry no token shows (its token was re-resolved by the argument
    // pass) is not a meaning the text uses.
    if (n === 0 && tokensPerWord.size > 0) return;
    const row = rows.get(key);
    if (row) row.frequencyInContent += n;
    else rows.set(key, { ...w, frequencyInContent: n || (w.frequencyInContent ?? 1) });
  });
  return [...rows.values()];
}
