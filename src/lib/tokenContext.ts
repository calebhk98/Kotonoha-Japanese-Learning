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
  /** Meaning decided here (dates, readings in parentheses); skips lookup. */
  fixed?: { meaning: string; reading?: string };
  /** Sound-changed counter reading (20分 → ぷん), kept over the resolver's. */
  counterReading?: string;
}

const KANJI_DIGIT: Record<string, number> = { 〇: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };

/** Value of a number written in Arabic or kanji digits (up to 9999); NaN otherwise. */
export function numberValue(s: string): number {
  const ascii = s.replace(/[０-９]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 0xfee0));
  if (/^[0-9]+$/.test(ascii)) return Number(ascii);
  if (!/^[〇一二三四五六七八九十百千]+$/.test(s)) return NaN;
  let total = 0;
  let cur = 0;
  for (const ch of s) {
    if (ch in KANJI_DIGIT) cur = cur * 10 + KANJI_DIGIT[ch];
    else {
      const unit = ch === '十' ? 10 : ch === '百' ? 100 : 1000;
      total += (cur || 1) * unit;
      cur = 0;
    }
  }
  return total + cur;
}

const ONES = ['', 'いち', 'に', 'さん', 'よん', 'ご', 'ろく', 'なな', 'はち', 'きゅう'];
function numberReading(n: number): string {
  if (n >= 10 && n < 100) {
    const tens = Math.floor(n / 10);
    return (tens > 1 ? ONES[tens] : '') + 'じゅう' + ONES[n % 10];
  }
  return ONES[n] ?? String(n);
}

const DAY_SPECIAL: Record<number, string> = {
  1: 'ついたち', 2: 'ふつか', 3: 'みっか', 4: 'よっか', 5: 'いつか', 6: 'むいか', 7: 'なのか',
  8: 'ようか', 9: 'ここのか', 10: 'とおか', 14: 'じゅうよっか', 20: 'はつか', 24: 'にじゅうよっか',
};

/** Reading of N日: the irregular day forms, else <number>にち (17 じゅうしちにち, 19 じゅうくにち). */
/**
 * Counter reading after a number (20分 にじゅっぷん, 3本 さんぼん): the
 * counter's first kana changes with the number's last digit.
 */
export function counterReading(n: number, counter: string): string | undefined {
  const forms: Record<string, [string, string, string]> = {
    // [after 1/6/8/10 (っ+p), after 3 (voiced), otherwise]
    分: ['ぷん', 'ぷん', 'ふん'],
    本: ['ぽん', 'ぼん', 'ほん'],
    匹: ['ぴき', 'びき', 'ひき'],
    杯: ['ぱい', 'ばい', 'はい'],
  };
  const f = forms[counter];
  if (!f || !Number.isInteger(n) || n <= 0) return undefined;
  if (n % 1000 === 0) return f[1];
  const d = n % 10;
  if (counter === '分' && d === 4) return f[0];
  return d === 1 || d === 6 || d === 8 || d === 0 ? f[0] : d === 3 ? f[1] : f[2];
}

export function dayReading(n: number): string | undefined {
  if (!(n >= 1 && n <= 31)) return undefined;
  if (DAY_SPECIAL[n]) return DAY_SPECIAL[n];
  const ones = n % 10;
  const tens = Math.floor(n / 10);
  const onesR = ones === 7 ? 'しち' : ones === 9 ? 'く' : ones === 4 ? 'よ' : ONES[ones];
  return (tens > 1 ? ONES[tens] : '') + (tens > 0 ? 'じゅう' : '') + onesR + 'にち';
}

const MONTH_READING = ['', 'いち', 'に', 'さん', 'し', 'ご', 'ろく', 'しち', 'はち', 'く', 'じゅう', 'じゅういち', 'じゅうに'];

export type GrammaticalContext = 'te' | 'masu' | 'adj-stem' | 'verb-plain' | 'verb-past' | 'noun';

const QUESTION_WORDS = new Set(['いつ', 'どう', '何', 'なに', 'なん', '誰', 'だれ', 'どこ', 'どれ', 'どちら']);

/** Sentence start, or right after a comma / opening bracket. */
export function atClauseStart(text: string, index: number): boolean {
  return atSentenceStart(text, index) || /[、，,]\s*$/.test(text.slice(0, index));
}

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
  /** Meaning decided here (colloquial forms JMDict files elsewhere). */
  fixed?: string;
  /** Reading decided here (何か is なにか, not UniDic's なん+か). */
  reading?: string;
}

/**
 * Set phrases Sudachi splits into several tokens, matched on the joined
 * surface of 2-5 adjacent tokens (conjugated endings included) and looked
 * up under their JMDict headword.
 */
const SET_PHRASES: { re: RegExp; key: string; pos: string }[] = [
  // よろしく|お|願い|します "please treat me well / nice to meet you"
  { re: /^よろしくお(願い|ねがい)(します|いたします|致します|しました)$/, key: 'よろしくお願いします', pos: '感動詞' },
  // か|も|しれません "may, might"
  { re: /^かもしれ(ない|ません|なかった|ませんでした)$/, key: 'かもしれない', pos: '助動詞' },
];

const pos0 = (t: PositionedToken) => t.posDetail?.[0] ?? t.pos;
const pos1 = (t: PositionedToken) => t.posDetail?.[1];

