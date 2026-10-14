# vocab-senses report (branch fix/vocab-senses, worktree /home/user/wt/vocab-senses)

Commits: 9e1fcb0, f30774d, 90aa942, fce370b (failing tests) ; c15f92a, e70af50, 4ead6aa (fixes). Lint clean, `npx vitest run src/lib` 471/471 (full `npm test` had one 6-10 s timeout flake, "おく as a VERB", passes alone).
Note: the isSaidAlone test and fix were written together (test file committed first in f30774d, impl stashed; it failed on the missing export).

Verification levels: CTX = full pipeline with translation context (resolve-content, 30 sample ids, under the shared lock); NC = inspect-text --no-context on the 4 texts (before/after diff); NONE = not run.

## Rows
| Row | Status | Stage / root cause | Rule |
|---|---|---|---|
| さす (傘をさす) | fixed, NC | dictionary.ts lookup argument tie-break: 注す won by uk bonus (44 vs 32) and the old tolerance was 3 | typical object in a gloss parenthetical ("hold up (an umbrella, etc.)") may outweigh a gap of 15; bare mention keeps 3 |
| ごめん | fixed, NC | contentResolver utterance test: "ごめんね、" followed by a comma was not an utterance, so POS-noun filter dropped the `int` senses | new tokenContext.isSaidAlone: open quote anywhere, and a comma allowed after a sentence-final particle |
| たつ (経つ) | partly fixed, NC (the 三十分以上がたっていた case) | tie among 5 kana homophones; subject 以上 gives no argument word | a time expression earlier in the same clause adds "time" to argument words (non-helper verbs only) so "(of time)" wins |
| 顆 | fixed, NC | POS filter kept only the specialist noun sense | new GrammaticalContext 'number' (plain noun glued to numeral); counter senses lead only if the entry's first sense is specialist (field/rare), so 三種類 stays "kind" |
| 帰る "to die" | changed, CTX | noun+に+verb JMDict `exp` idiom replaced the literal verb | idiom stays first, literal verb meaning appended "— literally: …" for に/へ/で (not を). Unverified quality for 土に帰る beyond NC/CTX diff; true idioms (気に入る) show a redundant literal note |
| そんなもの | fixed, NC | mergeDictionaryWords merged そんな|もの into the exp "that's the way it is" | そんな/こんな/あんな/どんな + formal noun before a case particle is not merged |
| すかす | fixed, NC | tie among homophones; 空かす won on kanji ease | entry whose first sense is collocation-bound ("usu. 腹を...") loses 4 in a kana tie |
| 時どき "seasonal" | NOT fixed | POS 名詞(副詞可能) narrows to n/adj-no senses | idea: accept adv senses for 副詞可能 nouns (not implemented) |
| つける "do intensely" | NOT fixed | it is the suffix sense after 圧え|つけ (Sudachi split); not a pipeline bug, needs 押さえつける merge | idea: "(after a verb stem)" prefix |
| なる "bear fruit" | NOT fixed | kana tie 成る/生る; I tried a sense-count tie-break, reverted (4ead6aa) because it flipped はいた to "vomit" and かみ to "god" in the sample | |
| 渡す "ferry across" | NOT fixed, NONE | JMDict sense 0; needs the sense scorer; no context run completed | |
| 人参 "ginseng", からだ "torso" | NOT fixed, NONE | context sense switch (scorer / embedding) picks sense 2 | idea: do not switch to a sense of the same POS/tags when sense 1 is common-flagged |
| むすこ/ぼく/おかあさん/りょうて "(also:)" | fixed, CTX | dictionary.buildHeadline | "(also: …)" only for a plain second sense: no misc tag except uk, no usage note (spelling notes like "esp. 聴く" allowed), no adult gloss |
| からだ "torso" | see above, NOT fixed | | |

## Regression (CTX, 30 sample ids, final code minus the reverted tie-break; run before revert)
Token-level diff vs committed resolved.json: 863 changed tokens, 200 distinct (old,new) pairs.
- ~185 pairs (about 820 tokens): only "(also: …)" removed. Almost all BETTER or neutral (この "last couple of years", とても "(not) at all", いつも "never", 手 "forepaw", 先生 "sensei", ほとんど "hardly", あなた "dear", お父さん "husband"…).
  Mildly WORSE (useful second sense lost): 泣く "suffer", 青い "green", 方 "side of an argument", いただく "to eat", 表す "reveal", 運び "come", 触れた, 住人 "website user" (neutral). About 8 pairs.
- 7 pairs: "— literally: …" note appended to idioms (neutral).
- BETTER: やった "was, were" -> "hooray, yay"; 過ぎた headline "pass (of time)" (in the first run); 開きます.
- WORSE (2, both caused by the sense-count tie-break, since REVERTED in 4ead6aa, not re-verified): はいた "sweep" -> "vomit"; かみ "paper" -> "god, deity".
- Earlier intermediate run showed する/します "to pass (of time)" and とけました "used up (of money or time)" from the time-argument rule; fixed by excluding helper verbs and clause-crossing (e70af50). The final run (the 863-token one) no longer showed them. The only change after that run is the revert, so the final code was not re-run end to end.
Counts (distinct pairs): BETTER ~185 (incl. all "also" cleanups), WORSE 2 (reverted) + ~8 mild losses, SAME/neutral ~7.
Resolved.json files restored (git checkout); branch holds code and tests only.

## Not done / notes
- No full-corpus resolve-content re-run; needed before merge because dictionary.buildHeadline changes ~800 tokens in the sample alone.
- Context-ON verification of ごめん/さす/顆/たつ came from the CTX regression only through diff presence (ごめん, さす, 顆 appear as fixed in the NC run; the CTX diff list shows no counter-example).
- The earlier hang came from several enrich.py processes running at once; all final runs used the shared flock.
