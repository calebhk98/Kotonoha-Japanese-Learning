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
function atClauseStart(text: string, index: number): boolean {
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
  // ので "because": UniDic splits it into nominalizer の + copula で.
  {
    length: 2,
    // …but のである / のであった is "it is (was) that …", not "because".
    match: ([a, b], text) =>
      a.surface === 'の' && pos1(a) === '準体助詞' && b.surface === 'で' && pos0(b) === '助動詞' && !/^\s*あ/.test(text.slice(b.endIndex)),
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
  isConjunctionOnly: (s: string) => Promise<boolean> = async () => false
): Promise<PositionedToken[]> {
  const out: PositionedToken[] = [];
  let i = 0;
  while (i < tokens.length) {
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
      if (['動詞', '形容詞', '助動詞'].includes(pos0(span[0]) ?? '')) continue;
      // Numbers + counters are handled by the date/month merges; 80万|人
      // must not become 万人 "everybody", nor 4|人目 "public notice".
      const before = tokens[i - 1];
      if (pos1(span[0]) === '数詞' || (before && pos1(before) === '数詞' && before.endIndex === span[0].startIndex)) continue;
      const surface = span.map((t) => t.surface).join('');
      if (surface.length < 3 && !KANJI.test(surface)) continue;
      // A span opening with を/が/へ/は/も is a phrase boundary (を|して is
      // "doing ... (object)", not the causative-patient expression をして).
      if (/^[をがへはも]$/.test(span[0].surface)) continue;
      // …and one CLOSING with them is noun + particle (今日|は is "today"
      // + topic, not the greeting 今日は "hello").
      if (/^[をがへはも]$/.test(span[span.length - 1].surface)) continue;
      if (isGrammar(surface)) continue;
      const last = span[n - 1];
      if (n === 2 && last.surface === 'に' && pos0(span[0]) === '名詞') {
        const before = tokens[i - 1];
        if (before && before.endIndex === span[0].startIndex && (before.surface === 'の' || ['動詞', '形容詞', '連体詞', '助動詞'].includes(pos0(before) ?? ''))) continue;
      }
      const lemmaForm = span.slice(0, -1).map((t) => t.surface).join('') + (last.lemmaSurface ?? last.surface);
      let key = (await hasForm(surface)) ? surface : lemmaForm !== surface && (await hasForm(lemmaForm)) ? lemmaForm : null;
      // All-kana: only headwords really written in kana (see isKanaHeadword).
      if (key && !KANJI.test(key) && !(await isKanaHeadword(key))) key = null;
      // A conjunction (そこで "so", それで "and then") only opens a clause;
      // mid-sentence the same kana is the pieces (そこで = "there" + で).
      if (key && !atClauseStart(text, span[0].startIndex) && (await isConjunctionOnly(key))) key = null;
      if (!key) continue;
      const readings = span.map((t) => t.reading);
      merged = {
        surface,
        baseForm: key,
        // No Sudachi POS for a multi-word span: an expression's JMDict POS
        // (exp) has no Sudachi equivalent, and a guessed one would filter
        // the right senses out.
        pos: undefined,
        reading: readings.every((r) => r) ? readings.join('') : undefined,
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
    if (t.lemmaSurface && t.lemmaSurface !== t.baseForm && t.lemmaSurface !== t.surface && t.surface.length > 2 && (await hasForm(t.lemmaSurface))) {
      out.push({ ...t, baseForm: t.lemmaSurface, pos: undefined, posDetail: undefined });
    } else {
      out.push(t);
    }
    i++;
  }
  return out;
}

/**
 * A kana reading in parentheses right after a word (三菱仲15号館（みつびし
 * なかじゅうごごうかん）, common in encyclopedic and news text) is the
 * word's reading, not more words: tokenizing it produced junk like ごうかん
 * "rape" for 号館. Its tokens become one token labelled as that reading.
 */
export function markParenthesizedReadings(tokens: PositionedToken[], text: string): PositionedToken[] {
  const spans: { start: number; end: number; reading: string; of: string }[] = [];
  const re = /([一-鿿々ヶ〆0-9０-９A-Za-zＡ-Ｚａ-ｚァ-ヴー]+)[（(]([ぁ-ゖー・　 、]+)[）)]/g;
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
