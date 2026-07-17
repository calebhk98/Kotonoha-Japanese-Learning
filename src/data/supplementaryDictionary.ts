/**
 * Supplementary dictionary (issue #257).
 *
 * Curated entries for words the local waterfall (JMDict → JMnedict →
 * kanji-data) cannot resolve — or resolves to the WRONG entry: story
 * character names (なつき is the hitori-series protagonist, not 夏季
 * "summer season"), author coinages (Miyazawa's 雪童), folk-song chants,
 * and company/place names invented for stories.
 *
 * Consulted by WordResolver BEFORE the dictionary waterfall, so entries
 * here override JMDict homographs. Keep it curated: only add words that
 * appear in committed content and are wrong/unknown through the normal
 * waterfall. After editing, run `npm run resolve-content -- --all` and
 * commit the artifact diff.
 */

export interface SupplementaryEntry {
  reading: string;
  meaning: string;
}

export const SUPPLEMENTARY_DICTIONARY: Record<string, SupplementaryEntry> = {
  // ── Story character / person names ─────────────────────────────────────
  なつき: { reading: 'なつき', meaning: 'Natsuki (story protagonist; given name)' },
  ユウタ: { reading: 'ゆうた', meaning: 'Yuta (story character; given name)' },
  コッペ: { reading: 'こっぺ', meaning: 'Koppe (bakery character; from コッペパン, a bread roll)' },
  シラクス: { reading: 'しらくす', meaning: 'Syracuse (Sicilian city; setting of Run, Melos!)' },
  アレキス: { reading: 'あれきす', meaning: 'Alexis (story character; given name)' },
  イサド: { reading: 'いさど', meaning: 'Isado (place name in Miyazawa\'s Yamanashi)' },
  杜陵: { reading: 'とりょう', meaning: 'Toryo (place name in Miyazawa\'s work)' },
  中芳: { reading: 'なかよし', meaning: 'Nakayoshi (name in Mimi-nashi Hoichi)' },
  田中商事: { reading: 'たなかしょうじ', meaning: 'Tanaka Trading Co. (fictional company)' },
  赤間ヶ関: { reading: 'あかまがせき', meaning: 'Akamagaseki (old name for Shimonoseki; Mimi-nashi Hoichi setting)' },
  田子の浦: { reading: 'たごのうら', meaning: 'Tago-no-ura (bay famous from Hyakunin Isshu poetry)' },
  讃州: { reading: 'さんしゅう', meaning: 'Sanshu (old name for Sanuki province, Shikoku)' },
  象頭: { reading: 'ぞうず', meaning: 'Zozu (mountain at Kotohira shrine; from the Konpira folk song)' },
  ペンパ: { reading: 'ぺんぱ', meaning: 'Penpa (pen-pal name in a letter story)' },

  // ── Author coinages (Kenji Miyazawa etc.) ──────────────────────────────
  雪童: { reading: 'ゆきわらべ', meaning: 'snow child (Miyazawa coinage: a snow spirit)' },
  雪狼: { reading: 'ゆきおいの', meaning: 'snow wolf (Miyazawa coinage)' },
  犍: { reading: 'けん', meaning: 'Kandata (犍陀多) — sinner in The Spider\'s Thread (rare transliteration kanji)' },
  囘: { reading: 'かい', meaning: 'archaic form of 回 (turn / time)' },

  // ── Folk-song chants & vocalizations (no lexical meaning) ──────────────
  ヤーレン: { reading: 'やーれん', meaning: 'folk-song chant (Soran Bushi call; no literal meaning)' },
  デデレコデン: { reading: 'ででれこでん', meaning: 'folk-song chant imitating drum sounds (Kokiriko Bushi)' },
  ポンポコリン: { reading: 'ぽんぽこりん', meaning: 'nonsense chant (belly-drum sound; Odoru Ponpokorin)' },
  アンアン: { reading: 'あんあん', meaning: 'nonsense chant / crying sound (Doraemon theme)' },
  ヲゥ: { reading: 'をぅ', meaning: 'vocalized chant (Okinawan folk song)' },
  ニーギ: { reading: 'にーぎ', meaning: 'chant syllables (Ponyo theme song)' },
  フーク: { reading: 'ふーく', meaning: 'chant syllables (Ponyo theme song)' },
  ピョー: { reading: 'ぴょー', meaning: 'whistling / bird-call sound' },
  証城: { reading: 'しょうじょう', meaning: 'Shojo (from 証城寺 Shojoji temple; tanuki folk song)' },
  シュラ: { reading: 'しゅら', meaning: 'chant syllable (Konpira Fune Fune folk song)' },

  // ── Ritual / literary one-offs ─────────────────────────────────────────
  入禅: { reading: 'にゅうぜん', meaning: 'entering Zen meditation (temple ritual; Mimi-nashi Hoichi)' },
  繋舟: { reading: 'けいしゅう', meaning: 'moored boat (literary; Run, Melos!)' },
  随臣: { reading: 'ずいしん', meaning: 'attendant nobles (figures in a hina-doll set)' },
  耳無: { reading: 'みみなし', meaning: 'earless ("Mimi-nashi" Hoichi, the earless minstrel)' },
  やせ蛙: { reading: 'やせがえる', meaning: 'skinny frog (from Issa\'s famous haiku)' },

  // ── Brands / modern coinages / abbreviations ───────────────────────────
  ポカリ: { reading: 'ぽかり', meaning: 'Pocari (sports drink; short for Pocari Sweat)' },
  マネーフォワード: { reading: 'まねーふぉわーど', meaning: 'Money Forward (Japanese budgeting app / company)' },
  農振: { reading: 'のうしん', meaning: 'agricultural promotion (abbreviation of 農業振興)' },
  '2025年問題': { reading: 'にせんにじゅうごねんもんだい', meaning: 'the "2025 problem" (Japan\'s aging-population milestone)' },
  年版: { reading: 'ねんばん', meaning: '(year) edition (as in 2024年版 "2024 edition")' },
  てぃんさぐ: { reading: 'てぃんさぐ', meaning: 'balsam flower (Okinawan; from Tinsagu nu Hana)' },
};

export function getSupplementaryEntry(word: string): SupplementaryEntry | undefined {
  return SUPPLEMENTARY_DICTIONARY[word];
}
