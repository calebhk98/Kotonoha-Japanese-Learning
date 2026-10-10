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
    if (ns !== rs || loose(name)[0] !== loose(r)[0]) continue;
    // Two or more consonants must line up; a one-consonant name (Ella)
    // needs the whole loose spelling to match.
    if (rs.length >= 2 || loose(name) === loose(r)) return name;
  }
  return undefined;
}
