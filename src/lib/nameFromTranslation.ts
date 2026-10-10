/**
 * Katakana names recognised from the sentence translations (translation
 * context step). Sudachi splits unknown katakana names into common words
 * (ゾル|タン "sol" + "tongue", ルー|ティ) or reads them as a word (レッド
 * "red", エラ "gills"), but the translation spells them as capitalised
 * English names ("Zoltan", "Red", "Ella"). A katakana run whose loose
 * spelling matches such a name is that name.
 *
 * Graded on test6 web fiction: 14 of 44 wrong tokens were split or
 * misread katakana character names.
 */

const KANA: Record<string, string> = {
  ア: 'a', イ: 'i', ウ: 'u', エ: 'e', オ: 'o', カ: 'ka', キ: 'ki', ク: 'ku', ケ: 'ke', コ: 'ko',
  サ: 'sa', シ: 'shi', ス: 'su', セ: 'se', ソ: 'so', タ: 'ta', チ: 'chi', ツ: 'tsu', テ: 'te', ト: 'to',
  ナ: 'na', ニ: 'ni', ヌ: 'nu', ネ: 'ne', ノ: 'no', ハ: 'ha', ヒ: 'hi', フ: 'fu', ヘ: 'he', ホ: 'ho',
  マ: 'ma', ミ: 'mi', ム: 'mu', メ: 'me', モ: 'mo', ヤ: 'ya', ユ: 'yu', ヨ: 'yo',
  ラ: 'ra', リ: 'ri', ル: 'ru', レ: 're', ロ: 'ro', ワ: 'wa', ヲ: 'o', ン: 'n',
  ガ: 'ga', ギ: 'gi', グ: 'gu', ゲ: 'ge', ゴ: 'go', ザ: 'za', ジ: 'ji', ズ: 'zu', ゼ: 'ze', ゾ: 'zo',
  ダ: 'da', ヂ: 'ji', ヅ: 'zu', デ: 'de', ド: 'do', バ: 'ba', ビ: 'bi', ブ: 'bu', ベ: 'be', ボ: 'bo',
  パ: 'pa', ピ: 'pi', プ: 'pu', ペ: 'pe', ポ: 'po', ヴ: 'vu',
  ァ: 'a', ィ: 'i', ゥ: 'u', ェ: 'e', ォ: 'o', ャ: 'ya', ュ: 'yu', ョ: 'yo',
};
// Two-kana sounds written with a small kana (ティ ti, シャ sha, ファ fa).
const DIGRAPH: Record<string, string> = {
  ティ: 'ti', ディ: 'di', トゥ: 'tu', ドゥ: 'du', ファ: 'fa', フィ: 'fi', フェ: 'fe', フォ: 'fo',
  ウィ: 'wi', ウェ: 'we', ウォ: 'wo', ヴァ: 'va', ヴィ: 'vi', ヴェ: 've', ヴォ: 'vo', シェ: 'she', ジェ: 'je', チェ: 'che',
};

export function romanizeKatakana(s: string): string {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const pair = s.slice(i, i + 2);
    if (DIGRAPH[pair]) {
      out += DIGRAPH[pair];
      i++;
      continue;
    }
    const c = s[i];
    const next = s[i + 1];
    if (next && /[ャュョ]/.test(next) && KANA[c]) {
      // キャ kya, シャ sha, チュ chu
      const base = KANA[c].replace(/i$/, '');
      out += (/(sh|ch|j)$/.test(base) ? base : base + 'y') + KANA[next].slice(1);
      i++;
    } else if (c === 'ッ') {
      const n = (next && (DIGRAPH[s.slice(i + 1, i + 3)] ?? KANA[next])) || '';
      out += n[0] ?? '';
    } else if (c === 'ー') {
      out += out.match(/[aeiou]$/)?.[0] ?? '';
    } else {
      out += KANA[c] ?? '';
    }
  }
  return out;
}

/** Loose spelling for matching: l=r, v=b, c=k, no doubled letters. */
function loose(s: string): string {
  return s
    .toLowerCase()
    .replace(/ph/g, 'f')
    .replace(/c(?!h)/g, 'k')
    .replace(/l/g, 'r')
    .replace(/v/g, 'b')
    .replace(/(.)\1+/g, '$1');
}
const skeleton = (s: string) => loose(s).replace(/[aeiouy]/g, '');

/**
 * Capitalised words that occur mid-sentence in the translations (a
 * sentence-initial capital only counts when the same word also occurs
 * mid-sentence somewhere).
 */
