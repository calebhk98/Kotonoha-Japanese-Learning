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

interface DictionaryVariant {
  written: string;
  pronounced: string;
  priorities?: string[];
}

interface DictionaryEntry {
  meanings: Array<{ glosses: string[] }>;
  variants: DictionaryVariant[];
}

interface FindBestVariantResult {
  variant: DictionaryVariant | null;
  entry: DictionaryEntry | null;
  score: number;
}

const JLPT_SCORES: Record<number, number> = { 5: 15, 4: 30, 3: 50, 2: 70, 1: 90, 0: 100 };
const JOYO_PENALTIES: Record<number, number> = { 1: 5, 2: 7, 3: 10, 4: 12, 5: 15, 6: 20, 8: 25, 9: 30 };

function getFrequencyPenalty(variant: DictionaryVariant | null, wordStr: string): number {
  const priorities = variant?.priorities || [];

  if (variant === null && /^[ぁ-ん]{1,3}$/.test(wordStr)) return -20;

  const hasPriority = (p: string) => priorities.includes(p);

  if (hasPriority('news1') || hasPriority('ichi1')) return -20;
  if (hasPriority('news2') || hasPriority('ichi2')) return -10;
  if (hasPriority('gai1') || hasPriority('spec1')) return 0;
  if (hasPriority('gai2') || hasPriority('spec2')) return 5;

  const nfTag = priorities.find((p: string) => p.startsWith('nf'));
  if (nfTag) {
    const rank = parseInt(nfTag.slice(2), 10);
    if (rank <= 5) return 10;
    if (rank <= 10) return 15;
    if (rank <= 20) return 20;
    if (rank <= 30) return 30;
    return 40;
  }

  return 50;
}

function getWordScoreBreakdown(wordStr: string, variant: DictionaryVariant | null) {
  let hardestJlpt = 6;
  let hasKanji = false;
  let allJoyo = true;
  let highestGrade: number | null = null;
  const jlptValues: number[] = [];
  const gradeValues: number[] = [];

  const kanjis = kanjiData.extractKanji(wordStr);

  for (const k of kanjis) {
    hasKanji = true;
    const meta = kanjiData.get(k);
    if (!meta) continue;

    const jlpt = meta.jlpt ?? 0;
    jlptValues.push(jlpt);
    if (jlpt < hardestJlpt) hardestJlpt = jlpt;

    if (meta.grade === null || meta.grade > 8) {
      allJoyo = false;
      highestGrade = 9;
    } else {
      gradeValues.push(meta.grade);
      highestGrade = highestGrade === null ? meta.grade : Math.max(highestGrade, meta.grade);
    }
  }

  const finalJlpt = hasKanji && hardestJlpt !== 6 ? hardestJlpt : (hasKanji ? 0 : 5);
  const jlptScore = JLPT_SCORES[finalJlpt] || 100;
  const joyoPenalty = (hasKanji && highestGrade !== null) ? (JOYO_PENALTIES[highestGrade] || 0) : 0;
  const freqPenalty = getFrequencyPenalty(variant, wordStr);
  const score = Math.min(100, Math.max(1, jlptScore + joyoPenalty + freqPenalty));

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
      priorities: variant?.priorities || []
    }
  };
}

const wordsCache = new Map<string, DictionaryEntry[]>();

function getCachedDictionaryEntries(wordStr: string): DictionaryEntry[] {
  if (wordsCache.has(wordStr)) return wordsCache.get(wordStr)!;
  const entries = kanjiData.searchWords(wordStr) as DictionaryEntry[];
  wordsCache.set(wordStr, entries);
  return entries;
}

function findBestVariant(wordStr: string, entries: DictionaryEntry[]): FindBestVariantResult {
  let best: FindBestVariantResult = { variant: null, entry: null, score: -999 };

  for (const entry of entries) {
    if (!entry.variants) continue;
    for (const v of entry.variants) {
      if (v.written !== wordStr && v.pronounced !== wordStr) continue;

      let score = (v.written === wordStr ? 100 : 0) + (v.priorities?.length ? 50 : 0);
      const isHiragana = /^[ぁ-ん]+$/.test(wordStr);
      const hasKanji = /[一-龯]/.test(v.written);

      if (v.written !== wordStr && isHiragana && hasKanji) {
        score -= v.priorities?.length ? 20 : 200;
      }

      if (score > best.score) {
        best = { variant: v, entry, score };
      }
    }
  }

  return best.score >= 0 ? best : { variant: null, entry: null, score: -999 };
}

function processText(text: string) {
  if (!tokenizer) throw new Error("Tokenizer not ready");
  const tokens = tokenizer.tokenize(text);

  const particles = new Set(["は", "が", "を", "に", "へ", "と", "で", "も", "か", "の", "て", "な", "だ"]);
  const isPunctuation = (s: string) => /[、。！？・「」『』（）()[\]a-zA-Z0-9\s]/.test(s);
  const isSingleKana = (s: string) => s.length === 1 && (particles.has(s) || /[ぁ-ん]/.test(s));

  const validWords = new Set<string>();
  for (const token of tokens) {
    if (token.surface_form.trim() === '' || isPunctuation(token.surface_form) || isSingleKana(token.surface_form)) continue;

    const word = token.basic_form && token.basic_form !== '*' ? token.basic_form : token.surface_form;
    if (!isSingleKana(word)) validWords.add(word);
  }

  const results = [];
  for (const wordStr of validWords) {
    const entries = getCachedDictionaryEntries(wordStr);
    const { variant, entry } = findBestVariant(wordStr, entries);

    let meaning = "Unknown meaning";
    let reading = wordStr;

    if (entry && variant) {
      reading = variant.pronounced || wordStr;
      meaning = entry.meanings[0]?.glosses?.join(", ") || meaning;
    } else if (/^[ぁ-ん]{1,3}$/.test(wordStr)) {
      meaning = "Kana particle / expression";
    }

    const { jlpt, joyo, score, breakdown } = getWordScoreBreakdown(wordStr, variant);
    results.push({ word: wordStr, reading, meaning, jlpt, joyo, score, breakdown });
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

      const results = words.map((w: Record<string, unknown>) => {
        const wordStr = w.word as string | undefined;
        if (!wordStr) return w;

        const entries = getCachedDictionaryEntries(wordStr);
        const { variant } = findBestVariant(wordStr, entries);
        const calculated = getWordScoreBreakdown(wordStr, variant);

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
