// English UI strings (#260). This is the SOURCE locale and the mandatory
// fallback: every key that any other locale might use must exist here. Keys are
// dotted namespaces (area.item). Values may contain {named} placeholders that
// t() interpolates.
//
// Only the surfaces wired through t() so far are populated (Settings page,
// language selector, word-detail fallback marker, common controls). Adding a
// new translated string is: add the key here, add it to each locale (or let it
// fall back to English), and call t('key') in the component.

export const en = {
  // Common controls / chrome
  'common.back': 'Back',
  'common.edit': 'Edit',
  'common.loading': 'Loading...',

  // Settings page
  'settings.title': 'Settings',
  'settings.subtitle': 'Configure API integrations and personalization options.',
  'settings.language.title': 'Language',
  'settings.language.subtitle': 'Choose the language for definitions and the interface',
  'settings.language.native': 'Your language',
  'settings.language.nativeHelp':
    'Dictionary glosses appear in this language where available, falling back to English.',
  'settings.wanikani.title': 'WaniKani API Key',
  'settings.wanikani.subtitle': 'Personalizes difficulty scores based on your SRS progress',
  'settings.cache.title': 'Cache Management',
  'settings.cache.subtitle': 'Clear dictionary and definition caches',

  // Word detail
  'word.primaryMeaning': 'Primary Meaning',
  'word.allDefinitions': 'All Definitions',
  'word.englishFallback': 'shown in English (no {lang} gloss available)',

  // Language names (for the selector)
  'lang.en': 'English',
  'lang.es': 'Spanish (Español)',

  // Test-only key exercising interpolation (kept trivial and harmless).
  'test.interpolation': 'Hello, {name}!',
} as const;

export type TranslationKey = keyof typeof en;