const MERGE_RULES: MergeRule[] = [
  // Clause-initial ところ|が、 "however" and で|も、 "but": conjunctions, not
  // noun + subject marker / particle + also. (家でも、 stays two particles:
  // not at a clause start.)
  {
    length: 2,
    // (A sentence never opens with the particle で, so a sentence-initial
    // で|も is "but" with or without the comma: でも赤ぐみが強い.)
    match: ([a, b], text) =>
      ((a.surface === 'ところ' && b.surface === 'が') || (a.surface === 'で' && b.surface === 'も')) &&
      ((atClauseStart(text, a.startIndex) && /^[、，,]/.test(text.slice(b.endIndex))) || atSentenceStart(text, a.startIndex)),
    pos: '接続詞',
  },
  // 〜てはいけない / 〜ちゃいけない "must not"; elsewhere いけない is "bad".
  {
    length: 2,
    match: ([a, b], text) => a.surface === 'いけ' && /^(ない|ません|なかった|ませんでした)$/.test(b.surface) && /(は|ちゃ|じゃ)\s*$/.test(text.slice(0, a.startIndex)),
    pos: '形容詞',
    fixed: 'must not, not allowed (〜てはいけない)',
  },
  {
    length: 2,
    match: ([a, b]) => a.surface === 'いけ' && /^(ない|ません|なかった|ませんでした)$/.test(b.surface),
    pos: '形容詞',
    fixed: 'bad, wrong, no good (いけない)',
  },
  // 赤ぐみ / 白ぐみ "the red / white team": 組 (くみ) voiced after a noun,
  // not 茱萸 "oleaster" (graded on Sports-Day).
  {
    length: 1,
    match: ([a], text) => a.surface === 'ぐみ' && /[一-鿿々]$/.test(text.slice(0, a.startIndex)),
    pos: '名詞',
    fixed: 'group, team, class (組)',
  },
  // One-kana nouns Sudachi reads as particles or verb stems in kana text:
  // てを あらう is 手 "hand"; ももの き is 木 "tree"; すずめのこ is 子 "child".
  ...(Object.entries({
    て: ['hand (手)', false], め: ['eye (目)', false], き: ['tree (木)', true], こ: ['child; young (animal) (子)', true],
  }) as [string, [string, boolean]][]).map(([kana, [meaning, afterNoOnly]]): MergeRule => ({
    length: 1,
    match: ([a], text) => {
      if (a.surface !== kana) return false;
      const before = text.slice(0, a.startIndex);
      const after = text.slice(a.endIndex);
      const afterNo = /の\s*$/.test(before);
      if (afterNoOnly) return afterNo && /^(\s*[がをはもにの。、！？!?」]|\s*$)/.test(after);
      return (atClauseStart(text, a.startIndex) || /[\s　]$/.test(before) || afterNo) && /^[をがはもにで]/.test(after);
    },
    pos: '名詞',
    fixed: meaning,
  })),
  // 〜ておくれ "please do (for me)": Sudachi reads お as the 御 prefix.
  {
    length: 2,
    match: ([a, b], text) => a.surface === 'お' && pos0(a) === '接頭辞' && /^くれ/.test(b.surface) && /[てで]$/.test(text.slice(0, a.startIndex)),
    pos: '動詞',
    fixed: 'please (do for me): familiar request (〜ておくれ)',
  },
  // Sentence-final か|い, わ|い: one particle (行くかい, 違うわい).
  {
    length: 2,
    match: ([a, b]) => /^[かわ]$/.test(a.surface) && pos1(a) === '終助詞' && b.surface === 'い' && pos1(b) === '終助詞',
    pos: '助詞',
  },
  // Clause-initial いい|や: the interjection "no" (いいや、違う).
  {
    length: 2,
    match: ([a, b], text) => a.surface === 'いい' && b.surface === 'や' && pos1(b) === '終助詞' && atClauseStart(text, a.startIndex),
    pos: '感動詞',
    fixed: 'no (emphatic denial)',
  },
  // ので "because": UniDic splits it into nominalizer の + copula で.
  {
    length: 2,
    // …but のである / のであった is "it is (was) that …", not "because".
    match: ([a, b], text) =>
      // …and の|では is "isn't it that" (行くのではない).
      a.surface === 'の' && pos1(a) === '準体助詞' && b.surface === 'で' && pos0(b) === '助動詞' && !/^\s*[あは]/.test(text.slice(b.endIndex)),
    pos: '助詞',
  },
  // しょうがない / しようがない "it can't be helped"
  {
    length: 3,
    match: ([a, b, c]) =>
      (a.surface === 'しょう' || a.surface === 'しよう') && b.surface === 'が' && /^(ない|なかっ|なく)/.test(c.surface),
    pos: '形容詞',
  },
  // 何か is "something" (なにか): UniDic reads 何 before か as なん, and
  // as an adverb the lookup picked なんか "somehow" (21 times in 100
  // random corpus items, all of them "something").
  {
    length: 2,
    match: ([a, b]) => (a.surface === '何' || a.surface === 'なに') && b.surface === 'か' && pos1(b) === '副助詞',
    pos: '代名詞',
    fixed: 'something, anything',
    reading: 'なにか',
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
  // Sentence-initial なんだ before punctuation is the exclamation
  // "what! / oh, it's just ..." (なんだ、そうか), not "what" + copula.
  {
    length: 2,
    match: ([a, b], text) =>
      a.surface === 'なん' && b.surface === 'だ' && atSentenceStart(text, a.startIndex) && /^[、。！？!?…ー～]/.test(text.slice(b.endIndex)),
    pos: '感動詞',
  },
  // Sentence-initial でも before a comma is the conjunction "but; however".
  {
    length: 2,
    match: ([a, b], text) =>
      a.surface === 'で' && b.surface === 'も' && atSentenceStart(text, a.startIndex) && /^[、,]/.test(text.slice(b.endIndex)),
    pos: '接続詞',
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
    if (prev && pos1(prev) === '数詞' && pos1(t) === '数詞' && prev.endIndex === t.startIndex && !Number.isNaN(numberValue(prev.surface + t.surface))) {
      // Per-digit readings don't concatenate (1+2 is not じゅうに); a bare
      // number is glossed as its value (三十一 is 31, not "Mitoi (name)").
      const joinedNum = join([prev, t], prev.pos ?? '名詞');
      const value = numberValue(joinedNum.surface);
      tokens[tokens.length - 1] = {
        ...joinedNum,
        posDetail: prev.posDetail,
        reading: value < 100 ? numberReading(value) : undefined,
        fixed: { meaning: `${value} (number)` },
      };
    } else {
      tokens.push(t);
    }
  }
  // Two adjacent rising digits are an approximate range, not one number:
  // 七八ツ "seven or eight", 十二三人 "twelve or thirteen people".
  for (const [k, t] of tokens.entries()) {
    const m = /^(十)?([一二三四五六七八九])([一二三四五六七八九])$/.exec(t.surface);
    if (!m || pos1(t) !== '数詞') continue;
    const [d1, d2] = [KANJI_DIGIT[m[2]], KANJI_DIGIT[m[3]]];
    if (d2 !== d1 + 1) continue;
    const base = m[1] ? 10 : 0;
    tokens[k] = {
      ...t,
      reading: (m[1] ? 'じゅう' : '') + numberReading(d1) + numberReading(d2),
      fixed: { meaning: `${base + d1} or ${base + d2} (approximate number)` },
    };
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
    // N日: the day of the month (or N days), with its irregular reading.
    const [numTok, dayTok] = [tokens[i], tokens[i + 1]];
    if (numTok && dayTok && pos1(numTok) === '数詞' && dayTok.surface === '日' && numTok.endIndex === dayTok.startIndex) {
      const n = numberValue(numTok.surface);
      const reading = dayReading(n);
      if (reading) {
        out.push({
          ...join([numTok, dayTok], '名詞'),
          reading,
          fixed: { meaning: `the ${n}${n % 10 === 1 && n !== 11 ? 'st' : n % 10 === 2 && n !== 12 ? 'nd' : n % 10 === 3 && n !== 13 ? 'rd' : 'th'} (day of the month); ${n} day${n === 1 ? '' : 's'}`, reading },
        });
        i += 2;
        continue outer;
      }
    }
    for (let n = 5; n >= 2; n--) {
      const span = tokens.slice(i, i + n);
      if (span.length < n || !adjacent(span)) continue;
      const surface = span.map((t) => t.surface).join('');
      const phrase = SET_PHRASES.find((p) => p.re.test(surface));
      if (phrase) {
        out.push({ ...join(span, phrase.pos), baseForm: phrase.key, reading: undefined });
        i += n;
        continue outer;
      }
    }
    for (const rule of MERGE_RULES) {
      const span = tokens.slice(i, i + rule.length);
      if (span.length === rule.length && adjacent(span) && rule.match(span, text)) {
        const joined = join(span, rule.pos);
        if (rule.fixed) joined.fixed = { meaning: rule.fixed, ...(rule.reading ? { reading: rule.reading } : {}) };
        if (rule.reading) joined.reading = rule.reading;
        if (rule.key) {
          joined.baseForm = rule.key(joined.surface);
          // Month reading computed, so 一月 is いちがつ "January" (the
          // dictionary also has ひとつき "one month" under the same kanji).
          const m = numberValue(span[0].surface);
          joined.reading = m >= 1 && m <= 12 ? MONTH_READING[m] + 'がつ' : undefined;
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
  // A noun glued to the noun before it (no particle, no space) is used as a
  // suffix: ラーメン+バカ "ramen fanatic", not "idiot".
  if (pos === '名詞' && cur.pos === '名詞' && prev.endIndex === cur.startIndex && pos1(prev) !== '数詞') return 'noun';
  return undefined;
}

const KANJI = /[一-鿿々]/;
const toHiragana = (s: string) => s.replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));

/** Coordinating conjunctions that join nouns mid-sentence (A又はB "A or B"). */
const COORDINATORS = new Set(['又は', 'または', '若しくは', 'もしくは', '及び', 'および', '並びに', 'ならびに', '或いは', 'あるいは', '且つ', 'かつ', 'ないし']);

/** Grammar patterns that do open with を (〜を巡って "concerning"). */
const PARTICLE_PATTERNS = /^を(巡|めぐ|通じ|通し|はじめ|始め|もって|以て|問わ)/;

/**
 * Longest-match against JMDict (what Yomitan does on hover): 2-5 adjacent
 * tokens whose joined surface — or joined surface with the last token in
 * dictionary form (付いて|来た → 付いて来る) — is a JMDict headword become
 * one token looked up under that headword. Fixes the split set phrases
 * graded wrong on unseen text: として, ことにする, それでも, かも知れない,
 * ものの, 以下の通り, により, 在庫切れ, 途方もない, 急に.
 *
 * Guards (each from a measured failure mode):
 *   - joined text must be ≥3 chars or contain kanji (には, でも, のに are
 *     usually two separate particles)
 *   - not a pure particle/auxiliary chain
 *   - not something the grammar table already labels (ている, でした)
 *   - noun+に after a modifier stays split: 子供の時に is "when", not
 *     時に "sometimes" (急に, 本当に still merge)
 */
export async function mergeDictionaryWords(
  tokens: PositionedToken[],
  text: string,
  hasForm: (s: string) => Promise<boolean>,
  isKanaHeadword: (s: string) => Promise<boolean>,
  isGrammar: (s: string) => boolean,
  isConjunctionOnly: (s: string) => Promise<boolean> = async () => false,
  headwordPos: (s: string) => Promise<Set<string>> = async () => new Set(),
  commonKanaWord: (s: string) => Promise<Set<string>> = async () => new Set(),
  headwordReadings: (s: string) => Promise<Set<string>> = async () => new Set()
): Promise<PositionedToken[]> {
  const out: PositionedToken[] = [];
  let i = 0;
  while (i < tokens.length) {
    // Kana words UniDic lacks in kana come out as pieces (じてん|しゃ,
    // かいさ|つ, はっ|けん, お|かし; ある|こう for 歩こう). Graded on 100
    // random corpus items: beginner texts write these words in kana.
    {
      const kana = await joinKanaFragment(tokens, i, commonKanaWord);
      if (kana) {
        out.push(kana.token);
        i += kana.used;
        continue;
      }
    }
    // Traditional given names: one kanji + a name suffix (紋|作, 冠|蔵,
    // 水|右衛門), optionally after a surname (吉田|冠|蔵). Sudachi tags the
    // suffix 接尾辞 and the head as a common noun ("crest", "cap").
    const head = tokens[i];
    const suf = tokens[i + 1];
    if (head && suf && head.endIndex === suf.startIndex && head.surface.length === 1 && KANJI.test(head.surface) && pos1(head) !== '数詞') {
      const strong = /^(蔵|衛門|右衛門|左衛門|兵衛|之助|之丞|太郎|次郎|三郎|四郎|五郎|郎|吉|助)$/.test(suf.surface);
      const weak = /^(作|七|八|平|次|松|造|治)$/.test(suf.surface);
      const given = head.surface + suf.surface;
      const prev = out[out.length - 1];
      const surname = prev && prev.endIndex === head.startIndex && prev.posDetail?.[3] === '姓' ? prev : undefined;
      const repeated = text.split(given).length > 2;
      // 朝七|時 is "7 a.m.": a counter after the suffix means a number.
      const counterNext = tokens[i + 2]?.posDetail?.some((p) => p.startsWith('助数詞'));
      if ((strong || (weak && (surname || repeated))) && !counterNext && !(await hasForm(given))) {
        const parts = surname ? [surname, head, suf] : [head, suf];
        if (surname) out.pop();
        const name = parts.map((t) => t.surface).join('');
        // 七 in a name is しち (半七 はんしち), not なな.
        const readings = parts.map((t) => (t === suf && t.surface === '七' ? 'しち' : t.reading));
        out.push({
          surface: name,
          baseForm: name,
          pos: '名詞',
          posDetail: ['名詞', '固有名詞', '人名', '名'],
          reading: readings.every((r) => r) ? readings.join('') : undefined,
          dictionaryForm: name,
          lemmaSurface: name,
          startIndex: parts[0].startIndex,
          endIndex: suf.endIndex,
          fixed: { meaning: `(personal name: ${name})` },
        });
        i += 2;
        continue;
      }
    }
    // A katakana run Sudachi fragmented (アデリー|ナ, ナナ|ナナ|ナント|スン|ベ):
    // a short (≤2) or name piece means the pieces are not real words here.
    // The run becomes one token; unless it is itself a headword, it is
    // labelled honestly instead of each piece getting a confident meaning.
    // Two ordinary loanwords (コーヒー|カップ) stay separate.
    {
      const KATA = /^[ァ-ヴー]+$/;
      let j = i;
      while (j < tokens.length && KATA.test(tokens[j].surface) && (j === i || tokens[j - 1].endIndex === tokens[j].startIndex)) j++;
      const run = tokens.slice(i, j);
      // A one-character piece (not a trailing ツ/ッ/ー stylization: ギャー|ツ)
      // or a name piece marks fragmentation; two real words (チョコレート|バー)
      // and a repeated sound (グー|グー|グー, left to reduplication) do not.
      const fragment = run.some((t, k) => (t.surface.length === 1 && !(k === run.length - 1 && /^[ツッー]$/.test(t.surface))) || pos1(t) === '固有名詞');
      const repeated = run.every((t) => t.surface === run[0].surface);
      if (run.length >= 2 && fragment && !repeated) {
        const surface = run.map((t) => t.surface).join('');
        const known = await hasForm(surface);
        out.push({
          ...join(run, '名詞'),
          reading: run.every((t) => t.reading) ? run.map((t) => t.reading).join('') : undefined,
          posDetail: ['名詞', '普通名詞', '一般'],
          ...(known ? {} : { fixed: { meaning: '(katakana word not in the dictionary: a name, loanword or sound)' } }),
        });
        i = j;
        continue;
      }
    }
    let merged: PositionedToken | null = null;
    let used = 0;
    for (let n = Math.min(5, tokens.length - i); n >= 2 && !merged; n--) {
      const span = tokens.slice(i, i + n);
      if (!adjacent(span)) continue;
      if (span.every((t) => ['助詞', '助動詞'].includes(pos0(t) ?? ''))) continue;
      // A span opening with a verb/adjective/auxiliary is conjugation, not
      // a set phrase: いる|か is "is ... ?", not いるか "dolphin"; し|たり,
      // 知ら|ない, ない|と. (Conjugated headwords are matched through the
      // grouped token's lemma instead.)
      // Two exceptions keep whole headwords: an attributive adjective + noun
      // (好い|加減 → 好い加減 "moderate; irresponsible") and a compound verb,
      // stem + verb (云い|含める → 云い含める "to instruct").
      const conj = (t: PositionedToken, form: string) => t.posDetail?.some((p) => p.startsWith(form));
      const adjNoun = n === 2 && pos0(span[0]) === '形容詞' && conj(span[0], '連体形') && pos0(span[1]) === '名詞';
      const compoundVerb = n === 2 && pos0(span[0]) === '動詞' && conj(span[0], '連用形') && pos0(span[1]) === '動詞' && KANJI.test(span[1].surface);
      if (['動詞', '形容詞', '助動詞'].includes(pos0(span[0]) ?? '') && !adjNoun && !compoundVerb) continue;
      // Numbers + counters are handled by the date/month merges; 80万|人
      // must not become 万人 "everybody", nor 4|人目 "public notice".
      const before = tokens[i - 1];
      // (…except a number-initial adverb: 二度と "never again", 一度に, but
      // never a bare number + counter: 十|分 is "ten minutes", 二|時 "2 o'clock".)
      if (pos1(span[0]) === '数詞' && (span.length === 2 || !(await headwordPos(span.map((t) => t.surface).join(''))).has('adv'))) continue;
      if (before && pos1(before) === '数詞' && before.endIndex === span[0].startIndex && span[0].posDetail?.some((p) => p.startsWith('助数詞'))) continue;
      const surface = span.map((t) => t.surface).join('');
      if (surface.length < 3 && !KANJI.test(surface)) continue;
      // A span opening with を/が/へ/は/も is a phrase boundary (を|して is
      // "doing ... (object)", not the causative-patient expression をして).
      if (/^[をがへはも]$/.test(span[0].surface) && !PARTICLE_PATTERNS.test(span.map((t) => t.surface).join(''))) continue;
      const joined = span.map((t) => t.surface).join('');
      const coordinator = COORDINATORS.has(joined);
      // …and one CLOSING with them is noun + particle (今日|は is "today"
      // + topic, not the greeting 今日は "hello") — except the coordinating
      // conjunctions 又は / もしくは "or".
      // 何も "(not) at all" and 如何にも "indeed" are adverbs, not noun + も.
      if (/^[をがへはも]$/.test(span[span.length - 1].surface) && !coordinator &&
        !(span[span.length - 1].surface === 'も' && await (async () => {
          const hp = await headwordPos(joined);
          // …but not interjection headwords: どう|も in narrative is "somehow",
          // and the merged どうも shows "thank you".
          // Noun + に + も is "even in" (山の中にも), not the expression 中にも
          // "especially" (adverbs like 今にも "at any moment" still merge).
          // (どこにも / なんにも "nowhere / nothing" also still merge: only a
          // modified noun, の中にも, is literal.)
          const niMo = span.length >= 3 && span[span.length - 2].surface === 'に' && !!before &&
            before.endIndex === span[0].startIndex && (before.surface === 'の' || ['動詞', '形容詞', '助動詞', '連体詞'].includes(pos0(before) ?? ''));
          return !hp.has('int') && !niMo && (hp.has('adv') || (hp.has('exp') && ['代名詞', '副詞'].includes(pos0(span[0]) ?? '')));
        })())) continue;
      // Noun + から is "from <noun>" (側から), not an idiom like 側から "as soon as".
      if (span[span.length - 1].surface === 'から' && pos0(span[0]) === '名詞') continue;
      // …の right before a noun is the genitive: 以上のもの|の|ボイラー is
      // "the boiler of …", not ものの "although".
      const after = tokens[i + span.length];
      const touchesAfter = after && after.startIndex === span[span.length - 1].endIndex;
      if (span[span.length - 1].surface === 'の' && touchesAfter && (pos0(after) === '名詞' || /^よう/.test(after.surface))) continue;
      // …で before は is the copula of では (ものではない "is not a thing
      // that"; のでは "isn't it that"), not もので / ので "because".
      if (span[span.length - 1].surface === 'で' && touchesAfter && after.surface === 'は') continue;
      // Noun + 共 is the plural suffix ども (猿共 "the monkeys"); 猿|共|に is
      // "to the monkeys", not 共に "together".
      if (span[0].surface === '共' && before && before.endIndex === span[0].startIndex && pos0(before) === '名詞') continue;
      // 止める|間|も|なく after a verb is "without time to stop", not
      // 間もなく "soon".
      if (span[0].surface === '間' && before && before.endIndex === span[0].startIndex && ['動詞', '助動詞'].includes(pos0(before) ?? '')) continue;
      // ものなら "if I could" follows a volitional or できる (行こうものなら);
      // after an ordinary verb it is もの + なら (借りた物なら "if it is the
      // thing I borrowed").
      if (/^(もの|物)なら$/.test(joined) && !(before && (before.posDetail?.some((p) => p.startsWith('意志推量形')) || /^(出来る|できる)$/.test(before.baseForm)))) continue;
      // Formal noun もの + で / として: "a thing that ..." (接近するものとしては
      // "as one that approaches"; 決めたもので "it is that they decided").
      if (/^もの(で|とし|とす)/.test(joined)) continue;
      // …に before a compound particle verb belongs to it: それ|によって is
      // "by that", not それに "besides".
      if (span[span.length - 1].surface === 'に' && touchesAfter && /^(よっ|よる|より|よれ|つい|対し|対す|とっ|関し|関す|おい|おけ|沿っ|伴っ|基づ|向け|つれ|従っ|際し|応じ|加え|比べ|渡っ|わたっ)/.test(after.surface)) continue;
      // と|する after a verb is "try to / suppose" (しようとする, あるとする),
      // not the noun pattern "to take as" (AをBとする).
      // (After an adverb it is adverbial と: ゆっくりとした "slow".)
      if (span[0].surface === 'と' && before && before.endIndex === span[0].startIndex && ['動詞', '助動詞', '形容詞', '副詞'].includes(pos0(before) ?? '')) continue;
      // Sentence-final にしろ / にせよ is "make it ..." (好い加減にしろ), not
      // "even if".
      if (/^に(しろ|せよ)$/.test(joined) && /^[。！!」』）)\n]/.test(text.slice(span[span.length - 1].endIndex, span[span.length - 1].endIndex + 1))) continue;
      if (isGrammar(surface)) continue;
      const last = span[n - 1];
      if (n === 2 && last.surface === 'に' && pos0(span[0]) === '名詞') {
        const before = tokens[i - 1];
        if (before && before.endIndex === span[0].startIndex && (before.surface === 'の' || ['動詞', '形容詞', '連体詞', '助動詞'].includes(pos0(before) ?? ''))) continue;
      }
      const lemmaForm = span.slice(0, -1).map((t) => t.surface).join('') + (last.lemmaSurface ?? last.surface);
      let key = (await hasForm(surface)) ? surface : lemmaForm !== surface && (await hasForm(lemmaForm)) ? lemmaForm : null;
      // All-kana: only headwords really written in kana (see isKanaHeadword).
      // …except a long kana noun compound, which beginner texts write in
      // kana (じこ|しょうかい is 自己紹介 "self-introduction", not 事故 +
      // 紹介): five or more kana are rarely an accidental homophone.
      const kanaCompound = key === surface && !KANJI.test(key) && surface.length >= 5 &&
        span.every((t) => pos0(t) === '名詞' && /^[ぁ-ゖー]+$/.test(t.surface));
      if (key && !KANJI.test(key) && !kanaCompound && !(await isKanaHeadword(key))) key = null;
      // A conjunction (そこで "so", それで "and then") only opens a clause;
      // mid-sentence the same kana is the pieces (そこで = "there" + で).
      if (key && !coordinator && !atClauseStart(text, span[0].startIndex) && (await isConjunctionOnly(key))) key = null;
      // Comparison / extent particles open phrases, not headwords: より|よかっ
      // ("better than"), から|にしろ, くらい|の|たか(さ); しか|ない after a
      // noun is "only", not "have no choice but to".
      if (key && /^(より|から|くらい|ぐらい|まで|だけ|ほど)$/.test(span[0].surface)) key = null;
      if (key && span[0].surface === 'しか' && before && pos0(before) === '名詞') key = null;
      // 「…」といいました is "said", not という "called, named".
      if (key && /^と(いう|言う|云う)$/.test(key) && key !== surface && /[」』]$/.test(text.slice(0, span[0].startIndex).trimEnd())) key = null;
      // A kana span opening with a particle only joins into a grammatical
      // headword (つつある, にすぎない): と|かいう is "so-called", not かいう "calla".
      if (key && pos0(span[0]) === '助詞' && !KANJI.test(key)) {
        const hp = await headwordPos(key);
        if (![...hp].some((p) => ['exp', 'prt', 'conj', 'adv', 'aux', 'aux-v', 'aux-adj'].includes(p) || /^v[15kzr]/.test(p))) key = null;
      }
      // Matched through the last token's dictionary form, the headword must
      // conjugate: と|か|きました is "wrote that", not とかく "anyhow".
      if (key && key !== surface) {
        const hp = await headwordPos(key);
        // ('vs' = takes する after it, so the tail can't be part of the word.)
        if (hp.size > 0 && ![...hp].some((p) => /^(v[15kzr]|vs-|adj-i|aux|exp)/.test(p))) key = null;
      }
      // An everyday adjective + noun is literal unless the headword is more
      // than a noun: いい|顔 "a good face" (not "big shot"), but 好い加減
      // (adj-na "half-hearted").
      if (key && adjNoun) {
        const hp = await headwordPos(key);
        if (![...hp].some((p) => !/^(n($|-)|exp$|adj-f$)/.test(p))) key = null;
      }
      // The pieces' own readings must be a reading of the headword: 外|に
      // read そと|に is "outside", not 外に (ほかに "else"); 何時|まで read
      // なんじ is "until what time", not いつまで. (Numbers excluded: 一|杯
      // reads いち|はい but the word is いっぱい.)
      if (key && key === surface && KANJI.test(surface) && span.every((t) => t.reading) && !span.some((t) => pos1(t) === '数詞')) {
        const hr = await headwordReadings(key);
        const joinedReading = span.map((t) => toHiragana(t.reading!)).join('');
        if (hr.size > 0 && !hr.has(joinedReading)) key = null;
      }
      if (!key) continue;
      const readings = span.map((t) => t.reading);
      merged = {
        surface,
        baseForm: key,
        // An exact headword reads as the dictionary says (一杯 いっぱい, not
        // いち+はい); a conjugated span keeps its contextual reading.
        // No Sudachi POS for a multi-word span: an expression's JMDict POS
        // (exp) has no Sudachi equivalent, and a guessed one would filter
        // the right senses out.
        pos: undefined,
        // A kana surface is its own reading (いいてんき, not よいてんき).
        reading: !KANJI.test(surface) ? surface : key === surface ? undefined : readings.every((r) => r) ? readings.join('') : undefined,
        posDetail: undefined,
        dictionaryForm: key,
        tail: last.tail,
        lemmaSurface: key,
        startIndex: span[0].startIndex,
        endIndex: last.endIndex,
      };
      used = n;
    }
    if (merged) {
      out.push(merged);
      i += used;
      continue;
    }
    // A single grouped token whose lemma is a dictionary expression
    // (付いて来た → 付いて来る "to follow").
    const t = tokens[i];
    // (Not the word's own kana lemma: いいました → いう would drop Sudachi's
    // 言う and pick the kana homograph 結う "to do up hair".)
    if (t.lemmaSurface && t.lemmaSurface !== t.baseForm && t.lemmaSurface !== t.surface && !(t.lemmaSurface === t.dictionaryForm && !KANJI.test(t.lemmaSurface)) && t.surface.length > 2 && (await hasForm(t.lemmaSurface))) {
      out.push({ ...t, baseForm: t.lemmaSurface, pos: undefined, posDetail: undefined });
    } else {
      out.push(t);
    }
    i++;
  }
  return out;
}

const HIRAGANA = /^[ぁ-ゖー]+$/;
/** Single kana that are particles/endings, never a stray word fragment. */
const PARTICLE_KANA = new Set(['は', 'が', 'を', 'に', 'へ', 'と', 'で', 'も', 'の', 'や', 'か', 'ね', 'よ', 'な', 'わ', 'ぞ', 'さ', 'て', 'た', 'だ', 'し', 'ば', 'え', 'ん']);
/** Volitional ending → dictionary ending of a godan verb (あるこう → あるく). */
const VOLITIONAL: Record<string, [string, string]> = {
  こう: ['く', 'v5k'], ごう: ['ぐ', 'v5g'], そう: ['す', 'v5s'], とう: ['つ', 'v5t'], のう: ['ぬ', 'v5n'],
  ぼう: ['ぶ', 'v5b'], もう: ['む', 'v5m'], ろう: ['る', 'v5r'], おう: ['う', 'v5u'],
};

/**
 * A run of 2-3 hiragana pieces that spells a common word normally written
 * in kanji, where at least one piece is evidence of fragmentation: a
 * suffix/prefix, a kana numeral, a "name", or a stray single kana that is
 * not a particle. Two ordinary words side by side (or anything with a
 * particle) are left alone, so と|なり never becomes 隣.
 * Also re-joins a godan volitional split as 連体詞/副詞 (ある|こう → 歩こう).
 */
async function joinKanaFragment(
  tokens: PositionedToken[],
  i: number,
  commonKanaWord: (s: string) => Promise<Set<string>>
): Promise<{ token: PositionedToken; used: number } | null> {
  for (let n = 3; n >= 2; n--) {
    const span = tokens.slice(i, i + n);
    if (span.length < n || !adjacent(span) || !span.every((t) => HIRAGANA.test(t.surface))) continue;
    const surface = span.map((t) => t.surface).join('');
    if (surface.length < 3) continue;
    const base = {
      surface,
      reading: surface,
      startIndex: span[0].startIndex,
      endIndex: span[n - 1].endIndex,
    };
    // ある|こう: a volitional the pieces spell.
    const vol = n === 2 ? VOLITIONAL[span[1].surface] : undefined;
    if (vol && ['連体詞', '副詞', '名詞'].includes(pos0(span[0]) ?? '')) {
      const dict = span[0].surface + vol[0];
      if ((await commonKanaWord(dict)).has(vol[1])) {
        return {
          token: { ...base, baseForm: dict, pos: '動詞', posDetail: ['動詞', '一般', '五段', '意志推量形'], dictionaryForm: dict, lemmaSurface: dict },
          used: 2,
        };
      }
    }
    const stray = (t: PositionedToken) => t.surface.length === 1 && !PARTICLE_KANA.has(t.surface);
    const piece = (t: PositionedToken) => ['名詞', '接尾辞', '接頭辞'].includes(pos0(t) ?? '') || stray(t);
    const evidence = (t: PositionedToken) => ['接尾辞', '接頭辞'].includes(pos0(t) ?? '') || ['数詞', '固有名詞'].includes(pos1(t) ?? '') || stray(t);
    // Five or more kana spelling a common word need no other evidence, and
    // may be cut through an interjection/adverb (うん|どう|かい → 運動会).
    const long = surface.length >= 5 && span.every((t) => piece(t) || ['感動詞', '副詞', '代名詞', '連体詞'].includes(pos0(t) ?? ''));
    if (!long && (!span.every(piece) || !span.some(evidence))) continue;
    const hp = await commonKanaWord(surface);
    if (![...hp].some((p) => /^(n|adj-na|adj-no|adv)/.test(p))) continue;
    return {
      token: { ...base, baseForm: surface, pos: '名詞', posDetail: ['名詞', '普通名詞', '一般'], dictionaryForm: surface, lemmaSurface: surface },
      used: n,
    };
  }
  return null;
}

/**
 * A kana reading in parentheses right after a word (三菱仲15号館（みつびし
 * なかじゅうごごうかん）, common in encyclopedic and news text) is the
 * word's reading, not more words: tokenizing it produced junk like ごうかん
 * "rape" for 号館. Its tokens become one token labelled as that reading.
 */
export function markParenthesizedReadings(tokens: PositionedToken[], text: string): PositionedToken[] {
  const spans: { start: number; end: number; reading: string; of: string }[] = [];
  // The reading may keep katakana parts (ボイラー・タービンしゅにん…) but
  // must contain hiragana, or it is just a katakana gloss. Encyclopedic
  // leads continue after a comma: （こうしゅう…こうし、中国名：…）.
  const re = /([一-鿿々ヶ〆0-9０-９A-Za-zＡ-Ｚａ-ｚァ-ヴー・]+)[（(]([ぁ-ゖァ-ヴー・　 、]*[ぁ-ゖ][ぁ-ゖァ-ヴー・　 、]*)(?=[）)]|、[^ぁ-ゖ]{2})/g;
  for (let m; (m = re.exec(text)); ) {
    const start = m.index + m[1].length + 1;
    spans.push({ start, end: start + m[2].length, reading: m[2].replace(/[\s　、・]/g, ''), of: m[1] });
  }
  if (spans.length === 0) return tokens;
  const out: PositionedToken[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const span = spans.find((s) => tokens[i].startIndex >= s.start && tokens[i].endIndex <= s.end);
    if (!span) {
      out.push(tokens[i]);
      continue;
    }
    let j = i;
    while (j + 1 < tokens.length && tokens[j + 1].endIndex <= span.end) j++;
    const inner = tokens.slice(i, j + 1);
    out.push({
      ...join(inner, '名詞'),
      reading: inner.map((t) => t.surface).join(''),
      fixed: { meaning: `(reading of ${span.of}: ${span.reading})` },
    });
    i = j;
  }
  return out;
}

/**
 * Formal nouns: after a modifier (verb/adjective/auxiliary, の, この/その)
 * these are grammar, and their JMDict first senses mislead (ため "good,
 * advantage", はず "nock of a bow"). Graded wrong 10+ times on unseen text.
 */
const FORMAL_NOUNS: Record<string, string> = {
  ため: 'for (the sake of); in order to; because of',
  為: 'for (the sake of); in order to; because of',
  はず: 'should (be), is expected to',
  筈: 'should (be), is expected to',
  わけ: 'reason; it means that, that is why',
  訳: 'reason; it means that, that is why',
  つもり: 'intention, plan (to do)',
  積もり: 'intention, plan (to do)',
  まま: 'as it is; while still (〜たまま)',
  儘: 'as it is; while still (〜たまま)',
  うち: 'while, during; within (〜ないうちに "before")',
  せい: 'because of, due to (blame)',
  おかげ: 'thanks to',
  間: 'while, during',
  あいだ: 'while, during',
};

/** Grammatical meaning of a formal noun used after a modifier, if any. */
export function formalNounMeaning(prev: PositionedToken | undefined, cur: PositionedToken, text: string): string | undefined {
  const meaning = FORMAL_NOUNS[cur.surface];
  if (!meaning || !prev || !nextTo(text, prev, cur)) return undefined;
  const p = pos0(prev);
  const modifier =
    p === '動詞' || p === '形容詞' || p === '連体詞' ||
    (p === '助動詞' && /^(た|だ|ない|ぬ|な|の)$/.test(prev.tail?.surface ?? prev.surface)) ||
    prev.surface === 'の' || prev.surface === 'な' ||
    prev.tail?.pos === '動詞' || prev.tail?.pos === '助動詞';
  return modifier ? meaning : undefined;
}

/**
 * English given by the text itself for a katakana term — the encyclopedic /
 * news convention ポストクロッシング (Postcrossing), 「ポストクロッサー
 * (Postcrossers)」. Coinages like these are in no dictionary, and Sudachi
 * splits them into junk (クロ "black", サー "Sir").
 */
export function textGlossary(text: string): Map<string, string> {
  const glossary = new Map<string, string>();
  const re = /([ァ-ヴー・]{3,})\s*[（(](?:英[:：]\s*)?([A-Za-z][A-Za-z .'\-]{1,40})[)）]/g;
  for (let m; (m = re.exec(text)); ) {
    if (!glossary.has(m[1])) glossary.set(m[1], m[2].trim());
  }
  return glossary;
}

/** Re-join every occurrence of a glossary term and give it the text's English. */
export function markGlossaryTerms(tokens: PositionedToken[], text: string): PositionedToken[] {
  const glossary = textGlossary(text);
  if (glossary.size === 0) return tokens;
  const spans: { start: number; end: number; english: string }[] = [];
  for (const [term, english] of glossary) {
    for (let at = text.indexOf(term); at >= 0; at = text.indexOf(term, at + term.length)) {
      spans.push({ start: at, end: at + term.length, english });
    }
  }
  const out: PositionedToken[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const span = spans.find((sp) => tokens[i].startIndex === sp.start);
    if (!span) {
      out.push(tokens[i]);
      continue;
    }
    let j = i;
    while (j + 1 < tokens.length && tokens[j + 1].endIndex <= span.end) j++;
    if (tokens[j].endIndex !== span.end) {
      out.push(tokens[i]);
      continue;
    }
    out.push({ ...join(tokens.slice(i, j + 1), '名詞'), fixed: { meaning: `${span.english} (as given in the text)` } });
    i = j;
  }
  return out;
}
