// Spanish UI strings (#260). This is a STUB locale that proves the seam: it
// translates the surfaces already wired through t(). Any key missing here falls
// back to the English value in en.ts (see i18n.t), so a partial translation is
// safe — untranslated strings simply appear in English.

import type { TranslationKey } from './en';

export const es: Partial<Record<TranslationKey, string>> = {
  // Common controls / chrome
  'common.back': 'Atrás',
  'common.edit': 'Editar',
  'common.loading': 'Cargando...',

  // Settings page
  'settings.title': 'Ajustes',
  'settings.subtitle': 'Configura las integraciones de API y las opciones de personalización.',
  'settings.language.title': 'Idioma',
  'settings.language.subtitle': 'Elige el idioma para las definiciones y la interfaz',
  'settings.language.native': 'Tu idioma',
  'settings.language.nativeHelp':
    'Las definiciones del diccionario aparecen en este idioma cuando están disponibles; si no, en inglés.',
  'settings.wanikani.title': 'Clave de API de WaniKani',
  'settings.wanikani.subtitle': 'Personaliza las puntuaciones de dificultad según tu progreso de SRS',
  'settings.cache.title': 'Gestión de caché',
  'settings.cache.subtitle': 'Borra las cachés de diccionario y definiciones',

  // Word detail
  'word.primaryMeaning': 'Significado principal',
  'word.allDefinitions': 'Todas las definiciones',
  'word.englishFallback': 'mostrado en inglés (no hay definición en {lang})',

  // Language names (for the selector)
  'lang.en': 'Inglés (English)',
  'lang.es': 'Español',
};
