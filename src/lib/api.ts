import { WordInfo } from "../types";

export async function extractVocabulary(text: string): Promise<WordInfo[]> {
  const start = Date.now();
  console.log(`[Vocabulary] Extracting vocabulary from ${text.length} char text`);

  const res = await fetch("/api/extract", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text })
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const message = body.error ?? `HTTP ${res.status}`;
    console.error(`[API Error] /api/extract failed: ${message}`);
    throw new Error(message);
  }

  const list: WordInfo[] = await res.json();
  console.log(`[Vocabulary] Extracted ${list.length} words in ${Date.now() - start}ms`);
  return list;
}
