/**
 * Sentence-context post-processing for positioned Sudachi tokens, used by
 * contentResolver before dictionary resolution:
 *
 *   - mergeFixedExpressions: re-joins expressions Sudachi splits into pieces
 *     whose separate glosses mislead (の+で → ので "because", いつ+か →
 *     いつか "someday", 五+月 → 五月 "May") and curated multi-token
 *     headwords from the supplementary dictionary (花+すけ → 花すけ, a name).
 *   - grammaticalContext: what the PREVIOUS token tells us about this one
 *     ("after the -te form", "after the -masu stem", …), matched later
 *     against JMDict's per-sense `info` notes (下さい after a te-form is
 *     "please do for me"; 過ぎる after an adjective stem is "too much").
 *
 * Judge changes here with scripts/inspect-text.ts, not unit tests: the
 * point is which meaning a reader sees, which is a judgement call.
 */

import type { TokenInfo } from './tokenizers.js';
import { getSupplementaryEntry } from '../data/supplementaryDictionary.js';

export interface PositionedToken extends TokenInfo {
  startIndex: number;
  endIndex: number;
}

export type GrammaticalContext = 'te' | 'masu' | 'adj-stem' | 'verb-plain' | 'verb-past';

const QUESTION_WORDS = new Set(['いつ', 'どう', '何', 'なに', 'なん', '誰', 'だれ', 'どこ', 'どれ', 'どちら']);

