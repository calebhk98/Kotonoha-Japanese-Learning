// Pure scoring constants + getFrequencyPenalty, split out of scoring.ts
// (#259 C2/regression fix) so ScoringView — a CLIENT component — can import
// the numbers it renders without dragging scoring.ts's server-only
// dependencies (kanji-data, fs, path — all resolving to browser-external
// stubs that throw "process is not defined" at Vite dep-prebundle time) into
// the browser bundle. This file has NO imports beyond plain TS/JS and is
// safe to import from both client and server code. scoring.ts re-exports
// everything here so existing server-side/import sites (server.ts,
// scoring.test.ts) keep working unchanged.

export interface DictionaryVariant {
  written: string;
  pronounced: string;
  priorities?: string[];
}

export const JLPT_SCORES: Record<number, number> = { 5: 15, 4: 30, 3: 50, 2: 70, 1: 90, 0: 100 };
export const JOYO_PENALTIES: Record<number, number> = { 1: 5, 2: 7, 3: 10, 4: 12, 5: 15, 6: 20, 8: 25, 9: 30 };

/**
 * Human-readable labels for JLPT_SCORES keys, keyed the same way (0 = no JLPT
 * kanji / most advanced). Exported so ScoringView (#259 C2) can render the
 * Base JLPT Points table by mapping over JLPT_SCORES instead of re-typing the
 * numbers — the guide diverged from this file (N4 shown as +25 vs the actual
 * 30, N2 +75 vs 70, N1 +100 vs 90) because nothing forced the two to agree.
 */
export const JLPT_LABELS: Record<number, string> = {
  5: 'N5 (Fundamentals)',
  4: 'N4',
  3: 'N3',
  2: 'N2',
  1: 'N1 (Native / Advanced)',
  0: 'No JLPT kanji',
};

/** Human-readable labels for JOYO_PENALTIES keys — same drift-proofing as JLPT_LABELS. */
export const JOYO_LABELS: Record<number, string> = {
  1: 'Grade 1',
  2: 'Grade 2',
  3: 'Grade 3',
  4: 'Grade 4',
  5: 'Grade 5',
  6: 'Grade 6',
  8: 'Grade 8 (Middle School)',
  9: 'Grade 9+ (Non-Joyo)',
};

/**
 * Ordered frequency-penalty rules, single-sourced by both getFrequencyPenalty
 * (below) and ScoringView's "Frequency Penalties" table (#259 C2) so the two
 * can never drift again — the guide previously hardcoded a 9-row table that
 * didn't match this function's actual buckets/penalties.
 *
 * `tags`-based rules are checked in order for a priority-tag match;
 * `nfMax`-based rules are checked in order (ascending) for the first bucket
 * whose ceiling covers the parsed nfNN rank. `fallback: true` marks the rule
 * used when nothing else matched. Order and values are byte-identical to the
 * pre-refactor implementation — see scoring.test.ts for the pinned cases.
 */
export interface FrequencyPenaltyRule {
  id: string;
  label: string;
  detail: string;
  penalty: number;
  tags?: string[];
  nfMax?: number;
  kanaFallback?: boolean;
  fallback?: boolean;
}

export const FREQUENCY_PENALTY_RULES: FrequencyPenaltyRule[] = [
  {
    id: 'kana-no-variant',
    label: 'Common kana word (no dictionary variant)',
    detail: 'pure-kana word with no matched dictionary variant',
    kanaFallback: true,
    penalty: -20,
  },
  {
    id: 'very-common',
    label: 'Very Common',
    detail: 'ichi1, news1, common kana',
    tags: ['ichi1', 'news1'],
    penalty: -20,
  },
  {
    id: 'common',
    label: 'Common',
    detail: 'ichi2, news2',
    tags: ['ichi2', 'news2'],
    penalty: -10,
  },
  {
    id: 'loan-spec-1',
    label: 'Frequent Loan/Spec 1',
    detail: 'gai1, spec1',
    tags: ['gai1', 'spec1'],
    penalty: 0,
  },
  {
    id: 'loan-spec-2',
    label: 'Frequent Loan/Spec 2',
    detail: 'gai2, spec2',
    tags: ['gai2', 'spec2'],
    penalty: 5,
  },
  {
    id: 'nf-1-5',
    label: 'General Corpus Rank 1-5',
    detail: 'nf01-nf05',
    nfMax: 5,
    penalty: 10,
  },
  {
    id: 'nf-6-10',
    label: 'General Corpus Rank 6-10',
    detail: 'nf06-nf10',
    nfMax: 10,
    penalty: 15,
  },
  {
    id: 'nf-11-20',
    label: 'General Corpus Rank 11-20',
    detail: 'nf11-nf20',
    nfMax: 20,
    penalty: 20,
  },
  {
    id: 'nf-21-30',
    label: 'General Corpus Rank 21-30',
    detail: 'nf21-nf30',
    nfMax: 30,
    penalty: 30,
  },
  {
    id: 'nf-31-48',
    label: 'General Corpus Rank 31-48',
    detail: 'nf31-nf48',
    nfMax: Infinity,
    penalty: 40,
  },
  {
    id: 'very-rare',
    label: 'Very Rare',
    detail: 'no frequency tags',
    fallback: true,
    penalty: 50,
  },
];

export function getFrequencyPenalty(variant: DictionaryVariant | null, wordStr: string): number {
  const priorities = variant?.priorities || [];

  if (variant === null && /^[ぁ-ん]{1,3}$/.test(wordStr)) {
    return FREQUENCY_PENALTY_RULES.find((r) => r.kanaFallback)!.penalty;
  }

  const hasPriority = (p: string) => priorities.includes(p);

  for (const rule of FREQUENCY_PENALTY_RULES) {
    if (rule.tags && rule.tags.some(hasPriority)) return rule.penalty;
  }

  const nfTag = priorities.find((p: string) => p.startsWith('nf'));
  if (nfTag) {
    const rank = parseInt(nfTag.slice(2), 10);
    const nfRule = FREQUENCY_PENALTY_RULES.find((r) => r.nfMax !== undefined && rank <= r.nfMax);
    if (nfRule) return nfRule.penalty;
  }

  return FREQUENCY_PENALTY_RULES.find((r) => r.fallback)!.penalty;
}
