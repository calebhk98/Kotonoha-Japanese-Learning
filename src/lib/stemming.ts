/**
 * Japanese verb stemming for dictionary lookups
 * Converts conjugated forms back to dictionary form (基本形)
 */

// Map of masu-stem variations to their base form endings
const masuStemToBaseEndings: Record<string, string[]> = {
  'き': ['く'],           // 書く → 書き
  'ぎ': ['ぐ'],           // 読ぐ → 読み
  'ち': ['つ'],           // 立つ → 立ち
  'し': ['す'],           // 示す → 示し
  'び': ['ぶ'],           // 運ぶ → 運び
  'み': ['む'],           // 飲む → 飲み
  'に': ['ぬ'],           // 死ぬ → 死に
  'り': ['る', 'う'],     // 売る/歌う → 売り/歌い
};

// For negative form: ~ない before the い
const negativeToBase: Record<string, string[]> = {
  'か': ['く'],
  'が': ['ぐ'],
  'た': ['つ'],
  'さ': ['す'],
  'ば': ['ぶ'],
  'ま': ['む'],
  'な': ['ぬ'],
  'ら': ['る', 'う'],
};

export function stemJapaneseWord(word: string): string[] {
  const stems: string[] = [word]; // Always include the original word first

  // Don't try to stem very short words
  if (word.length < 2) return stems;

  // Polite past: ~ました → extract masu stem
  if (word.endsWith('ました')) {
    const masuStem = word.slice(0, -3); // Remove ました
    stems.push(masuStem); // Try as-is (might be 一段)
    // Try to convert masu stem to dictionary form
    const lastChar = masuStem.slice(-1);
    if (lastChar in masuStemToBaseEndings) {
      const base = masuStem.slice(0, -1);
      for (const ending of masuStemToBaseEndings[lastChar]) {
        stems.push(base + ending);
      }
    }
  }

  // Polite negative: ~ません
  if (word.endsWith('ません')) {
    const masuStem = word.slice(0, -3);
    stems.push(masuStem);
    const lastChar = masuStem.slice(-1);
    if (lastChar in masuStemToBaseEndings) {
      const base = masuStem.slice(0, -1);
      for (const ending of masuStemToBaseEndings[lastChar]) {
        stems.push(base + ending);
      }
    }
  }

  // Polite present: ~ます
  if (word.endsWith('ます')) {
    const masuStem = word.slice(0, -2);
    stems.push(masuStem);
    const lastChar = masuStem.slice(-1);
    if (lastChar in masuStemToBaseEndings) {
      const base = masuStem.slice(0, -1);
      for (const ending of masuStemToBaseEndings[lastChar]) {
        stems.push(base + ending);
      }
    }
  }

  // Want to: ~たい → base + る/う
  if (word.endsWith('たい')) {
    const base = word.slice(0, -2);
    stems.push(base + 'る', base + 'う');
  }

  // Negative: ~ない → extract the negation root and try to add verb endings
  if (word.endsWith('ない')) {
    const beforeNai = word.slice(0, -2);
    if (beforeNai.length > 0) {
      stems.push(beforeNai); // Try as-is
      const lastChar = beforeNai.slice(-1);
      if (lastChar in negativeToBase) {
        const base = beforeNai.slice(0, -1);
        for (const ending of negativeToBase[lastChar]) {
          stems.push(base + ending);
        }
      }
      // Also try adding common verb endings
      stems.push(beforeNai + 'る', beforeNai + 'う');
    }
  }

  // Na-adjective: ~な → remove な
  if (word.endsWith('な') && word.length > 2 && !/^[ぁ-ん]{1,2}$/.test(word)) {
    stems.push(word.slice(0, -1));
  }

  // I-adjective past: ~かった
  if (word.endsWith('かった')) {
    stems.push(word.slice(0, -3));
  }

  // Past te-form: ~ている → stem+いる form
  if (word.endsWith('ている')) {
    const base = word.slice(0, -3);
    stems.push(base + 'う', base + 'る');
  }

  // Potential: ~られる
  if (word.endsWith('られる')) {
    const base = word.slice(0, -4);
    stems.push(base + 'る');
  }

  // Potential: ~える (ichidan potential)
  if (word.endsWith('える')) {
    const base = word.slice(0, -2);
    stems.push(base + 'る');
  }

  // Causative: ~させる
  if (word.endsWith('させる')) {
    const base = word.slice(0, -3);
    stems.push(base + 'す');
  }

  // Te-form conditional: ~て
  if (word.endsWith('て')) {
    const base = word.slice(0, -1);
    // Try consonant-stem verbs
    stems.push(base + 'う', base + 'る', base + 'つ', base + 'く', base + 'ぐ');
  }

  // Remove duplicates, keep order, and return
  return [...new Set(stems)];
}

export function getWordForDictLookup(word: string, dictionary: any): { found: string; stems: string[] } {
  const stems = stemJapaneseWord(word);

  // Try each stem in order
  for (const stem of stems) {
    // Use the kanjiData.searchWords to check if word exists
    const results = dictionary.searchWords(stem) as any[];
    if (results && results.length > 0) {
      return { found: stem, stems };
    }
  }

  // If nothing found, return original word
  return { found: word, stems };
}
