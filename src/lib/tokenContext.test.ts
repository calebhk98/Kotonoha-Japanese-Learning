import { describe, it, expect } from 'vitest';
import { conjugationNote } from './conjugation.js';
import { mergeFixedExpressions, mergeDictionaryWords, interjectionPos, isSaidAlone, type PositionedToken } from './tokenContext.js';

// Positioned tokens from (surface, posDetail) pairs laid out over `text`.
function lay(text: string, parts: [string, string[]][]): PositionedToken[] {
  let p = 0;
  return parts.map(([surface, posDetail]) => {
    const start = text.indexOf(surface, p);
    p = start + surface.length;
    return { surface, baseForm: surface, pos: posDetail[0], posDetail, reading: surface, startIndex: start, endIndex: p } as PositionedToken;
  });
}
const N = ['名詞', '普通名詞', '一般'];
const NAME = ['名詞', '固有名詞', '人名', '一般'];
const FIN = ['助詞', '終助詞'];
const none = async (_s?: string) => false;
const merge = (toks: PositionedToken[], text: string, hasForm = none, pos = async (_s: string) => new Set<string>()) =>
  mergeDictionaryWords(toks, text, hasForm, none, () => false, none, pos);

describe('colloquial endings (graded on folk tales)', () => {
  it('〜ておくれ is one request, not the 御 prefix + くれ', () => {
    const text = 'まかせておくれ';
    const out = mergeFixedExpressions(lay(text, [['まかせ', ['動詞']], ['て', ['助詞', '接続助詞']], ['お', ['接頭辞']], ['くれ', ['動詞']]]), text);
    expect(out.map((t) => t.surface)).toEqual(['まかせ', 'て', 'おくれ']);
    expect(out[2].fixed?.meaning).toMatch(/please/);
  });
  it('sentence-final か|い and わ|い are one particle', () => {
    const text = '行くかい。違うわい。';
    const out = mergeFixedExpressions(lay(text, [['行く', ['動詞']], ['か', FIN], ['い', FIN], ['。', ['補助記号']], ['違う', ['動詞']], ['わ', FIN], ['い', FIN], ['。', ['補助記号']]]), text);
    expect(out.map((t) => t.surface)).toEqual(['行く', 'かい', '。', '違う', 'わい', '。']);
  });
  it('clause-initial いい|や is the interjection "no"', () => {
    const text = 'いいや、違う。';
    const out = mergeFixedExpressions(lay(text, [['いい', ['形容詞']], ['や', FIN], ['、', ['補助記号']], ['違う', ['動詞']]]), text);
    expect(out[0].surface).toBe('いいや');
    expect(out[0].fixed?.meaning).toMatch(/\bno\b/);
  });
});

describe('katakana runs Sudachi fragments (graded on fiction and poems)', () => {
  it('joins a run with a short or name fragment into one unknown word', async () => {
    const text = 'アデリーナが笑った';
    const out = await merge(lay(text, [['アデリー', N], ['ナ', N], ['が', ['助詞', '格助詞']], ['笑った', ['動詞']]]), text);
    expect(out.map((t) => t.surface)).toEqual(['アデリーナ', 'が', '笑った']);
    expect(out[0].fixed?.meaning).toMatch(/katakana/i);
  });
  it('joins stammered name-like pieces too', async () => {
    const text = 'ナナナナナント';
    const out = await merge(lay(text, [['ナナ', NAME], ['ナナ', NAME], ['ナント', NAME]]), text);
    expect(out.map((t) => t.surface)).toEqual(['ナナナナナント']);
  });
  it('keeps two ordinary long loanwords separate', async () => {
    const text = 'コーヒーカップ';
    const out = await merge(lay(text, [['コーヒー', N], ['カップ', N]]), text);
    expect(out.map((t) => t.surface)).toEqual(['コーヒー', 'カップ']);
  });
});

