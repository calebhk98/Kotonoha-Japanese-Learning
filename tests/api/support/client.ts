/**
 * Minimal HTTP helpers for the API test suite. Thin wrappers around fetch()
 * against the server subprocess started by globalSetup.ts — deliberately not
 * importing anything from server.ts/src/lib (see globalSetup.ts for why).
 */
import { BASE_URL } from './config.js';

export { BASE_URL };

export interface ApiResponse<T = any> {
  status: number;
  ok: boolean;
  body: T;
}

export async function apiGet<T = any>(pathAndQuery: string): Promise<ApiResponse<T>> {
  const res = await fetch(`${BASE_URL}${pathAndQuery}`);
  const body = (await res.json().catch(() => null)) as T;
  return { status: res.status, ok: res.ok, body };
}

export async function apiPost<T = any>(pathName: string, payload: unknown): Promise<ApiResponse<T>> {
  const res = await fetch(`${BASE_URL}${pathName}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const body = (await res.json().catch(() => null)) as T;
  return { status: res.status, ok: res.ok, body };
}

/** A WordInfo-shaped entry as returned by /api/extract and /api/process-story. */
export interface WordInfoLike {
  word: string;
  reading?: string;
  meaning?: string;
  meanings?: string[];
  isMorpheme?: boolean;
  isVocabWord?: boolean;
  score?: number;
  [key: string]: unknown;
}

export function findWord(words: WordInfoLike[], target: string): WordInfoLike | undefined {
  return words.find((w) => w.word === target);
}

/**
 * Some meanings carry a " — or: ..." suffix listing close-tie alternative
 * senses (see the contextual-reading work referenced in CLAUDE.md). Strip it
 * so cross-endpoint consistency checks compare the primary sense only.
 */
export function primarySense(meaning: string | undefined | null): string {
  if (!meaning) return '';
  const idx = meaning.indexOf(' — or:');
  return (idx === -1 ? meaning : meaning.slice(0, idx)).trim();
}
