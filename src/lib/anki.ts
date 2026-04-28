import { WordInfo } from '../types';

export interface AnkiExportOptions {
  deckName: string;
  includeKnown: boolean;
  jlptFilter: number[]; // empty = all levels
}

export function generateAnkiExport(
  words: WordInfo[],
  knownWordSet: Set<string>,
  options: AnkiExportOptions
): string {
  let filtered = words;

  if (!options.includeKnown) {
    filtered = filtered.filter(w => !knownWordSet.has(w.word));
  }

  if (options.jlptFilter.length > 0) {
    filtered = filtered.filter(w => options.jlptFilter.includes(w.jlpt));
  }

  // Deduplicate by word string
  const seen = new Set<string>();
  filtered = filtered.filter(w => {
    if (seen.has(w.word)) return false;
    seen.add(w.word);
    return true;
  });

  const lines: string[] = [
    '#separator:tab',
    '#html:true',
    `#deck:${options.deckName}`,
    '#notetype:Basic',
    '#columns:Front\tBack\tTags',
    '',
  ];

  for (const word of filtered) {
    const jlptTag = word.jlpt > 0 ? `JLPT_N${word.jlpt}` : 'JLPT_native';
    const freqTags = (word.breakdown?.priorities ?? [])
      .map(p => `freq_${p}`)
      .join(' ');
    const tags = [jlptTag, freqTags].filter(Boolean).join(' ');

    const front = `<span style="font-size:2em;font-weight:bold">${word.word}</span><br><span style="color:#888;font-size:0.9em">${word.reading}</span>`;
    const back = word.meaning;

    lines.push(`${front}\t${back}\t${tags}`);
  }

  return lines.join('\n');
}

export function downloadAnkiFile(content: string, filename: string) {
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