describe('number-initial adverbs', () => {
  it('二|度|と is the adverb 二度と "never again"', async () => {
    const text = '二度と来ない';
    const toks = lay(text, [['二', ['名詞', '数詞']], ['度', ['名詞', '普通名詞', '助数詞可能']], ['と', ['助詞', '格助詞']], ['来', ['動詞']], ['ない', ['助動詞']]]);
    const out = await merge(toks, text, async (s) => s === '二度と', async (s) => new Set(s === '二度と' ? ['adv'] : []));
    expect(out[0].surface).toBe('二度と');
  });
  it('a bare number + counter never becomes an adverb headword (十|分 "ten minutes", not 十分 "enough")', async () => {
    const text = '十分待った';
    const toks = lay(text, [['十', ['名詞', '数詞']], ['分', ['名詞', '普通名詞', '助数詞可能']], ['待った', ['動詞']]]);
    const out = await merge(toks, text, async (s) => s === '十分', async (s) => new Set(s === '十分' ? ['adv', 'adj-na'] : []));
    expect(out.map((t) => t.surface)).toEqual(['十', '分', '待った']);
  });
});

describe('repeated sound words', () => {
  it('a run of one repeated katakana unit is left to the reduplication rule (グー|グー|グー)', async () => {
    const text = 'グーグーグー';
    const out = await merge(lay(text, [['グー', N], ['グー', N], ['グー', N]]), text);
    expect(out.map((t) => t.surface)).toEqual(['グー', 'グー', 'グー']);
  });
  it('a known word + a 2-char loanword stays split (チョコレート|バー composes)', async () => {
    const text = 'チョコレートバー';
    const out = await merge(lay(text, [['チョコレート', N], ['バー', N]]), text);
    expect(out.map((t) => t.surface)).toEqual(['チョコレート', 'バー']);
  });
  it('a trailing small-tsu stylization stays with its interjection (ギャー|ツ)', async () => {
    const text = 'ギャーツ';
    const out = await merge(lay(text, [['ギャー', ['感動詞']], ['ツ', N]]), text);
    expect(out.map((t) => t.surface)).toEqual(['ギャー', 'ツ']);
  });
});

describe('test6 patterns', () => {
  const NUM = ['名詞', '数詞'];
  it('adjacent rising digits are a range: 七|八 "7 or 8", 十|二|三 "12 or 13"', () => {
    const t1 = '七八ツ';
    const a = mergeFixedExpressions(lay(t1, [['七', NUM], ['八', NUM], ['ツ', ['接尾辞', '名詞的', '助数詞']]]), t1);
    expect(a[0].surface).toBe('七八');
    expect(a[0].fixed?.meaning).toMatch(/7 or 8/);
    const t2 = '十二三人';
    const b = mergeFixedExpressions(lay(t2, [['十', NUM], ['二', NUM], ['三', NUM], ['人', ['接尾辞', '名詞的', '一般']]]), t2);
    expect(b[0].surface).toBe('十二三');
    expect(b[0].fixed?.meaning).toMatch(/12 or 13/);
    const t3 = '二十三';
    const c = mergeFixedExpressions(lay(t3, [['二', NUM], ['十', NUM], ['三', NUM]]), t3);
    expect(c[0].fixed?.meaning).toMatch(/^23\b/);
  });
  it('clause-initial ところ|が、 and で|も、 are the conjunctions', () => {
    const t1 = 'ところが、雨';
    const a = mergeFixedExpressions(lay(t1, [['ところ', N], ['が', ['助詞', '格助詞']], ['、', ['補助記号']], ['雨', N]]), t1);
    expect(a[0]).toMatchObject({ surface: 'ところが', pos: '接続詞' });
    const t2 = 'でも、行かない';
    const b = mergeFixedExpressions(lay(t2, [['で', ['助詞', '格助詞']], ['も', ['助詞', '係助詞']], ['、', ['補助記号']], ['行かない', ['動詞']]]), t2);
    expect(b[0]).toMatchObject({ surface: 'でも', pos: '接続詞' });
    const t3 = '家でも、遊ぶ';
    const c = mergeFixedExpressions(lay(t3, [['家', N], ['で', ['助詞', '格助詞']], ['も', ['助詞', '係助詞']], ['、', ['補助記号']], ['遊ぶ', ['動詞']]]), t3);
    expect(c.map((t) => t.surface)).toContain('で');
  });
  it('noun + 共 never merges into 共に (猿共に is "to the monkeys")', async () => {
    const text = '猿共に';
    const out = await merge(lay(text, [['猿', N], ['共', N], ['に', ['助詞', '格助詞']]]), text, async (s) => s === '共に', async () => new Set(['adv']));
    expect(out.map((t) => t.surface)).toEqual(['猿', '共', 'に']);
  });
});


