// #259 P7 — Word Detail's "All Definitions" list (WordDetailPage) surfaces
// every JMDict sense as a plain string, including adult/vulgar ones (e.g. 猫
// has a sense tagged misc:['uk','sl'] glossed "bottom (submissive partner of
// a homosexual relationship)"). dictionary.ts's getSenseCommonness already
// reads JMDict's misc[] register tags (sl/vulg/X/derog/...) to SINK those
// senses in the ordering, but by the time a sense reaches the client it has
// been flattened to a bare string (dictionary.ts `meanings: string[]`) — the
// misc[] tag itself never travels over the wire. Reworking the resolve()
// return shape to carry it would touch wordResolver.ts/dictionary.ts's
// entry-selection pipeline, which #259's scope explicitly keeps out (that
// pipeline feeds the committed resolved.json artifacts — see CLAUDE.md).
//
// So this filters at DISPLAY time only, off the gloss text itself, against a
// curated set of patterns that JMDict specifically uses to describe sexual /
// vulgar slang senses. It is necessarily a best-effort textual heuristic, not
// a tag-accurate filter — documented as a known limitation; a proper fix is
// threading the misc[] tag through the (always-live, non-resolved.json)
// /api/word response as a follow-up.

const ADULT_GLOSS_PATTERNS: RegExp[] = [
  /\bhomosexual\b/i,
  /\bsubmissive partner\b/i,
  /\bvulgar\b/i,
  /\bx-rated\b/i,
  /\bsexual intercourse\b/i,
  /\bmasturbat/i,
  /\b(penis|vagina|genitals?)\b/i,
  /\bprostitut/i,
  /\bslang for (a )?(penis|vagina|prostitute|sex)\b/i,
];

/** True if a single gloss string reads as an adult/vulgar sense. */
export function isAdultGloss(gloss: string): boolean {
  return ADULT_GLOSS_PATTERNS.some((re) => re.test(gloss));
}

/**
 * Filters adult/vulgar glosses out of a sense list for the beginner-facing
 * display. Never returns an empty list — if every sense in the input is
 * flagged (shouldn't normally happen; JMDict entries mix common senses with
 * rare ones), the original list is returned so the learner still sees
 * something rather than a blank section.
 */
export function filterAdultGlosses(glosses: string[]): string[] {
  const filtered = glosses.filter((g) => !isAdultGloss(g));
  return filtered.length > 0 ? filtered : glosses;
}
