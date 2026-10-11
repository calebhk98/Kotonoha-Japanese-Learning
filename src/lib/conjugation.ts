/**
 * A short note on what a grouped verb's endings add to its dictionary
 * meaning: わかりません → "not · polite", 走っています → "-ing (ongoing) ·
 * polite". The tokenizer folds these endings (ます, ず, た, て + いる /
 * しまう / みる …) into the verb token, so without the note the hover shows
 * only "to understand" and the negation is lost (reader test on 9 stories:
 * もう来ません read as "already come"). Endings that stay their own tokens
 * (ない, たい, れる, させる) carry their own grammar labels.
 */
export interface MorphPart {
  surface: string;
  /** Sudachi normalized_form */
  norm: string;
  pos: string;
  conj: string;
}

const ASPECT: Record<string, string> = {
  居る: '-ing (ongoing)',
  てる: '-ing (ongoing)',
  仕舞う: 'completely / regretfully',
  見る: 'try doing',
  おく: 'in advance / for later',
  置く: 'in advance / for later',
  有る: 'has been done',
  行く: 'going on / away',
  来る: 'coming / starting to',
  呉れる: 'someone does it for me',
  貰う: 'have someone do it',
  上げる: 'do it for someone',
};

/**
 * @param headConj conjugation form of the verb's first morpheme (UniDic POS
 *   field 5, e.g. 連用形-一般, 命令形, 意志推量形)
 * @param parts the morphemes grouped after it, in order
 */
export function conjugationNote(headConj: string, parts: MorphPart[]): string | undefined {
  const labels = new Map<number, string>(); // rank → label (not, past, aspect, polite)
  for (const [k, m] of parts.entries()) {
    if (m.pos === '助動詞' && m.norm === 'ず') labels.set(0, 'not');
    else if (m.pos === '助動詞' && m.norm === 'た') labels.set(1, 'past');
    else if (m.pos === '助動詞' && m.norm === 'てる') labels.set(2, ASPECT['てる']);
    else if (m.pos === '動詞' && ASPECT[m.norm] && parts[k - 1] && /^[てで]$/.test(parts[k - 1].surface)) labels.set(2, ASPECT[m.norm]);
    else if (m.pos === '助動詞' && m.norm === 'ます') labels.set(3, 'polite');
  }
  const last = parts[parts.length - 1];
  if (last && last.pos === '助詞' && /^[てで]$/.test(last.surface)) labels.set(2.5, '-te form ("and …" / "-ing")');
  // Forms on the final verb itself (no ending needed): 待て, 行こう.
  const finalConj = [...parts].reverse().find((m) => m.pos === '動詞' || m.pos === '助動詞')?.conj ?? headConj;
  if (/^命令形/.test(finalConj)) labels.set(4, 'command');
  if (/^意志推量形/.test(finalConj)) labels.set(4, "let's / I'll");
  if (labels.size === 0) return undefined;
  return [...labels.entries()].sort((a, b) => a[0] - b[0]).map(([, l]) => l).join(' · ');
}
