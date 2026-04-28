import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import kanjiData from "kanji-data";
import kuromoji from "kuromoji";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let tokenizer: kuromoji.Tokenizer<kuromoji.IpadicFeatures> | null = null;
kuromoji.builder({ dicPath: 'node_modules/kuromoji/dict' }).build((err, t) => {
  if (err) {
    console.error("Failed to build kuromoji tokenizer:", err);
  } else {
    tokenizer = t;
    console.log("Kuromoji tokenizer ready");
  }
});

// Determine the JLPT level of a word based on the hardest kanji in it (N1 is hardest, N5 is easiest).
// jlpt ranges from 1 to 5. We return 5 for no kanji (kana).
// We return 0 if no JLPT kanji is found but it has kanji.
function getWordScoreBreakdown(wordStr: string, variant: any) {
  let hardestJlpt = 6; 
  let hasKanji = false;
  let allJoyo = true;
  let highestGrade: number | null = null;
  
  const jlptValues: number[] = [];
  const gradeValues: number[] = [];

  let kanjis = kanjiData.extractKanji(wordStr);

  if (kanjis.length > 0) {
    hasKanji = true;
    for (const k of kanjis) {
      const meta = kanjiData.get(k);
      if (meta) {
        if (meta.jlpt !== null && meta.jlpt !== undefined) {
          jlptValues.push(meta.jlpt);
          if (meta.jlpt < hardestJlpt) {
            hardestJlpt = meta.jlpt;
          }
        } else {
          jlptValues.push(0);
          hardestJlpt = 0;
        }

        if (meta.grade === null || meta.grade > 8) {
          allJoyo = false;
        } else {
          gradeValues.push(meta.grade);
        }
        
        if (meta.grade !== null) {
          highestGrade = highestGrade === null ? meta.grade : Math.max(highestGrade, meta.grade);
        } else {
          highestGrade = 9; // Not joyo / unknown
        }
      }
    }
  }

  let finalJlpt = 5;
  if (hasKanji) {
    if (hardestJlpt === 0) finalJlpt = 0;
    else if (hardestJlpt !== 6) finalJlpt = hardestJlpt;
  }

  let jlptScore = 15;
  if (finalJlpt === 4) jlptScore = 30;
  else if (finalJlpt === 3) jlptScore = 50;
  else if (finalJlpt === 2) jlptScore = 70;
  else if (finalJlpt === 1) jlptScore = 90;
  else if (finalJlpt === 0) jlptScore = 100;

  let joyoPenalty = 0;
  if (hasKanji && highestGrade !== null) {
    if (highestGrade === 1) joyoPenalty = 5;
    else if (highestGrade === 2) joyoPenalty = 7;
    else if (highestGrade === 3) joyoPenalty = 10;
    else if (highestGrade === 4) joyoPenalty = 12;
    else if (highestGrade === 5) joyoPenalty = 15;
    else if (highestGrade === 6) joyoPenalty = 20;
    else if (highestGrade === 8) joyoPenalty = 25;
    else if (highestGrade >= 9) joyoPenalty = 30;
  }

  const priorities = variant?.priorities || [];
  
  // Predict frequency
  let freqPenalty = 50; // Default penalty for VERY rare words (Bucket 10)
  
  if (variant === null) {
      // Very short hiragana are likely common particles/expressions
      if (/^[ぁ-ん]{1,3}$/.test(wordStr)) {
        freqPenalty = -20; // Common Kana expression (Bucket 1)
      }
  } else {
      if (priorities.some((p: string) => p === 'news1' || p === 'ichi1')) {
          freqPenalty = -20; // Top 10k/12k common (Bucket 1)
      } else if (priorities.some((p: string) => p === 'news2' || p === 'ichi2')) {
          freqPenalty = -10; // Next 10k/12k common (Bucket 2)
      } else if (priorities.some((p: string) => p === 'gai1' || p === 'spec1')) {
          freqPenalty = 0; // Common loan or spec words (Bucket 3)
      } else if (priorities.some((p: string) => p === 'gai2' || p === 'spec2')) {
          freqPenalty = 5; // Common loan or spec words 2 (Bucket 4)
      } else if (priorities.some((p: string) => p.startsWith('nf'))) {
         const nfTag = priorities.find((p: string) => p.startsWith('nf'));
         const rank = parseInt(nfTag.replace('nf', ''), 10); // nf01 to nf48
         // Total 48 ranks, spread across remaining buckets (5 to 9)
         if (rank <= 5) freqPenalty = 10; // Bucket 5
         else if (rank <= 10) freqPenalty = 15; // Bucket 6
         else if (rank <= 20) freqPenalty = 20; // Bucket 7
         else if (rank <= 30) freqPenalty = 30; // Bucket 8
         else freqPenalty = 40; // Bucket 9
      } else {
         // Has a dictionary entry but no priority tags
         freqPenalty = 50; // Very rare word (Bucket 10)
      }
  }

  // Adjust score based on frequency
  let score = Math.min(100, Math.max(1, jlptScore + joyoPenalty + freqPenalty));

  return {
    jlpt: finalJlpt,
    joyo: allJoyo,
    score,
    breakdown: {
      jlptScore,
      joyoPenalty,
      highestGrade,
      freqPenalty,
      jlptValues,
      gradeValues,
      priorities
    }
  };
}

