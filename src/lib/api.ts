import { WordInfo } from "../types";

export async function extractVocabulary(text: string): Promise<WordInfo[]> {
  const res = await fetch("/api/extract", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text })
  });

  if (!res.ok) {
    throw new Error("Failed to extract vocabulary");
  }

  const list: WordInfo[] = await res.json();
  return list;
}
