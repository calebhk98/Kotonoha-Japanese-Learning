import { WordInfo } from "../types";

export async function clearServerCache(): Promise<void> {
  const res = await fetch("/api/clear-cache", {
    method: "POST",
    headers: { "Content-Type": "application/json" }
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const message = body.error ?? `HTTP ${res.status}`;
    console.error(`[API Error] /api/clear-cache failed: ${message}`);
    throw new Error(message);
  }

  const result = await res.json();
  console.log(`[API] Cache cleared: ${result.message}`);
}

  const start = Date.now();
  const charCount = text.length;

  onProgress?.(`Extracting vocabulary from ${charCount} characters...`);
  console.log(`[Vocabulary] Extracting vocabulary from ${charCount} char text`);

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
  const elapsed = Date.now() - start;
  console.log(`[Vocabulary] Extracted ${list.length} words in ${elapsed}ms`);

  onProgress?.(`Found ${list.length} unique words`);
  return list;
}
