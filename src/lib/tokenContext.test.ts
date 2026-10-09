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
const none = async () => false;
const merge = (toks: PositionedToken[], text: string, hasForm = none, pos = async () => new Set<string>()) =>
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
});