export function namesInTranslations(translations: (string | null)[]): string[] {
  const mid = new Set<string>();
  for (const t of translations) {
    if (!t) continue;
    for (const sentence of t.split(/(?<=[.!?])\s+/)) {
      const words = sentence.match(/[A-Za-z][A-Za-z'-]*/g) ?? [];
      words.slice(1).forEach((w) => {
        const name = w.replace(/'s$/, '');
        if (/^[A-Z][a-z]{1,}/.test(name)) mid.add(name);
      });
    }
  }
  return [...mid];
}

/** The translated name a katakana string spells, if any. */
export function matchName(katakana: string, names: string[]): string | undefined {
  const r = romanizeKatakana(katakana);
  if (!r) return undefined;
  const rs = skeleton(r);
  for (const name of names) {
    const ns = skeleton(name);
    // The opening consonant + vowel must agree too: ギルド (gi-) is not
    // "Guard" (gu-) even though g-r-d lines up.
    const open = (s: string) => loose(s).match(/^[^aeiou]*[aeiou]/)?.[0];
    if (ns !== rs || open(name) !== open(r)) continue;
    // Two or more consonants must line up; a one-consonant name (Ella)
    // needs the whole loose spelling to match.
    if (rs.length >= 2 || loose(name) === loose(r)) return name;
  }
  return undefined;
}

/**
 * Joins adjacent katakana tokens (up to 4, longest first) that spell one of
 * the translated names into a single proper-noun token glossed as that name.
 * A single katakana token can match too (レッド "Red", エラ "Ella").
 */
export function nameKatakanaRuns<T extends { surface: string; startIndex: number; endIndex: number }>(tokens: T[], names: string[]): T[] {
  const KATA = /^[ァ-ヴー]+$/;
  const out: T[] = [];
  for (let i = 0; i < tokens.length; i++) {
    let done = false;
    for (let n = 4; n >= 1 && !done; n--) {
      const run = tokens.slice(i, i + n);
      if (run.length < n || !run.every((t, k) => KATA.test(t.surface) && (k === 0 || run[k - 1].endIndex === t.startIndex))) continue;
      // A single token Sudachi knows as an ordinary word (カバン "bag",
      // ナポリタン, カイゼン) needs Sudachi's own proper-noun tag; only runs
      // it fragmented (ゾル|タン) are renamed on the translation alone.
      if (n === 1 && (run[0] as any).posDetail?.[1] !== '固有名詞') continue;
      const surface = run.map((t) => t.surface).join('');
      const name = matchName(surface, names);
      if (!name) continue;
      const reading = surface.replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
      out.push({
        ...run[0],
        surface,
        baseForm: surface,
        dictionaryForm: surface,
        lemmaSurface: surface,
        pos: '名詞',
        posDetail: ['名詞', '固有名詞', '人名', '一般'],
        reading,
        endIndex: run[run.length - 1].endIndex,
        fixed: { meaning: `${name} (name)`, reading },
      } as T);
      i += n - 1;
      done = true;
    }
    if (!done) out.push(tokens[i]);
  }
  return out;
}

const toKatakana = (s: string) => s.replace(/[ぁ-ゖ]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60));

/**
 * The name a hiragana token spells in its sentence's translation, if any:
 * the translation keeps a name romanized (ゆき → "Yuki", すずきさん →
 * "suzukisan") where it would translate the word ("snow", "sea bass").
 * Four or more letters only: shorter spellings match English by chance.
 * A capitalised spelling must not open its sentence, and a lowercase one
 * (an untranslated romanization) only counts for a token Sudachi already
 * tags as a name (`tagged`): らーめん → "ramen" is a word, not a name.
 */
export function kanaNameIn(surface: string, translation: string | null | undefined, tagged = false): string | undefined {
  if (!translation || !/^[ぁ-ゖー]+$/.test(surface)) return undefined;
  const r = romanizeKatakana(toKatakana(surface));
  const lr = loose(r);
  if (lr.length < 4) return undefined;
  for (const sentence of translation.split(/(?<=[.!?])\s+/)) {
    const words = sentence.match(/[A-Za-z][A-Za-z'-]*/g) ?? [];
    for (let k = 0; k < words.length; k++) {
      const w = words[k].replace(/'s$/, '');
      const lw = loose(w);
      if (lw === lr && /^[A-Z]/.test(w) && k > 0) return w;
      if (lw.startsWith(lr) && /^(san|chan|kun|sama)$/.test(lw.slice(lr.length))) return r[0].toUpperCase() + r.slice(1);
      if (tagged && lw === lr) return r[0].toUpperCase() + r.slice(1);
    }
  }
  return undefined;
}
