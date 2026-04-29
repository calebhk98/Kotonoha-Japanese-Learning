// WaniKani SRS stage -> difficulty multiplier (per issue #9 specification)
export const WK_MULTIPLIERS: Record<number, number> = {
  1: 0.95, // Apprentice 1
  2: 0.90, // Apprentice 2
  3: 0.80, // Apprentice 3
  4: 0.70, // Apprentice 4
  5: 0.50, // Guru 1
  6: 0.35, // Guru 2
  7: 0.25, // Master
  8: 0.15, // Enlightened
  9: 0.05, // Burned
};

export const WK_STAGE_NAMES: Record<number, string> = {
  1: 'Apprentice I',
  2: 'Apprentice II',
  3: 'Apprentice III',
  4: 'Apprentice IV',
  5: 'Guru I',
  6: 'Guru II',
  7: 'Master',
  8: 'Enlightened',
  9: 'Burned',
};

// Map from kanji character -> SRS stage (1–9)
export type WaniKaniData = Record<string, number>;

export interface WaniKaniSyncResult {
  data: WaniKaniData;
  syncedAt: number;
  kanjiCount: number;
}

const KANJI_REGEX = /[一-龯]/g;

export function getWaniKaniMultiplier(word: string, wkData: WaniKaniData): number {
  const stage = getWaniKaniSrsStage(word, wkData);
  if (stage === null) return 1.0;
  return WK_MULTIPLIERS[stage] ?? 1.0;
}

export function getWaniKaniSrsStage(word: string, wkData: WaniKaniData): number | null {
  const kanjis = word.match(KANJI_REGEX);
  if (!kanjis || kanjis.length === 0) return null;

  // Use the minimum SRS stage (least confident kanji) to determine the stage.
  // If a kanji hasn't been started in WaniKani, it contributes no adjustment.
  let minStage: number | null = null;
  for (const k of kanjis) {
    const stage = wkData[k];
    if (stage !== undefined) {
      minStage = minStage === null ? stage : Math.min(minStage, stage);
    }
  }

  return minStage;
}

export function loadCachedWaniKaniData(): WaniKaniSyncResult | null {
  try {
    const raw = localStorage.getItem('waniKaniData');
    if (!raw) return null;
    return JSON.parse(raw) as WaniKaniSyncResult;
  } catch {
    return null;
  }
}

export function isCacheStale(cached: WaniKaniSyncResult, maxAgeMs = 24 * 60 * 60 * 1000): boolean {
  return Date.now() - cached.syncedAt > maxAgeMs;
}
