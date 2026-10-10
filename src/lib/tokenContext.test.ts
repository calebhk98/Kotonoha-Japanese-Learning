import { describe, it, expect } from 'vitest';
import { mergeFixedExpressions, mergeDictionaryWords, type PositionedToken } from './tokenContext.js';

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
