# Handoff: vocab-list evaluation round (Oct 2026)

Start here if you are picking up this work. CLAUDE.md links to this file.

## What happened

1. **UI-level evaluation.** Four ~3,000-char texts were imported through the real UI
   (`scripts/dev/ui-eval.mjs`): an original N4-N3 story (`test-story-original.txt`), a
   note.com feature on oden in China (https://note.com/eichan_sh/n/n17b76d5fbcb3), five
   entries of a personal Scrapbox diary (https://scrapbox.io/juneboku, 2023-02-13..17) and
   the opening of Aozora 『檸檬』 (https://www.aozora.gr.jp/cards/000074/files/424_19826.html).
   Sonnet graders reviewed each **vocab list blind** (no text), then the **reader hovers in
   context**.
2. **Results (before the fixes in this PR):**

   | | Story | Oden | Diary | 檸檬 |
   |---|---|---|---|---|
   | Blind list WRONG rows | 5 / 487 | 4 / 570 | 4 / 536 | 16 / 611 |
   | Hover WRONG in context | 3.2% | 1.4% | 1.7% | 2.8% |
   | Gist from hovers alone (1-5) | 4 | 4 | 4 | 3 |

   29 blind WRONG rows of 2,204 (1.3%): 16 flatly wrong for the word as written (garbage
   proverb gloss for 少なし, 清 きよし "Qing dynasty", "(name)" on おでん/わーい/びいどろ,
   ピッと "pit", fragments 檸|檬の), 13 a real sense but the wrong headline (さす "pour" for an
   umbrella, ごめん "permission", 渡す "ferry across"). About 60% of in-context WRONG hovers come
   from cards that look fine (辛い "painful" where spicy is meant), so the blind list review is
   a weak gate; both levels matter.
3. **Fix branches merged in this PR** (each agent's report is in this folder):
   - `fix/scoring`: kana-only common words (これ, とても, ドア) fell to the +50 "no frequency
     tag" fallback (score 65) because the penalty used kanji-data tags only. Now JMDict's
     `common` flag is used when kanji-data has no tags. The shipped JMDict JSON has NO
     ichi1/news1/nf tags at all, only `common` booleans. See `scoring-report.md`.
   - `fix/vocab-segments`: kana conversion may not rewrite kanji the text already has (檸|檬の);
     a bare two-kanji word is never glossed as the sum of its characters (中専); set phrases
     keep their own row (かかわらず, ください); one row per word for する/ある/いる forms,
     inflected spans and sense-switched entries. See `vocab-segments-report.md`.
   - `fix/vocab-entries`, `fix/vocab-senses`: see their reports (`vocab-entries-report.md`,
     `vocab-senses-report.md`).
   - `feat/vocab-master`: phase-1 prototype of a master vocabulary table (new files only, not
     wired in). See `vocab-master-design.md`.

## State you inherit (important)

- **Committed `resolved.json` artifacts are STALE.** The merged code changes resolution
  output (scores for most items, grouping, some glosses), but the corpus was NOT re-resolved
  (a full `npm run resolve-content -- --all` takes ~6 h on a quiet 4-core machine). Disk
  content is served from these stale artifacts; imports use the new code. Re-resolve before
  or right after merging, then review the artifact diff (CLAUDE.md: that diff is the
  regression review). Run it ALONE on the machine (see next point).
- **Regression coverage is partial.** Some fixes were checked only with `--no-context`
  (no translation model) on a 30-item random sample (ids in "Sample" below); the
  context-dependent parts (kana-conversion guard, sense-switch row merge) only by unit tests.
  The per-agent reports say which rows were verified how.
- **Never run two context pipelines at once.** `scripts/context/enrich.py` fixes torch at 4
  threads; with 3-4 helpers on 4 cores they spin-wait and run 20-60x slower, which looks
  exactly like a hang (100% CPU, no progress). This cost hours here. Serialize with
  `flock <lockfile> <command>`. Do NOT "fix" it with timeouts or load-dependent thread counts:
  output must not depend on machine load. See `kana-hang-report.md`.
- `npm test`: the おく homograph test in `dictionary.test.ts` has a 5 s timeout that fails on
  a loaded machine and passes alone.

## Next steps (in order)

1. **Re-resolve the corpus** (alone on the machine) and review the artifact diff, sampling
   BETTER/WORSE per changed token; fix or revert anything WORSE.
2. **Grammar tokens get scores.** Owner decision: は, です, ので etc. are vocabulary to learn
   and must be scored like words (today: score 0 and "?" pts on the card). Default rule to
   try: the same formula as words (particles are JMDict entries with `common` flags).
3. **Master vocabulary table, phase 2.** Owner decisions are at the end of
   `vocab-master-design.md` and supersede the prototype: every token type gets an entry (no
   synthetic namespaces; source is a property), key = spelling (dictionary form in the
   text's spelling) + sense, reading per token, imports are stories (same format and code
   path; only storage differs), per-stage version stamps on each story so a change can be
   re-resolved on N stale stories at a time, translation/kana-conversion outputs stored as
   their own versioned stages and reused on re-resolve, score from the dictionary form when
   one exists, names and grammar scored, 猫 and ねこ separate entries.
   Open question for the owner: "counts on each token": per-entry corpus-wide counts
   (occurrences / number of stories) vs. something else. Ask.
4. **Names** (largest remaining error source; みどり was "green" 21 times and
   "Midori (name)" 5 times in one story by design of the current propagation rule,
   contentResolver.ts ~l.186-250). Ranked methods in `names-research.md`: document-level
   evidence propagation with a context-fit test, suffix grammar (寺町通 street, 〜賞), positive
   evidence before "(name)" on common kana words, brand grouping from MT capitalisation.
   Owner rule: no hard-coded word lists; the owner tests with new random texts.
5. **Remaining blind-list rows not fixed:** see the "not fixed" sections of the agent
   reports (archaic okurigana splits 蘇える / 落ち魄れる, 動きかける's JMDict gloss, カンナ
   "plane" for the canna flower; JMDict has no flower entry).
   Known issue the entries agent mis-graded as better: 辛い/辛く in a food context shows
   "painful" because UniDic reads it つらい and the new dictionary-form reading hint
   (`lemmaReadingFor`) now carries that reading faithfully. With context ON it was already
   "painful" before, so production is unchanged, but the no-context runs went
   spicy -> painful. Fix belongs in reading/sense choice (the translation says "spicy").
6. Re-run the UI evaluation on NEW random texts (fetch fresh ones; don't reuse these four
   as the only yardstick) and compare with the table above.

## Sample

30-item regression sample used by the agents (seed 20261013):
watashi-no-shoukai, Shaved-Ice, nihongo-no-mori-n2-keigo-advanced, n3-cooking-for-guests,
Fuyu-Geshiki, Kagaku-Repo, rinjin-ep5-shinjin-getsuyoubi, Goldfish, Yabu-no-Naka,
teppei-beginners-weather, Hitori-de-Dekita, Cherry-Blossom-Viewing, Uchu-Kansatsu-Club,
nihongo-no-mori-n2-grammar, nhk-etele-pythagoras-switch, Kawa-de-Asobu, Zoo,
Listening-Music, Shoubousha-no-Ichinichi, tetsugaku-ep3-kioku-no-shinraisei,
Ichijiku-Ninjin, NezumiYomeiri, Fuwa-Fuwa-Kumo, Mise-no-Hito, Umi-no-Takaramono, Rashomon,
tedx-tokyo-innovation, n3-complaint-letter, n5-riding-the-bus, rinjin-ep8-nigatsu-no-rouka
