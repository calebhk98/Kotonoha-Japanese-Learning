import { WordInfo } from "../types";
import type { Content } from "../data/content";

export async function getAllContentWords(): Promise<Record<string, WordInfo[]>> {
  const res = await fetch("/api/content/words");
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export async function getContentWords(contentId: string): Promise<WordInfo[]> {
  const res = await fetch(`/api/content/${encodeURIComponent(contentId)}/words`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

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

export async function extractVocabulary(
  text: string,
  onProgress?: (message: string) => void
): Promise<WordInfo[]> {
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

// ---- user imports: processed once on the server and saved there, so a
// long text isn't re-resolved on every visit (and the reader, vocab list and
// inspect-text all read the same saved document).

async function importRequest<T>(method: string, url: string, payload?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: payload === undefined ? undefined : JSON.stringify(payload),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
  return body as T;
}

export function listImports(): Promise<Content[]> {
  return importRequest<Content[]>("GET", "/api/imports");
}

/** Creates or replaces an import (also used to save edits of disk content under its id). */
export function saveImport(content: Content): Promise<Content> {
  return importRequest<Content>("POST", "/api/imports", content);
}

export function updateImport(content: Content): Promise<Content> {
  return importRequest<Content>("PUT", `/api/imports/${encodeURIComponent(content.id)}`, content);
}