// Graded on 100 random corpus items: beginner texts write everyday words in
// kana and Sudachi fragments the ones UniDic lacks in kana.
describe('kana words Sudachi fragments (100-item review)', () => {
  const SUF = ['接尾辞', '名詞的', '一般'];
  const NUM = ['名詞', '数詞'];
  const words: Record<string, string[]> = {
    じてんしゃ: ['n'], かいしゃ: ['n'], かいさつ: ['n', 'vs'], はっけん: ['n', 'vs'], あるく: ['v5k', 'vi'], かえる: ['v5r', 'vi'],
  };
  const common = async (s: string) => new Set(words[s] ?? []);
  const mergeK = (toks: PositionedToken[], text: string) =>
    mergeDictionaryWords(toks, text, none, none, () => false, none, async () => new Set(), common);

  it('joins kana pieces into a common word written in kanji (じてん|しゃ → 自転車)', async () => {
    const text = 'じてんしゃに のって';
    const out = await mergeK(lay(text, [['じてん', N], ['しゃ', SUF], ['に', ['助詞', '格助詞']], ['のって', ['動詞']]]), text);
    expect(out.map((t) => t.surface)).toEqual(['じてんしゃ', 'に', 'のって']);
    expect(out[0].baseForm).toBe('じてんしゃ');
  });
  it('a stray single kana or kana numeral marks the fragment (かいさ|つ, はっ|けん)', async () => {
    const t1 = 'かいさつの ほう';
    expect((await mergeK(lay(t1, [['かいさ', NAME], ['つ', ['助詞', '副助詞']], ['の', ['助詞', '格助詞']], ['ほう', N]]), t1))[0].surface).toBe('かいさつ');
    const t2 = 'はっけんの';
    expect((await mergeK(lay(t2, [['はっ', NUM], ['けん', SUF], ['の', ['助詞', '格助詞']]]), t2))[0].surface).toBe('はっけん');
  });
  it('never joins across a particle or two ordinary words', async () => {
    const t1 = 'あかい';
    // (あ|か is not a candidate: か is a particle)
    expect((await mergeK(lay(t1, [['あ', ['感動詞']], ['か', ['助詞', '終助詞']], ['い', ['動詞']]]), t1)).map((t) => t.surface)).toEqual(['あ', 'か', 'い']);
    const t2 = 'かいしゃ';
    // Both pieces ordinary nouns, under five kana: no fragment evidence.
    expect((await mergeK(lay(t2, [['かい', N], ['しゃ', N]]), t2)).map((t) => t.surface)).toEqual(['かい', 'しゃ']);
  });
  it('re-joins a kana volitional Sudachi split (ある|こう → 歩こう)', async () => {
    const text = 'あるこう あるこう';
    const out = await mergeK(lay(text, [['ある', ['連体詞']], ['こう', ['副詞']], ['ある', ['連体詞']], ['こう', ['副詞']]]), text);
    expect(out.map((t) => t.surface)).toEqual(['あるこう', 'あるこう']);
    expect(out[0].baseForm).toBe('あるく');
    expect(out[0].pos).toBe('動詞');
    // UniDic field 5 is the conjugation form; the hover note reads it
    // (reader test 2: あるこう showed no "let's").
    expect(conjugationNote(out[0].posDetail?.[5] ?? '*', [])).toBe("let's / I'll");
  });
  // After a kanji conversion of the line before, Sudachi tags the ある of
  // the repeated あるこう as the verb 有る (Sanpo: "to exist" + "like this").
  it('re-joins ある|こう when ある is tagged as a verb', async () => {
    const text = 'あるこう';
    const out = await mergeK(lay(text, [['ある', ['動詞']], ['こう', ['副詞']]]), text);
    expect(out.map((t) => t.surface)).toEqual(['あるこう']);
  });
  it('five or more kana may be cut through an interjection/adverb (うん|どう|かい → 運動会)', async () => {
    const text = 'うんどうかいは';
    const out = await mergeDictionaryWords(lay(text, [['うん', ['感動詞']], ['どう', ['副詞']], ['かい', N], ['は', ['助詞', '係助詞']]]), text, none, none, () => false, none, async () => new Set(), async (s) => new Set(s === 'うんどうかい' ? ['n'] : []));
    expect(out[0].surface).toBe('うんどうかい');
  });
});

