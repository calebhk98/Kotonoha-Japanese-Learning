import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import kuromoji from "kuromoji";
import {
  DictionaryVariant,
  DictionaryEntry,
  FindBestVariantResult,
  JLPT_SCORES,
  JOYO_PENALTIES,
  getFrequencyPenalty,
  getWordScoreBreakdown,
  getCachedDictionaryEntries,
  findBestVariant,
} from "./src/lib/scoring.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let tokenizer: kuromoji.Tokenizer<kuromoji.IpadicFeatures> | null = null;
const tokenizerReady = new Promise<void>((resolve, reject) => {
  kuromoji.builder({ dicPath: 'node_modules/kuromoji/dict' }).build((err, t) => {
    if (err) {
      console.error("Failed to build kuromoji tokenizer:", err);
      reject(err);
    } else {
      tokenizer = t;
      console.log("Kuromoji tokenizer ready");
      resolve();
    }
  });
});


function processText(text: string) {
  if (!tokenizer) throw new Error("Tokenizer not ready");
  const tokens = tokenizer.tokenize(text);

  const particles = new Set(["は", "が", "を", "に", "へ", "と", "で", "も", "か", "の", "て", "な", "だ"]);
  const isPunctuation = (s: string) => /[、。！？・「」『』（）()[\]a-zA-Z0-9\s]/.test(s);
  const isSingleKana = (s: string) => s.length === 1 && (particles.has(s) || /[ぁ-ん]/.test(s));

  // Count how many times each base form appears (for frequencyInContent)
  const baseFormCounts = new Map<string, number>();
  const validWords = new Set<string>();

  for (const token of tokens) {
    if (token.surface_form.trim() === '' || isPunctuation(token.surface_form) || isSingleKana(token.surface_form)) continue;

    const word = token.basic_form && token.basic_form !== '*' ? token.basic_form : token.surface_form;
    if (!isSingleKana(word)) {
      validWords.add(word);
      baseFormCounts.set(word, (baseFormCounts.get(word) ?? 0) + 1);
    }
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
    const frequencyInContent = baseFormCounts.get(wordStr) ?? 1;
    results.push({ word: wordStr, reading, meaning, jlpt, joyo, score, breakdown, frequencyInContent });
  }

  return results;
}

async function startServer() {
  // Wait for tokenizer to be ready before starting server
  await tokenizerReady;

  const app = express();
  const PORT = 3000;

  app.use(express.json());

  app.use((req, _res, next) => {
    console.log(`[Server] ${req.method} ${req.path}`);
    next();
  });

  const MAX_TEXT_LENGTH = 50000;
  const JAPANESE_SCRIPT = /[぀-ゟ゠-ヿ一-鿿]/;

  app.post("/api/extract", (req, res) => {
    const start = Date.now();
    try {
      const { text } = req.body;
      if (!text) {
        return res.status(400).json({ error: "No text provided" });
      }
      if (typeof text !== "string" || text.length > MAX_TEXT_LENGTH) {
        return res.status(400).json({ error: `Text exceeds the ${MAX_TEXT_LENGTH} character limit` });
      }
      if (!JAPANESE_SCRIPT.test(text)) {
        return res.status(400).json({ error: "Text must contain Japanese characters" });
      }

      console.log(`[API] /api/extract: processing ${text.length} chars`);
      const words = processText(text);
      console.log(`[API] /api/extract: extracted ${words.length} words in ${Date.now() - start}ms`);
      res.json(words);
    } catch (e: any) {
      console.error(`[API Error] /api/extract failed after ${Date.now() - start}ms:`, e.message);
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/update-words", (req, res) => {
    const start = Date.now();
    try {
      const { words } = req.body;
      if (!Array.isArray(words)) {
        return res.status(400).json({ error: "Invalid words array" });
      }

      console.log(`[API] /api/update-words: scoring ${words.length} words`);
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

      console.log(`[API] /api/update-words: completed in ${Date.now() - start}ms`);
      res.json(results);
    } catch (e: any) {
      console.error(`[API Error] /api/update-words failed after ${Date.now() - start}ms:`, e.message);
      res.status(500).json({ error: e.message });
    }
  });

  const WK_HEADERS = (token: string) => ({
    'Authorization': `Bearer ${token}`,
    'Wanikani-Revision': '20170710',
    'Content-Type': 'application/json',
  });

  app.post("/api/wanikani/validate", async (req, res) => {
    try {
      const { token } = req.body;
      if (!token || typeof token !== 'string') {
        return res.status(400).json({ valid: false, error: 'No token provided' });
      }
      const r = await fetch('https://api.wanikani.com/v2/user', { headers: WK_HEADERS(token) });
      if (!r.ok) return res.json({ valid: false });
      const data = await r.json() as { data: { username: string; level: number } };
      res.json({ valid: true, username: data.data.username, level: data.data.level });
    } catch (e: any) {
      console.error('[WaniKani] validate error:', e.message);
      res.status(500).json({ valid: false, error: e.message });
    }
  });

  app.post("/api/wanikani/sync", async (req, res) => {
    const start = Date.now();
    try {
      const { token } = req.body;
      if (!token || typeof token !== 'string') {
        return res.status(400).json({ error: 'No token provided' });
      }

      // Fetch all started kanji assignments (paginated)
      const assignments = new Map<number, number>(); // subject_id -> srs_stage
      let assignmentsUrl: string | null = 'https://api.wanikani.com/v2/assignments?subject_types=kanji&started=true';
      while (assignmentsUrl) {
        const r = await fetch(assignmentsUrl, { headers: WK_HEADERS(token) });
        if (!r.ok) return res.status(401).json({ error: 'WaniKani API error' });
        const body = await r.json() as {
          data: Array<{ data: { subject_id: number; srs_stage: number } }>;
          pages: { next_url: string | null };
        };
        for (const item of body.data) {
          assignments.set(item.data.subject_id, item.data.srs_stage);
        }
        assignmentsUrl = body.pages?.next_url ?? null;
      }

      console.log(`[WaniKani] Fetched ${assignments.size} kanji assignments in ${Date.now() - start}ms`);

      // Fetch subjects for those IDs to get characters (batch by 500)
      const subjectIds = Array.from(assignments.keys());
      const characters = new Map<number, string>(); // id -> kanji character
      for (let i = 0; i < subjectIds.length; i += 500) {
        const batch = subjectIds.slice(i, i + 500).join(',');
        let subjectsUrl: string | null = `https://api.wanikani.com/v2/subjects?ids=${batch}`;
        while (subjectsUrl) {
          const r = await fetch(subjectsUrl, { headers: WK_HEADERS(token) });
          if (!r.ok) break;
          const body = await r.json() as {
            data: Array<{ id: number; data: { characters: string } }>;
            pages: { next_url: string | null };
          };
          for (const item of body.data) {
            if (item.data.characters) characters.set(item.id, item.data.characters);
          }
          subjectsUrl = body.pages?.next_url ?? null;
        }
      }

      // Build character -> srs_stage map
      const result: Record<string, number> = {};
      for (const [subjectId, srsStage] of assignments) {
        const char = characters.get(subjectId);
        if (char) result[char] = srsStage;
      }

      console.log(`[WaniKani] Sync complete: ${Object.keys(result).length} kanji mapped in ${Date.now() - start}ms`);
      res.json({ data: result, kanjiCount: Object.keys(result).length });
    } catch (e: any) {
      console.error('[WaniKani] sync error:', e.message);
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
