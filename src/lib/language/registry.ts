/**
 * Language-profile registry (#258). Browser-safe.
 *
 * Unknown codes fall back to Japanese: content without a language field is
 * Japanese by definition (every existing folder predates the field), and a
 * hard throw here would brick the reader over a metadata typo.
 */

import { JAPANESE_PROFILE } from './japanese.js';
import type { LanguageCode, LanguageDisplayProfile } from './types.js';
import { DEFAULT_LANGUAGE } from './types.js';

const PROFILES: Record<string, LanguageDisplayProfile> = {
  ja: JAPANESE_PROFILE,
};

export function getDisplayProfile(code: LanguageCode = DEFAULT_LANGUAGE): LanguageDisplayProfile {
  return PROFILES[code] ?? PROFILES[DEFAULT_LANGUAGE];
}

export { DEFAULT_LANGUAGE } from './types.js';
export type { LanguageCode, LanguageDisplayProfile, PosClass, ScriptProfile, BreakdownRow } from './types.js';
