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