describe('sentence-level kana patterns (100-item review)', () => {
  const P = (p1: string) => ['助詞', p1];
  it('sentence-initial で|も is the conjunction "but", comma or not', () => {
    const text = '「でも赤ぐみが強い」';
    const out = mergeFixedExpressions(lay(text, [['で', P('格助詞')], ['も', P('係助詞')], ['赤', N]]), text);
    expect(out[0].surface).toBe('でも');
    expect(out[0].pos).toBe('接続詞');
    const mid = '家でも本';
    expect(mergeFixedExpressions(lay(mid, [['家', N], ['で', P('格助詞')], ['も', P('係助詞')], ['本', N]]), mid).map((t) => t.surface)).toEqual(['家', 'で', 'も', '本']);
  });
  it('〜てはいけない is "must not"', () => {
    const text = 'はしってはいけない';
    const out = mergeFixedExpressions(lay(text, [['はしって', ['動詞']], ['は', P('係助詞')], ['いけ', ['動詞']], ['ない', ['助動詞']]]), text);
    expect(out.map((t) => t.surface)).toEqual(['はしって', 'は', 'いけない']);
    expect(out[2].fixed?.meaning).toMatch(/must not/);
  });
  it('one-kana nouns: てを is 手 "hand", ももの き is 木 "tree", すずめのこ is 子 "child"', () => {
    const t1 = 'てを あらう';
    expect(mergeFixedExpressions(lay(t1, [['て', P('副助詞')], ['を', P('格助詞')], ['あらう', ['動詞']]]), t1)[0].fixed?.meaning).toMatch(/hand/);
    const t2 = 'ももの きが';
    expect(mergeFixedExpressions(lay(t2, [['もも', N], ['の', P('格助詞')], ['き', ['動詞']], ['が', P('格助詞')]]), t2)[2].fixed?.meaning).toMatch(/tree/);
    const t3 = 'すずめのこ。';
    expect(mergeFixedExpressions(lay(t3, [['すずめ', N], ['の', P('格助詞')], ['こ', N]]), t3)[2].fixed?.meaning).toMatch(/child/);
    // て after a verb stays the te-form.
    const t4 = 'たべてを';
    expect(mergeFixedExpressions(lay(t4, [['たべ', ['動詞']], ['て', P('接続助詞')], ['を', P('格助詞')]]), t4)[1].fixed).toBeUndefined();
  });
});

describe('merged headword must fit the pieces\' readings (100-item review)', () => {
  it('外|に read そと+に is "outside", not the headword 外に (ほかに "else")', async () => {
    const text = '外に出た';
    const toks = lay(text, [['外', N], ['に', ['助詞', '格助詞']], ['出た', ['動詞']]]);
    toks[0].reading = 'そと';
    const has = async (s: string) => s === '外に';
    const readings = async (s: string) => new Set(s === '外に' ? ['ほかに'] : []);
    const out = await mergeDictionaryWords(toks, text, has, none, () => false, none, async () => new Set(['adv']), async () => new Set(), readings);
    expect(out.map((t) => t.surface)).toEqual(['外', 'に', '出た']);
    toks[0].reading = 'ほか';
    const out2 = await mergeDictionaryWords(toks, text, has, none, () => false, none, async () => new Set(['adv']), async () => new Set(), readings);
    expect(out2[0].surface).toBe('外に');
  });
});

