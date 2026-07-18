/**
 * Server-side language bindings (#258). NOT browser-safe — createTokenizer
 * reaches into fs/WASM. The display half of a profile lives in registry.ts.
 *
 * Documented seam: dictionary construction (JMDict extraction, JMnedict
 * prep, DictionaryManager.initialize, cache preload) is still orchestrated
 * inline in server.ts — it is entangled with the boot sequence that the
 * second half of #255 (server.ts decomposition) will untangle. When that
 * lands, the whole dictionary boot becomes createDictionary() here. Until
 * then a new language only needs this file + that boot block.
 */

import { createTokenizer, Tokenizer } from '../tokenizers.js';
import type { LanguageCode } from './types.js';
import { DEFAULT_LANGUAGE } from './types.js';

export interface LanguageServerProfile {
  code: LanguageCode;
  /** Build the target-language tokenizer (ja: Sudachi WASM via TOKENIZER env). */
  createTokenizer(): Promise<Tokenizer>;
}

const SERVER_PROFILES: Record<string, LanguageServerProfile> = {
  ja: {
    code: 'ja',
    createTokenizer: () => createTokenizer(),
  },
};

export function getServerProfile(code: LanguageCode = DEFAULT_LANGUAGE): LanguageServerProfile {
  return SERVER_PROFILES[code] ?? SERVER_PROFILES[DEFAULT_LANGUAGE];
}
