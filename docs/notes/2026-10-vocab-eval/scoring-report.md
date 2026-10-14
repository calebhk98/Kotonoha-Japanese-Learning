# Scoring report (branch fix/scoring, worktree /home/user/wt/scoring)

## Root cause
Not a missing-priority bug in JMDict. The frequency penalty is computed from the *kanji-data* variant
(`getCachedDictionaryEntries` + `findBestVariant`, src/lib/wordResolver.ts:410 -> `getWordScoreBreakdown(wordStr, variant)` at :612
-> `getFrequencyPenalty`, src/lib/scoringConstants.ts:151). The JMDict entry that supplies the meaning is never consulted.
kanji-data carries ichi1/news1/nfNN only on some variants and has none for most kana-only words
(これ: base form 此れ -> variant with `priorities: []`; とても/それ/ドア/レジ/コップ: no variant). Empty priorities fall through to the
`very-rare` fallback (+50, scoringConstants.ts:~126). The `kana-no-variant` -20 rule only fires when variant === null AND wordStr is 1-3 hiragana,
so it never rescued katakana, longer kana, or kana whose base form is a rare kanji spelling.

Graders' diagnosis: PARTLY RIGHT. The +50 fallback is what they saw, but the premise "JMDict carries ichi1/news1" is wrong for the data the app
ships: jmdict-all-3.6.2.json (jmdict-simplified) has only a boolean `common` per kanji/kana element (これ kana common:true, 此れ common:false), no ichi1/news1/nf tags.
The tags come from kanji-data, which lacks them for these words. Scoring ignores `common`.

## Verdicts
- これ / とても +50 (Total 65): REAL BUG. Fixed (now -20, total clamps to 1).
- Quantified from the 4 graded vocab lists (out/*.vocab.md): 479 of 2204 cards show Freq. Penalty +50.
  Re-measured with the fix on the 4 texts: 203 of 1979 non-grammar rows changed score (10.3%): 45/436, 58/516, 63/473, 37/554;
  rows still at +50: 327 (16.5%), mostly legitimately uncommon (挽回, 驟雨, 坂本 names) or merged phrases/idioms (頭を下げた, 予想どおり, 一つずつ).
- 誰 = 100: INTENDED DESIGN (not changed). Kanji 誰 has no JLPT level in kanji-data -> "no JLPT kanji" = 100 pts, + Grade 9/middle-school +25, -20 freq, clamped to 100.
  The kanji is outside the old N5-N1 lists, so the score says "hard kanji", not "rare word". Worth a product decision (kana-written だれ would score low).
- 人 = 1: INTENDED. 15 (N5) + 5 (grade 1) - 20 (ichi1) = 0, clamped to the documented floor 1 (CLAUDE.md "score floor"). Concern below: the clamp makes all easy common words indistinguishable.
- Grammar morphemes "?" pts / Total 0: partly a DISPLAY BUG, fixed. Score 0 + EMPTY_BREAKDOWN (contentResolver.ts:~535) is by design (not scored), but the vocab cards
  rendered "Total Score 0, JLPT Native/N1+, ? pts, Freq 0". ContentReader hover already hides the score for isMorpheme; ContentDetail and VocabView cards now do too.
- ScoringView/explanations vs code: ScoringView renders FREQUENCY_PENALTY_RULES directly, so it cannot drift; only the `very-common` detail text changed
  ("ichi1, news1, or flagged common in JMDict"). No other mismatch found.
- Side observation (not changed): kanji-data variant selection can pick an unrelated homograph for the penalty (ひと -> 他人, その -> 園, 誰 -> pronounced た).
  It only matters for the tag lookup; the tags it returns happen to be high-frequency, so scores are mostly fine.

## Changes
- src/lib/dictionary.ts: `WordLookupResult.common`, new `isEntryCommonFor(entry, key, reading)` (kanji key or shown kana element flagged common); JMDict lookup returns it.
- src/lib/wordResolver.ts: carries `jmdictCommon` from the dict result into `getWordScoreBreakdown`.
- src/lib/scoring.ts / scoringConstants.ts: optional `jmdictCommon` param; only used when the variant has no priorities of its own (real tags still win: nf30 + common stays 30);
  synthetic tag `'common'` joins the `very-common` rule (-20) and shows in the card as "Freq. Penalty (common)".
- src/components/ContentDetail.tsx, src/views/VocabView.tsx: hide score box for grammar morphemes.
No per-word lists.

## Commits (branch fix/scoring)
- 4eb1561 test(scoring): add failing tests for JMDict-common frequency penalty
- c04b069 fix(scoring): use JMDict common flag when kanji-data variant has no priority tags
- 6a87eae fix(scoring): hide the score box on grammar-morpheme vocab cards (UI only, no unit test possible: vitest env is node; tsc is the gate)

## Tests / lint
- `npm run lint`: clean.
- `npm test`: 509 pass, 1 fail: dictionary.test.ts "おく as a VERB" times out at 5000 ms (first test to load the kanji-data index; fails identically on the pre-fix tree, passes/fails with load; unrelated).
- New tests: scoring.test.ts (penalty + breakdown), wordResolver.test.ts (これ via base 此れ; non-common stays +50), dictionary.test.ts (isEntryCommonFor).

## Before / after (score on the 4 graded texts, no translation-context step)
Freq penalty +50 -> -20 for: これ, それ, その, この, ここ, とても, きれい, ゆっくり, しっかり, おはよう, くれる, でも, ので, ながら, ふと, ドア, レジ, コップ, ちっとも, おばあちゃん.
Total score 65 -> 1 for all of these (N5 15 + 0 - 20, floor 1); 子どものころ 70 -> 1. 誰 100 -> 100 (unchanged); 人 1 -> 1.
(Kanji-bearing words with higher JLPT/grade, e.g. N3 kanji, drop from 100 to ~30-50 rather than to 1.)

## Corpus impact
~10% of vocab rows (203/1979 on 4 texts) change `score`, `breakdown.freqPenalty` and `breakdown.priorities` (['common']). Every resolved.json with such words embeds those fields,
so effectively all ~600 items would diff. A full `npm run resolve-content -- --all` is the documented route (CLAUDE.md) and the diff should be ONLY score/breakdown fields,
no meaning/reading changes (not run, per instructions). Note: stored imports in data/imports keep old scores until re-saved.

## Remaining concerns
- Floor clamp: jlpt 15 + joyo - freq 20 clamps at 1, so これ, 人, 本, 水 all show 1 and ordering among easy words is lost. Consider shrinking the -20 bonus or clamping at a lower bound without flattening (design call).
- JMDict-simplified `common` is coarser than ichi1/news1/nf: gai1/spec1 words that kanji-data tagged score 0, while untagged common ones now score -20.
- 誰-style words: kanji absent from JLPT lists score as maximally hard.
- Merged/idiomatic multi-token words (頭を下げた) get their penalty from a kanji-data lookup of the lemma and often stay at +50.
