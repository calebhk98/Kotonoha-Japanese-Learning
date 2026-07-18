import { useEffect } from 'react';
import {
  JLPT_SCORES,
  JLPT_LABELS,
  JOYO_PENALTIES,
  JOYO_LABELS,
  FREQUENCY_PENALTY_RULES,
  // #259 C2 regression fix: import from scoringConstants.ts, NOT scoring.ts.
  // scoring.ts pulls in kanji-data/fs/path (server-only) — importing it from
  // this CLIENT component crashed the whole app with "process is not
  // defined" once Vite pre-bundled kanji-data for the browser. The pure
  // constants/getFrequencyPenalty live in scoringConstants.ts specifically so
  // this view can import them safely; scoring.ts re-exports them for
  // server-side callers.
} from '../lib/scoringConstants';

// JLPT_SCORES/JOYO_PENALTIES/FREQUENCY_PENALTY_RULES keys/order aren't
// guaranteed by TS (Record<number,...> + array insertion order), so render in
// the same "easiest first" order the guide has always shown.
const JLPT_LEVEL_ORDER = [5, 4, 3, 2, 1] as const;
const JOYO_GRADE_ORDER = [1, 2, 3, 4, 5, 6, 8, 9] as const;

function formatPts(n: number): string {
  return `${n > 0 ? '+' : ''}${n} pts`;
}

// #259 C2: this view used to hardcode all three tables, and they drifted from
// the actual scoring code in src/lib/scoring.ts (N4 shown as +25 vs the real
// 30, N2 +75 vs 70, N1 +100 vs 90; the whole Frequency Penalties table didn't
// match getFrequencyPenalty's buckets at all). Every number below is now read
// directly from scoring.ts's exported constants, so this page cannot drift
// from the code that actually computes scores — see scoring.test.ts's
// "scoring-guide constants (#259 C2)" suite for the pinned regression check.
function ScoringView() {
  useEffect(() => {
    document.title = 'Scoring Guide — Kotonoha';
  }, []);

  return (
    <section className="space-y-6">
      <h2 className="text-2xl font-semibold tracking-tight mb-8">
        Scoring Guide
      </h2>
      <div className="bg-white p-8 rounded-3xl border border-gray-100 shadow-sm text-gray-800">
        <h3 className="text-xl font-bold mb-4 border-b border-gray-100 pb-2">
          Base JLPT Points
        </h3>
        <p className="text-sm text-gray-600 mb-4">
          Each word receives a base score according to its estimated JLPT level.
          Rarer words score higher.
        </p>
        <ul className="list-disc list-inside space-y-2 mb-8">
          {JLPT_LEVEL_ORDER.map((level) => (
            <li key={level}>
              <span className="font-medium text-indigo-600">{JLPT_LABELS[level]}</span>:{' '}
              {formatPts(JLPT_SCORES[level])}
            </li>
          ))}
        </ul>

        <h3 className="text-xl font-bold mb-4 border-b border-gray-100 pb-2">
          Kanji Joyo Penalties
        </h3>
        <p className="text-sm text-gray-600 mb-4">
          If a word contains kanji, it gets bonus penalty points based on the
          highest-grade kanji it contains.
        </p>
        <ul className="list-disc list-inside space-y-2 mb-8">
          {JOYO_GRADE_ORDER.map((grade) => (
            <li key={grade}>
              <span className="font-medium">{JOYO_LABELS[grade]}</span>: {formatPts(JOYO_PENALTIES[grade])}
            </li>
          ))}
        </ul>

        <h3 className="text-xl font-bold mb-4 border-b border-gray-100 pb-2">
          Frequency Penalties
        </h3>
        <p className="text-sm text-gray-600 mb-4">
          Words are penalized or rewarded based on their frequency in standard
          Japanese corpora. Values range from{' '}
          {formatPts(Math.min(...FREQUENCY_PENALTY_RULES.map((r) => r.penalty)))} to{' '}
          {formatPts(Math.max(...FREQUENCY_PENALTY_RULES.map((r) => r.penalty)))}.
        </p>
        <ul className="list-disc list-inside space-y-2">
          {FREQUENCY_PENALTY_RULES.map((rule) => (
            <li key={rule.id}>
              <span className="font-medium">{rule.label}</span> ({rule.detail}):{' '}
              {formatPts(rule.penalty)}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

type ScoringViewProps = {};

export default ScoringView;