// Reader test: 二|十分 and 五|十分 read "two … enough" / "five … enough";
// １|５分 lost its 1.
describe('number + 分 is N minutes', () => {
  const NUM = ['名詞', '数詞'];
  const CTR = ['名詞', '普通名詞', '助数詞可能'];
  it('二|十分 is 20 minutes (にじゅっぷん); 五|十分 50 minutes', () => {
    const t1 = '二十分です';
    const out = mergeFixedExpressions(lay(t1, [['二', NUM], ['十分', ['形状詞', '一般']], ['です', ['助動詞']]]), t1);
    expect(out[0].surface).toBe('二十分');
    expect(out[0].fixed).toEqual({ meaning: '20 minutes', reading: 'にじゅっぷん' });
    const t2 = '五十分で';
    expect(mergeFixedExpressions(lay(t2, [['五', NUM], ['十分', ['形状詞', '一般']], ['で', ['助詞']]]), t2)[0].fixed?.meaning).toBe('50 minutes');
  });
  it('１|５分 keeps every digit; 三十|分 is one token', () => {
    const t1 = '１５分かかる';
    const out = mergeFixedExpressions(lay(t1, [['１', NUM], ['５分', ['名詞', '普通名詞', '一般']], ['かかる', ['動詞']]]), t1);
    expect(out[0]).toMatchObject({ surface: '１５分', fixed: { meaning: '15 minutes', reading: 'じゅうごふん' } });
    const t2 = '三十分後';
    const out2 = mergeFixedExpressions(lay(t2, [['三', NUM], ['十', NUM], ['分', CTR], ['後', ['接尾辞']]]), t2);
    expect(out2[0]).toMatchObject({ surface: '三十分', fixed: { meaning: '30 minutes', reading: 'さんじゅっぷん' } });
  });
  it('a fraction is not minutes (三分の一 "one third")', () => {
    const t = '三分の一';
    const out = mergeFixedExpressions(lay(t, [['三', ['名詞', '数詞']], ['分', ['名詞', '普通名詞', '助数詞可能']], ['の', ['助詞', '格助詞']], ['一', ['名詞', '数詞']]]), t);
    expect(out[0].surface).toBe('三');
  });
  it('十分 alone stays "enough"', () => {
    const t = '時間は十分ある';
    const out = mergeFixedExpressions(lay(t, [['時間', N], ['は', ['助詞', '係助詞']], ['十分', ['副詞']], ['ある', ['動詞']]]), t);
    expect(out[2].fixed).toBeUndefined();
  });
});

// Random-story grading (10 unseen stories): split grammar and counters
// read as the wrong word.
describe('random-story grading fixes', () => {
  const V = ['動詞', '一般'];
  it('verb + の|に is のに "although", not nominalizer + "to / at"', () => {
    const text = '送ったのに、届かない。';
    const out = mergeFixedExpressions(lay(text, [['送った', V], ['の', ['助詞', '準体助詞']], ['に', ['助詞', '格助詞']], ['、', ['補助記号']], ['届かない', V]]), text);
    expect(out.map((t) => t.surface)).toContain('のに');
    expect(out.find((t) => t.surface === 'のに')?.fixed?.meaning).toMatch(/although/);
  });
  // All-items diff review: のに after a dictionary-form verb is usually a
  // purpose (表すのに使います "used to show"), and の|に can be pronoun + に
  // (大きいのにしよう "let's take the big one") or の + に従って.
  it('のに merges only in a concessive context (past, なのに, or before a comma)', () => {
    const V2 = ['動詞', '一般'];
    const merged = (text: string, parts: [string, string[]][]) => mergeFixedExpressions(lay(text, parts), text).some((t) => t.surface === 'のに');
    const NO = ['助詞', '準体助詞'];
    const NI = ['助詞', '格助詞'];
    expect(merged('まけたのに、わらった。', [['まけた', V2], ['の', NO], ['に', NI]])).toBe(true);
    expect(merged('はずなのに来ない', [['はず', N], ['な', ['助動詞']], ['の', NO], ['に', NI]])).toBe(true);
    expect(merged('いるのに、だまっていた', [['いる', V2], ['の', NO], ['に', NI]])).toBe(true);
    expect(merged('表すのに使います', [['表す', V2], ['の', NO], ['に', NI], ['使います', V2]])).toBe(false);
    expect(merged('抜けるのに従って', [['抜ける', V2], ['の', NO], ['に', NI]])).toBe(false);
    expect(merged('大きいのにしよう', [['大きい', ['形容詞']], ['の', NO], ['に', NI], ['しよう', V2]])).toBe(false);
  });
  it('…のには (purpose, topic) stays split', () => {
    const text = '行くのには時間がかかる。';
    const out = mergeFixedExpressions(lay(text, [['行く', V], ['の', ['助詞', '準体助詞']], ['に', ['助詞', '格助詞']], ['は', ['助詞', '係助詞']]]), text);
    expect(out.map((t) => t.surface)).not.toContain('のに');
  });
  it('noun が|たり|ない is 足りない "not enough", not the listing たり', () => {
    const text = 'かみが たりない。';
    const out = mergeFixedExpressions(lay(text, [['かみ', N], ['が', ['助詞', '格助詞']], ['たり', ['助詞', '副助詞']], ['ない', ['助動詞']]]), text);
    expect(out.map((t) => t.surface)).toContain('たりない');
    expect(out.find((t) => t.surface === 'たりない')?.fixed?.meaning).toMatch(/not enough/);
  });
  it('verb たり|ない listing is left alone', () => {
    const text = '見たりない';
    const out = mergeFixedExpressions(lay(text, [['見', V], ['たり', ['助詞', '副助詞']], ['ない', ['助動詞']]]), text);
    expect(out.map((t) => t.surface)).not.toContain('たりない');
  });
  it('名 after a number is the counter for people, not "first name"', () => {
    const text = '参加者は十五名です。';
    const out = mergeFixedExpressions(lay(text, [['参加者', N], ['は', ['助詞']], ['十五', ['名詞', '数詞']], ['名', ['接尾辞', '名詞的', '助数詞']], ['です', ['助動詞']]]), text);
    const mei = out.find((t) => t.surface === '名');
    expect(mei?.fixed?.meaning).toMatch(/counter for people/);
    expect(mei?.fixed?.reading).toBe('めい');
  });
  it('め / 目 after a counted number is the ordinal "-th", not "eye"', () => {
    const text = 'いちまい めの かみ。二回目です。';
    const out = mergeFixedExpressions(
      lay(text, [['いちまい', ['名詞', '数詞']], ['め', N], ['の', ['助詞']], ['かみ', N], ['二', ['名詞', '数詞']], ['回', ['接尾辞', '名詞的', '助数詞']], ['目', ['接尾辞', '名詞的', '一般']], ['です', ['助動詞']]]),
      text
    );
    expect(out.filter((t) => /^[め目]$/.test(t.surface)).map((t) => t.fixed?.meaning)).toEqual([expect.stringMatching(/-th/), expect.stringMatching(/-th/)]);
  });
  it('め after an ordinary noun is untouched', () => {
    const text = 'いぬの め。';
    const out = mergeFixedExpressions(lay(text, [['いぬ', N], ['の', ['助詞']], ['め', N]]), text);
    expect(out.find((t) => t.surface === 'め')?.fixed).toBeUndefined();
  });
});

