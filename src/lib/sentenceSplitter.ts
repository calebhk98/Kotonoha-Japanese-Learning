/**
 * Japanese sentence splitter.
 *
 * Boundaries: a newline always ends a sentence; 。．！？!? end one when not
 * inside brackets/quotes (「こんにちは。元気？」と言った。 stays one sentence),
 * and any closing brackets right after the terminator stay attached to it.
 * An unclosed quote never swallows more than its line, because newlines
 * reset the bracket depth.
 *
 * Offsets index into the ORIGINAL string, so callers can map tokens back.
 */

export interface Sentence {
  text: string;
  start: number;
  end: number;
}

const TERMINATORS = new Set(['。', '．', '！', '？', '!', '?']);
const OPEN = new Set(['「', '『', '（', '(', '【', '〈', '《', '［', '〔', '“']);
const CLOSE = new Set(['」', '』', '）', ')', '】', '〉', '》', '］', '〕', '”']);

export function splitSentences(text: string): Sentence[] {
  const sentences: Sentence[] = [];
  let start = 0;
  let depth = 0;

  const push = (end: number) => {
    const raw = text.slice(start, end);
    const lead = raw.length - raw.trimStart().length;
    const trimmed = raw.trim();
    if (trimmed) sentences.push({ text: trimmed, start: start + lead, end: start + lead + trimmed.length });
    start = end;
  };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '\n') {
      push(i + 1);
      depth = 0;
    } else if (OPEN.has(ch)) {
      depth++;
    } else if (CLOSE.has(ch)) {
      depth = Math.max(0, depth - 1);
    } else if (TERMINATORS.has(ch) && depth === 0) {
      let j = i + 1;
      while (j < text.length && (TERMINATORS.has(text[j]) || CLOSE.has(text[j]))) j++;
      push(j);
      i = j - 1;
    }
  }
  push(text.length);
  return sentences;
}
