// Lightweight i18n layer for the learner's native language (#260).
//
// Deliberately ~a page of code, no react-i18next: a t() function, per-locale
// string tables (src/locales/*), a localStorage-backed current-language
// setting, and a subscribe hook so React re-renders on change. English is the
// default and the mandatory fallback.
//
// This module is import-safe in Node (the server builds gloss priorities from
// it): every localStorage/window access is guarded.

import { useSyncExternalStore } from 'react';
import { en, type TranslationKey } from '../locales/en.js';
import { es } from '../locales/es.js';

export type NativeLanguage = 'en' | 'es';

export const DEFAULT_NATIVE_LANGUAGE: NativeLanguage = 'en';

/** Languages offered in the native-language selector. */
export const SUPPORTED_NATIVE_LANGUAGES: NativeLanguage[] = ['en', 'es'];

const STORAGE_KEY = 'nativeLanguage';

// Locale tables. English is complete; others are Partial and fall back to en.
const LOCALES: Record<string, Partial<Record<TranslationKey, string>>> = {
  en,
  es,
};

// Maps a native-language code to the JMDict gloss-language priority list. The
// English 3-letter tag is always last so English stays the mandatory fallback.
const GLOSS_PRIORITY: Record<string, string[]> = {
  en: ['eng'],
  es: ['spa', 'eng'],
};

// In-memory current language. Seeded from localStorage on first read so the
// value survives reloads; also the source of truth in Node (no localStorage).
let current: string | null = null;

function readStored(): string {
  try {
    if (typeof localStorage !== 'undefined') {
      const v = localStorage.getItem(STORAGE_KEY);
      if (v) return v;
    }
  } catch {
    /* localStorage unavailable (Node, privacy mode) */
  }
  return DEFAULT_NATIVE_LANGUAGE;
}

export function getNativeLanguage(): string {
  if (current === null) current = readStored();
  return current;
}

const listeners = new Set<(lang: string) => void>();

export function setNativeLanguage(lang: string): void {
  current = lang;
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(STORAGE_KEY, lang);
  } catch {
    /* ignore */
  }
  for (const cb of listeners) cb(lang);
}

/** Subscribe to native-language changes; returns an unsubscribe function. */
export function subscribeNativeLanguage(cb: (lang: string) => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/**
 * Translate a key for the current (or given) native language. Resolution:
 *   1. the requested locale's table
 *   2. the English table (mandatory fallback)
 *   3. the key itself (so a missing translation is visible, never a crash)
 * {named} placeholders in the string are replaced from `params`.
 */
export function t(
  key: TranslationKey | string,
  params?: Record<string, string | number>,
  lang: string = getNativeLanguage()
): string {
  const table = LOCALES[lang];
  const raw =
    (table && (table as Record<string, string>)[key]) ??
    (en as Record<string, string>)[key] ??
    key;
  if (!params) return raw;
  return raw.replace(/\{(\w+)\}/g, (m, name) =>
    params[name] !== undefined ? String(params[name]) : m
  );
}

/**
 * JMDict gloss-language priority for a native language (#260). Defaults to the
 * current native language. Always ends in 'eng' so English is the fallback,
 * even for an unknown/unsupported language.
 */
export function glossLangPriority(lang: string = getNativeLanguage()): string[] {
  const mapped = GLOSS_PRIORITY[lang];
  if (mapped) return mapped;
  return lang && lang !== 'en' ? [lang, 'eng'] : ['eng'];
}

/**
 * React hook: returns the current native language and re-renders the component
 * whenever it changes. Components that call t() should read this so a language
 * switch in Settings updates their strings live.
 */
export function useNativeLanguage(): string {
  return useSyncExternalStore(
    (onChange) => subscribeNativeLanguage(onChange),
    getNativeLanguage,
    () => DEFAULT_NATIVE_LANGUAGE
  );
}