const wordsCache = new Map<string, any>();

function getCachedDictionaryEntries(wordStr: string) {
  if (wordsCache.has(wordStr)) return wordsCache.get(wordStr);
  const entries = kanjiData.searchWords(wordStr);
  wordsCache.set(wordStr, entries);
  return entries;
}

function processText(text: string) {
  if (!tokenizer) throw new Error("Tokenizer not ready");
  const tokens = tokenizer.tokenize(text);
  
  const particles = new Set(["は", "が", "を", "に", "へ", "と", "で", "も", "か", "の", "て", "な", "だ"]);
  const punctuation = /[、。！？・「」『』（）()[\]a-zA-Z0-9\s]/;

  const validWords = new Set<string>();

  for (const token of tokens) {
    const seg = token.surface_form;
    if (seg.trim() === '') continue;
    if (punctuation.test(seg)) continue;
    if (seg.length === 1 && (particles.has(seg) || /[ぁ-ん]/.test(seg))) continue; // skip 1 char hiragana
    
    // Use basic_form if possible
    let wordToSave = token.basic_form && token.basic_form !== '*' ? token.basic_form : token.surface_form;
    if (wordToSave.length === 1 && (particles.has(wordToSave) || /[ぁ-ん]/.test(wordToSave))) continue;

    validWords.add(wordToSave);
  }

  const results = [];
  for (const wordStr of validWords) {
    let meaning = "Unknown meaning";
    let reading = wordStr;
    let variant = null;
    
    const dictionaryEntries = getCachedDictionaryEntries(wordStr);
    
    let bestEntry = null;
    let bestVariant = null;
    let bestVariantScore = -999;

    for (const entry of dictionaryEntries) {
      if (!entry.variants) continue;
      for (const v of entry.variants) {
        if (v.written === wordStr || v.pronounced === wordStr) {
          let s = 0;
          if (v.written === wordStr) s += 100;
          if (v.priorities && v.priorities.length > 0) s += 50;
          
          const isHiragana = /^[ぁ-ん]+$/.test(wordStr);
          const hasKanjiObj = /[\u4e00-\u9faf]/.test(v.written);
          
          if (v.written !== wordStr && isHiragana && hasKanjiObj) {
            if (!v.priorities || v.priorities.length === 0) {
              s -= 200; // Heavily penalize obscure kanji words for kana inputs
            } else {
              s -= 20; // Slight penalty
            }
          }

          if (s > bestVariantScore) {
            bestVariantScore = s;
            bestVariant = v;
            bestEntry = entry;
          }
        }
      }
    }

    if (bestEntry && bestVariant && bestVariantScore >= 0) {
      variant = bestVariant;
      reading = variant.pronounced || reading;
      meaning = bestEntry.meanings[0]?.glosses?.join(", ") || meaning;
    } else {
      // Provide fallback for common kana like です, て, に, を, は
      if (/^[ぁ-ん]{1,3}$/.test(wordStr)) {
        meaning = "Kana particle / expression";
      }
    }

    const { jlpt, joyo, score, breakdown } = getWordScoreBreakdown(wordStr, variant);

    results.push({
      word: wordStr,
      reading,
      meaning,
      jlpt,
      joyo,
      score,
      breakdown
    });
  }

  return results;
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  app.post("/api/extract", (req, res) => {
    try {
      const { text } = req.body;
      if (!text) {
        return res.status(400).json({ error: "No text provided" });
      }
      
      const words = processText(text);
      res.json(words);
    } catch (e: any) {
      console.error(e);
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/update-words", (req, res) => {
    try {
      const { words } = req.body;
      if (!Array.isArray(words)) {
        return res.status(400).json({ error: "Invalid words array" });
      }

      const results = words.map((w: any) => {
        const wordStr = w.word;
        if (!wordStr) return w; // skip invalid

        // Find dictionary entries to get variant priorities and real meta
        const dictionaryEntries = getCachedDictionaryEntries(wordStr);
        let bestVariant = null;
        let bestVariantScore = -999;
        
        for (const entry of dictionaryEntries) {
          if (!entry.variants) continue;
          for (const v of entry.variants) {
            if (v.written === wordStr || v.pronounced === wordStr) {
              let s = 0;
              if (v.written === wordStr) s += 100;
              if (v.priorities && v.priorities.length > 0) s += 50;
              if (s > bestVariantScore) {
                bestVariantScore = s;
                bestVariant = v;
              }
            }
          }
        }

        const calculated = getWordScoreBreakdown(wordStr, bestVariant);
        
        // Merge calculated fields if missing or if we want to "recalculate"
        return {
          ...w,
          score: w.score ?? calculated.score,
          breakdown: w.breakdown ?? calculated.breakdown,
          jlpt: w.jlpt ?? calculated.jlpt,
          joyo: w.joyo ?? calculated.joyo,
        };
      });

      res.json(results);
    } catch (e: any) {
      console.error(e);
      res.status(500).json({ error: e.message });
    }
  });

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