describe('interjectionPos', () => {
  // Random-story grading: 「いたい！」 became the interjection いたい, looked
  // up by kana as 遺体 "corpse"; 「だいじょうぶ？」 lost its 大丈夫 key.
  it('keeps adjectives, na-adjectives and verbs that open an exclamation', () => {
    const text = 'いたい！だいじょうぶ？まって！';
    const toks = lay(text, [['いたい', ['形容詞', '一般']], ['だいじょうぶ', ['形状詞', '一般']], ['まって', ['動詞', '一般']]]);
    expect(toks.map((t) => interjectionPos(text, t))).toEqual([undefined, undefined, undefined]);
  });
  it('still turns a sentence-opening pronoun into an interjection (あれ～？)', () => {
    const text = 'あれ～？';
    expect(interjectionPos(text, lay(text, [['あれ', ['代名詞']]])[0])).toBe('感動詞');
  });
});

describe('isSaidAlone: a word at a clause start that is the whole utterance', () => {
  const say = (text: string, word: string, particles = 0) => {
    const start = text.indexOf(word);
    return isSaidAlone(text, start, start + word.length + particles, particles > 0);
  };
  it('ごめんね、 inside a quote, after an address, is an apology', () => {
    expect(say('「ゆうた！ ごめんね、電車が止まっていて」', 'ごめん', 1)).toBe(true);
  });
  it('a bare 「ただいま」 and ごめん！ still count', () => {
    expect(say('「ただいま」', 'ただいま')).toBe(true);
    expect(say('ごめん！遅れた', 'ごめん')).toBe(true);
  });
  it('a comma alone (no sentence-final particle) does not make an utterance', () => {
    expect(say('ごめん、それは無理だ。', 'ごめん')).toBe(false);
  });
  it('narration is not an utterance', () => {
    expect(say('先生はごめんと言った。', 'ごめん')).toBe(false);
    expect(say('おしまい。', 'おしまい')).toBe(false);
  });
});