/** True when `text` before `index` is a sentence/line start. */
function atSentenceStart(text: string, index: number): boolean {
  const before = text.slice(0, index).replace(/[ 　\t]+$/, '');
  return before === '' || /[\n。！？!?」』「『（(]$/.test(before);
}

interface MergeRule {
  /** Number of tokens the rule consumes. */
  length: number;
  match: (toks: PositionedToken[], text: string) => boolean;
  /** POS for the merged token (drives lookup hints). */
  pos: string;
  /** Dictionary lookup key for the merged surface, when it differs. */
  key?: (surface: string) => string;
}

const pos0 = (t: PositionedToken) => t.posDetail?.[0] ?? t.pos;
const pos1 = (t: PositionedToken) => t.posDetail?.[1];

const MERGE_RULES: MergeRule[] = [
  // ので "because": UniDic splits it into nominalizer の + copula で.
  {
    length: 2,
    match: ([a, b]) => a.surface === 'の' && pos1(a) === '準体助詞' && b.surface === 'で' && pos0(b) === '助動詞',
    pos: '助詞',
  },
  // しょうがない / しようがない "it can't be helped"
  {
    length: 3,
    match: ([a, b, c]) =>
      (a.surface === 'しょう' || a.surface === 'しよう') && b.surface === 'が' && /^(ない|なかっ|なく)/.test(c.surface),
    pos: '形容詞',
  },
  // Question word + か → indefinite (いつか someday, 何か something, どうか please/somehow)
  {
    length: 2,
    match: ([a, b]) => QUESTION_WORDS.has(a.surface) && b.surface === 'か' && pos1(b) === '副助詞',
    pos: '副詞',
  },
  // ところで at the start of a sentence is the conjunction "by the way".
  {
    length: 2,
    match: ([a, b], text) => a.surface === 'ところ' && b.surface === 'で' && atSentenceStart(text, a.startIndex),
    pos: '接続詞',
  },
  // お先に "ahead; before (you)" (お先に失礼します)
  {
    length: 3,
    match: ([a, b, c]) => a.surface === 'お' && b.surface === '先' && c.surface === 'に',
    pos: '副詞',
  },
  // 今や "now (in contrast to the past)"
  {
    length: 2,
    match: ([a, b]) => a.surface === '今' && b.surface === 'や',
    pos: '副詞',
  },
  // Month names: 五+月 → 五月 "May" (the bare 月 is otherwise "moon").
  {
    length: 2,
    match: ([a, b]) => pos1(a) === '数詞' && b.surface === '月',
    pos: '名詞',
    // JMDict writes months with full-width digits (２月) or kanji, never 2月.
    key: (s) => s.replace(/[0-9]/g, (d) => String.fromCharCode(d.charCodeAt(0) + 0xfee0)),
  },
];

function join(toks: PositionedToken[], pos: string): PositionedToken {
  const surface = toks.map((t) => t.surface).join('');
  const readings = toks.map((t) => t.reading);
  const last = toks[toks.length - 1];
  return {
    surface,
    baseForm: surface,
    pos,
    reading: readings.every((r) => r) ? readings.join('') : undefined,
    posDetail: [pos],
    dictionaryForm: surface,
    tail: last.tail,
    startIndex: toks[0].startIndex,
    endIndex: last.endIndex,
  };
}

/** True when only spaces (beginner texts space out phrases) separate a and b. */
export function nextTo(text: string, a: { endIndex: number }, b: { startIndex: number }): boolean {
  return a.endIndex <= b.startIndex && /^[ \u3000]*$/.test(text.slice(a.endIndex, b.startIndex));
}

const adjacent = (toks: PositionedToken[]) =>
  toks.every((t, i) => i === 0 || toks[i - 1].endIndex === t.startIndex);

/** Re-join split fixed expressions and curated multi-token headwords. */
export function mergeFixedExpressions(input: PositionedToken[], text: string): PositionedToken[] {
  // Sudachi splits multi-digit numbers digit by digit (12 → 1|2); join runs
  // of number tokens first so 12月 becomes one month, not 1 + 2月.
  const tokens: PositionedToken[] = [];
  for (const t of input) {
    const prev = tokens[tokens.length - 1];
    if (prev && pos1(prev) === '数詞' && pos1(t) === '数詞' && prev.endIndex === t.startIndex && /^[0-9０-９]+$/.test(prev.surface + t.surface)) {
      // Per-digit readings don't concatenate (1+2 is not じゅうに).
      tokens[tokens.length - 1] = { ...join([prev, t], prev.pos ?? '名詞'), posDetail: prev.posDetail, reading: undefined };
    } else {
      tokens.push(t);
    }
  }
  const out: PositionedToken[] = [];
  let i = 0;
  outer: while (i < tokens.length) {
    // Curated headwords spanning 2-4 tokens (names Sudachi doesn't know).
    for (let n = 4; n >= 2; n--) {
      const span = tokens.slice(i, i + n);
      if (span.length < n || !adjacent(span)) continue;
      const surface = span.map((t) => t.surface).join('');
      if (getSupplementaryEntry(surface)) {
        // The curated reading beats per-piece readings (てっ辺 is てっぺん).
        out.push({ ...join(span, '名詞'), reading: undefined });
        i += n;
        continue outer;
      }
    }
    for (const rule of MERGE_RULES) {
      const span = tokens.slice(i, i + rule.length);
      if (span.length === rule.length && adjacent(span) && rule.match(span, text)) {
        const joined = join(span, rule.pos);
        if (rule.key) {
          joined.baseForm = rule.key(joined.surface);
          joined.reading = undefined; // the dictionary entry's reading (じゅうにがつ)
        }
        out.push(joined);
        i += rule.length;
        continue outer;
      }
    }
    out.push(tokens[i]);
    i++;
  }
  return out;
}

/**
 * POS override for an exclamation: a kana word that opens a sentence and is
 * stretched or punctuated straight away (あれ～？, あら！) is an interjection,
 * not the pronoun Sudachi tags it as.
 */
export function interjectionPos(text: string, t: PositionedToken): string | undefined {
  if (!/^[ぁ-ん]+$/.test(t.surface) || !atSentenceStart(text, t.startIndex)) return undefined;
  return /^[～〜ー？！?!]/.test(text.slice(t.endIndex)) ? '感動詞' : undefined;
}

/** Grammatical context the previous (adjacent) token gives this one. */
export function grammaticalContext(
  prev: PositionedToken | undefined,
  cur: PositionedToken,
  text: string
): GrammaticalContext | undefined {
  if (!prev || !nextTo(text, prev, cur) || !prev.tail) return undefined;
  const { surface, pos, conj } = prev.tail;
  if ((surface === 'て' || surface === 'で') && (pos === '助詞' || prev.pos === '動詞')) return 'te';
  if (pos === '動詞' && conj.startsWith('連用形')) return 'masu';
  if ((pos === '形容詞' && conj.includes('語幹')) || (pos === '形状詞' && prev.pos === '形状詞')) return 'adj-stem';
  if (pos === '助動詞' && surface === 'た') return 'verb-past';
  if (pos === '動詞' && /^(終止形|連体形)/.test(conj)) return 'verb-plain';
  return undefined;
}
