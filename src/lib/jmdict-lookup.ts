import { readingAnywhere, kanjiAnywhere, setup as setupJmdict, Word, Gloss } from 'jmdict-wrapper';
import path from 'path';

let jmdictDb: any = null;

export async function initializeJmdict() {
  const jmdictPath = path.join(process.cwd(), 'jmdict-db');
  const jmdictFile = path.join(process.cwd(), 'jmdict-all-3.6.2.json');

  try {
    const result = await setupJmdict(jmdictPath, jmdictFile, false);
    jmdictDb = result.db;
    console.log(`[JMDict] Initialized with dictionary date: ${result.dictDate}`);
    return result;
  } catch (e) {
    console.error('[JMDict] Failed to initialize:', (e as any).message);
    throw e;
  }
}

export interface WordMeaning {
  gloss: string;
  partOfSpeech?: string[];
  tags?: string[];
}

export interface JmdictWord {
  kanji: string;
  reading: string;
  meanings: WordMeaning[];
  id: string;
}

export async function lookupWord(word: string): Promise<JmdictWord | null> {
  if (!jmdictDb) {
    console.warn('[JMDict] Database not initialized');
    return null;
  }

  try {
    // Try reading search first (pure hiragana)
    let results = await readingAnywhere(jmdictDb, word, 10);

    // If no results, try kanji search
    if (results.length === 0) {
      results = await kanjiAnywhere(jmdictDb, word, 10);
    }

    if (results.length === 0) {
      return null;
    }

    // Find the best match - exact match on reading or kanji
    let bestMatch = results.find(r =>
      r.kana.some(k => k.text === word) ||
      r.kanji.some(k => k.text === word)
    ) || results[0];

    // Extract meanings from senses (ordered by frequency)
    const meanings: WordMeaning[] = bestMatch.sense
      .filter(sense => sense.gloss && sense.gloss.length > 0)
      .map(sense => {
        const glossText = (sense.gloss as Gloss[])
          .filter(g => g.lang === 'en')
          .map(g => g.text)
          .join('; ') || (sense.gloss as Gloss[])[0]?.text || 'Unknown';

        return {
          gloss: glossText,
          partOfSpeech: sense.partOfSpeech,
          tags: [...(sense.field || []), ...(sense.misc || [])],
        };
      });

    // Get the best kanji representation
    const kanji = bestMatch.kanji[0]?.text || bestMatch.kana[0]?.text || word;
    const reading = bestMatch.kana[0]?.text || word;

    return {
      kanji,
      reading,
      meanings,
      id: bestMatch.id,
    };
  } catch (e) {
    console.error('[JMDict] Lookup failed for', word, ':', (e as any).message);
    return null;
  }
}
