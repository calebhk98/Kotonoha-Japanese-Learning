# Master vocabulary table: design + phase-1 prototype

Worktree `/home/user/wt/vocab-master`, branch `feat/vocab-master`, commit `343a593` (new files only:
`src/lib/vocabMaster.ts`, `src/lib/vocabMaster.test.ts`, `scripts/vocab-master-split.ts`). Nothing pushed.
Output of the full run: `scratchpad/eval/vocab-master-out/{master,docs}`.

## 1. How a word entry is produced today

`resolveContent` (contentResolver.ts) builds `words[]` one entry per distinct token key
(`surface, baseForm, pos, reading, grammarLabel, context, dictionaryForm, idiom, fixed, utterance, kanaAlt`),
so the same dictionary word appears once per context per document. Entry sources:

| Source | Code path | Today's identity of the thing resolved |
|---|---|---|
| Grammar morpheme | `token.isMorpheme` -> `grammarLabel` (per-context label), zero scores, `EMPTY_BREAKDOWN` | surface only |
| Curated "fixed" (numbers, dates, formal nouns) | `token.fixed.meaning`, score = `getWordScoreBreakdown(surface, null)` | none |
| Dictionary word | `WordResolver.resolve(...)`: morpheme guard, supplementary dict, expression, kanji-data (variant for scoring), JMDict `lookup` (entry + senses), compose, name fallbacks | JMDict entry (not exposed) + kanji-data variant |
| Single kana fallback | `'Kana particle / expression'`, `isMorpheme` | surface |

Post passes then mutate copies: idiom (meaning), kanaAlt (`— or: …`), argument tie-break (new entry with
changed `reading/meaning/meanings`, **old `senseSizes` kept**), translation sense switch (new entry with
`contextSense`, rotated `meanings/senseSizes`, headline `"<2 glosses> (also: <sense1>)"`), then `frequencyInContent`
and `dropDominantPolite` (rewrites `form` per document).

What the resolver returns but does NOT store: the JMDict entry (`resolve()` returns `entry`/`variant`, only
the kanji-data `variant` priorities survive, inside `breakdown.priorities`), the JMDict entry id, which source
produced the meaning, `baseForm`. This is the main gap for a real key.

Two facts found by measurement that change the design:
* **`score/jlpt/joyo/breakdown` are computed from the SURFACE** (`getWordScoreBreakdown(wordStr, variant)`), and for
  grouped verb chains the surface includes the auxiliary (`入って行きました` scores the 行 kanji). So within a lemma
  group score varies in ~250 of 124k entries. They are word-level, but per (entry, surface), not per (entry).
* **The scoring variant is a kanji-data variant, not the JMDict entry** (`findBestVariant(baseForm, kanji-data entries)`).
  `variant === null` vs `{priorities: []}` score differently (`kana-no-variant` rule) and the artifact cannot tell them apart.
* kana homographs with identical (lemma, reading) but different entries exist (あい: 愛 / name / 藍; かく: 書く vs name),
  so (lemma, reading) is NOT a sufficient key (19,173 groups) - priorities and sense layout are needed (19,934).

## 2. Field classification

Measured on all 607 artifacts: "varies" = number of key groups (prototype key) where the field takes >1 value.

| Field | Level | Notes / varies |
|---|---|---|
| `word` (surface) | context (spelling) | conjugated surfaces; master holds the dictionary form |
| `reading` | context for inflected/contextual reading; word-level for the headword | master keeps headword reading; slim keeps surface reading |
| `lemma`, `lemmaReading` | word-level (derived) | = master.word/reading when the surface differs; rule `word !== lemma` (36 odd entries lack `lemmaReading`, patched) |
| `pos` | mostly word-level, Sudachi POS is per token | varies in 681 groups -> 1,392 `set` patches (1.1%) |
| `meaning` (headline) | **context** | sense choice, idiom, kanaAlt, grammar label, argument pass; 1,362 groups; 5,626 overrides (4.5%) |
| `meanings`, `senseSizes` | word-level (JMDict entry's senses, native order) | rotated per token when `contextSense`; master stores NATIVE order; 1,793 patches (kanji-data vs JMDict, argument-pass mismatch) |
| `contextSense` | context | 1,759 occurrences; slim stores the index, join rotates and derives the headline |
| `jlpt, joyo, score, breakdown` | word-level (f(surface, variant)) | 22 / 190 / 479 groups vary (surface quirk of grouped chains); ~200 patches |
| `isMorpheme` | word-level (keyed by surface) | |
| `form` | context | conjugation note, later rewritten by `dropDominantPolite` per document |
| `frequencyInContent` | context | per document |
| `senseInfo` | pipeline-only, deleted before storing | needs no home (the scorer uses it during resolution) |

Token fields (`surface,startIndex,endIndex,pos,reading,isVocabWord,isMorpheme,wordIndex`) and `sentences` stay in the slim
document unchanged in phase 1. NOTE: after the split they are the bulk (see measurements).

## 3. Key design

Target key (needs the resolver to expose it):

```
dict:   j<JMDictEntryId>|<writtenForm>|<reading>          e.g. j1358280|食べる|たべる
kdata:  k|<written>|<pronounced>                          kanji-data fallback (no JMDict hit)
names:  n<JMnedictId>|<written>|<reading>
supp:   s|<headword>                                      supplementaryDictionary.ts entry
comp:   c|<surface>|<reading>                             composed meaning (composeUnknown)
fixed:  f|<surface>|<reading>                             numbers/dates/formal nouns (meaning per context)
gram:   g|<surface>                                       grammar morphemes (label per context)
kana:   x|<surface>                                       'Kana particle / expression'
```
`composeUnknown`, supplementary and fixed results are functions of spelling, so spelling is a stable key.
The scoring variant (kanji-data) is derived from the key's written form by the rebuild, so it is not part of the key.

Minimal resolver change to expose it (phase 2, small): `WordResolution` already carries `entry`/`variant`; add
`source: 'morpheme'|'supp'|'expr'|'jmdict'|'jmnedict'|'kanjidata'|'composed'|'fallback'` and
`entryId` (JMDict `id` of `dictResult.entry` / JMnedict id) plus the matched written form, and have
`contentResolver` put a `masterKey` on each word (it already has `lemma`, `form`, the grammar label). `dictionary.lookup`
must return the entry id (it picks the entry in `pickBestEntry`; one extra field). No change to pick logic.

**Prototype key** (what the artifacts allow today): `headword | headwordReading | priorities(joined) | senseSizes(joined)`,
headword = `lemma ?? word`; grammar morphemes `g|<surface>`. Priorities (from the kanji-data variant) and sense layout
act as an entry fingerprint that separates kana homographs. Distance from target: (a) it is derived from word-level data,
so a change in the dictionary's priorities/sense layout would change the key instead of updating the entry (acceptable
for a prototype, wrong for the rebuild story); (b) it can still merge two different JMDict entries with the same
fingerprint (3.0% of entries differ from their group's mode template: handled by `set` patches, so lossless but not
clean); (c) it cannot place fixed/composed/supplementary words in their own namespaces; (d) it has no id to survive JMDict updates.

Key candidates measured (entries off the group's mode word-level template, of 124,410): (lemma,reading) 7,135 / 19,173
groups; +priorities 5,615 / 19,603; +senseSizes (chosen) 3,639 / 19,934.

## 4. Format

```
data/vocab/master/<xx>.json      xx = first byte of FNV-1a(key), 256 shards, ~31 KB / ~78 entries each
src/<type>/<id>/resolved.json    slim document (formatVersion 2), same filename -> loaders stay
```
Master shard: a JSON object, **one entry per line**, keys sorted:
`"食べる|たべる|ichi1,news1,nf15|1.2":{"word":"食べる","reading":"たべる","inflects":true,"pos":"動詞","meaning":"to eat","jlpt":5,"joyo":true,"score":1,"breakdown":{…},"meanings":[…],"senseSizes":[…]}`
Entry = today's word entry of the dictionary form, plus `inflects`. Hash sharding keeps a changed word in one stable file and
avoids hot shards (a first-kana scheme would give か/し shards 10x the size, but is friendlier to hand browsing; a
reviewer uses `git diff` anyway). Server loads all shards at boot: 19,934 entries in ~150 ms.

Slim document: `{formatVersion:2, master:1, resolvedFormat:1, sentences, words:[SlimWord], tokens, local?}` with
`SlimWord = {k, word?, reading?, meaning?, contextSense?, form?, frequencyInContent?, set?, del?}`
(example: `{"k":"食べる|たべる|ichi1,news1,nf15|1.2","word":"食べた","reading":"たべた","form":"past","frequencyInContent":3}`).
`wordIndex` in tokens is untouched (slim `words[]` keeps one entry per old entry, same order).
Only differences are stored: the headline is omitted when it equals the master's or the derived `contextSense` headline;
`set/del` is the lossless escape hatch (2.5% / 0.4% of entries) that also makes a wrong key harmless.
`joinResolved` rebuilds the exact original (same JSON text), so `buildWordsResponse/buildStoryResponse` are unchanged.

"Readers never recompute": the server joins `slim + master` ONCE per content id (0.6 ms/doc, 91 ms for 50 docs including
disk read) and caches the joined document, invalidated when that item's file or the master changes. Joined `breakdown/meanings`
objects are shared references with the master: treat as immutable (JSON serialisation is the only consumer).

Versioning: master `{version}` in `data/vocab/master/_meta.json`; slim docs carry `master` and `formatVersion:2`.
`toResolved(doc, master)` passes a format-1 document through untouched, so the server reads both.

## 5. Imports (`data/imports/<id>.json`)

Today: `{content, resolved, savedAt}` with a full format-1 document. New: `resolved` becomes a slim document.
Keys missing from the shared master go into the slim doc's `local` table (`splitResolved(..., {embedMissing:true})`), so an import
stays self-contained and never writes to the committed master (data/imports is gitignored; master is committed).
A periodic `rebuild-master --include-imports` (or never) can promote local entries. `ImportStore.get` keeps the
`formatVersion === RESOLVED_FORMAT_VERSION` check but must accept 2 and join. Note the import is joined against whatever master
the server currently has, so a master rebuild improves imports too, without re-importing. Failure mode: master entry deleted
-> `joinResolved` throws -> treat like "incompatible format" (`resolved: null`), forcing a re-resolve. Rebuild must therefore never
remove keys that imports reference (keep a tombstone alias table `old key -> new key` if a key scheme changes).

## 6. Reviewability (CLAUDE.md: "the resolved.json diff IS the regression review")

* Word-level change (scoring, sense list, JMDict update): the diff is **only `data/vocab/master/*.json`**, one line per changed
  word. A scoring change touches ~19k lines max, each readable as "word X score 12 -> 15", instead of 124k entries spread over 607 files.
* Context-level change (tokenizer, sense choice, kana conversion, idioms, merges): diff is in the slim docs, as `meaning`,
  `contextSense`, `form`, `k` changes, and token diffs. A word whose master key changes shows as a `k` change = identity change
  (the signal that the resolver picked a different dictionary entry).
* The reviewer can tell the two apart by path. `set/del` lines in a slim doc are a smell list (entries the master could not express).
* inspect-text `--stored` joins before printing, so the output format does not change.

## 7. Migration plan (phase 2 wiring, after the other branches merge)

1. Resolver: `WordResolution.entryId/source`, `dictionary.lookup` returns `entry.id`; contentResolver stamps `masterKey` on each word
   (stays inside `words[]`, as an extra field, until step 3). Replace `masterKey()` here with that key; keep prototype as fallback
   for old artifacts. Run `resolve-content --all` once (the unavoidable full re-resolve).
2. `resolve-content` writes: collect docs -> `MasterBuilder` -> write shards -> write slim docs. Incremental (`--id`): reuse the existing master and
   add missing keys; refuse to overwrite an existing master entry from a single document (only the rebuild script rewrites word-level fields).
3. `loadResolved(id)` in server: read file -> `toResolved(doc, master)` -> cache per id (keyed by mtime of doc + master version). `resolvedFor` and
   `importStore` use it. Both formats accepted, so the artifacts can be converted gradually (`--format 2` flag).
4. inspect-text `--stored`, `analyze-*` scripts: load through the same helper.
5. `scripts/rebuild-master.ts`: for each master entry re-run the word-level stages (kanji-data variant + `getWordScoreBreakdown`, optionally JMDict senses via
   `WordResolver.resolve(headword, …)`), write only changed shards; slim `set` patches for scoring fields (surface quirk) are the one thing it
   cannot reach - fix by making scoring a master-level function of the headword (behaviour change, review the diff) or by moving surface-specific scores into
   `master.surfaces[surface]`.
6. CI: `vocab-master-split.ts`-style round-trip check on a sample, and `npm test` gate.
7. Optional follow-up: slim the tokens (see Measurements).

## 8. Risks

* **Key is a guess today.** Until the resolver exposes the entry id, a JMDict update that changes priorities renames keys. Mitigation: phase-2 step 1.
* **Rebuild only fixes what the master owns.** `meaning` headlines (4.5% of entries are overrides) and the ~2.5% `set` patches are per-document and
  are NOT updated by a master rebuild; a sense-ordering change is therefore still a context-level change needing re-resolution of the affected docs.
* **Grouped-chain scoring** is surface-based (see section 1); a clean master needs a policy decision.
* **Mode-based master**: the stored word-level template is the most frequent one; entries from rare sources (kanji-data vs JMDict, argument pass) are patches. Fine, but the
  master content depends on the corpus; with entry ids the master would instead be authoritative and the patches vanish.
* **Atomicity**: master and slim docs must be committed together (key or `local` missing => join throws). Keep `master` version in each doc and have the loader fail loudly.
* **Memory**: 19.9k entries ~8 MB parsed; joined-doc cache is as large as today's artifacts for the docs in use (use an LRU).
* **Shared object references** in joined docs (not an issue for JSON, an issue for in-place mutation such as WaniKani score multipliers if ever done server-side).
* **Tokens dominate size** after the split, so the headline "smaller repo" benefit is ~40% of gz, not 10x (below).

## 9. Measurements (607 artifacts, 289,579 tokens, 124,410 word entries)

| | raw | gzip -9 (per file, summed) |
|---|---|---|
| Before: resolved.json total | 98.11 MB | 15.13 MB |
| After: master (256 shards, 19,934 entries) | 7.79 MB | 1.73 MB |
| After: slim docs | 53.89 MB | 7.51 MB |
| After: total | 61.68 MB | 9.23 MB (-39%) |
| `words` arrays only, before / after | 54.65 MB / 10.40 MB | 2.34 MB gz (slim words) |

Slim docs now consist of tokens 38.3 MB raw / 4.8 MB gz, sentences 3.1 MB, words 9.1 MB / 2.3 MB gz. Tokens could shrink a lot more in a later step
(surface = text slice, pos/reading/isMorpheme/isVocabWord derivable from the word entry), which is out of scope for this phase.

Counts: 19,934 master entries (vs 124,410 stored entries, 6.2x); slim words with `meaning` override 5,626 (4.5%), `contextSense` 1,759,
`set` patch 3,143 (2.5%: meanings 1,793, pos 1,392, breakdown 268, score 153, jlpt 44, senseSizes 26, joyo 1), `del` patch 550.

Timings (this machine, machine otherwise loaded by other agents):
* build master from all docs: 0.9 s; split all: 0.95 s; join all 607: 0.35 s (0.6 ms/doc); load master from disk: 150 ms.
* **Scoring change** with this design: rescore every master entry from its stored variant with the real `getWordScoreBreakdown`:
  **0.29 s** (19,611 non-morpheme entries; 99.8% reproduce their stored value, i.e. the stored inputs are sufficient) + one-time
  kanji-data index build 4.2 s + writing 256 shards (<1 s). End to end, a few seconds, no jmdict-db, no tokenizer, no translation.
* Full re-derivation from kanji-data per entry (variant lookup like the resolver): 42-48 s, 88.3% reproduce (mismatches: counters/dates `fixed`
  entries, stem lookups; shows the master must record the scoring variant/provenance, as the stored `priorities` + variant-null flag, to rebuild precisely).
* Dictionary-level rebuild (real `WordResolver.resolve` per master entry, 8-way concurrent, jmdict-db, 5.7 s load): sample 2,000 entries took 70.6 s
  = 35 ms/entry, **~11.5 min extrapolated for all 19.6k**, noisy (machine shared). Agreement with the master template on the sample: headline 81%, senses 84%,
  score 92% (probe resolves without sentence context/pos hints, so this measures the probe, not an error rate).
* **Full re-resolve** (today, from the task statement): hours (tokenization + 37k sentence translations + kana conversion). A scoring change: ~seconds
  vs hours; a dictionary-sense change: ~12 min (+ re-resolve only for docs whose context choices depend on it) vs hours.

## 10. Round-trip results

`npx tsx scripts/vocab-master-split.ts --out <dir> [--rebuild-scores] [--rebuild-dict N]`:
* join(split(x)) deep-equals x: **607/607**; identical JSON text (key order too): **607/607**.
* `buildWordsResponse` and `buildStoryResponse` on joined vs original: **607/607** equal.
* Unit tests: `src/lib/vocabMaster.test.ts` (18 tests: rotation inverse, key stability across conjugations/homographs/context sense/morphemes, split/join incl. patches,
  missing-key `local` embedding, master change propagation, both formats, shards, 4 real artifacts per type). `npm run lint` clean.
  `npm test`: 518/519; the 1 failure was a 5 s timeout in `dictionary.test.ts` (`おく as a VERB`) under machine load, which passes (52/52) when run alone.

## 11. How far the prototype is from the target

Done: lossless split/join, sharded serialization, import `local` table, both-format reader, verification and measurements.
Not done / approximated: real entry-id key (proxy used), namespaces for supp/composed/fixed, master provenance fields needed for an exact
`rebuild-master` (variant written/pronounced and source), surface-score policy, writing the master from `resolve-content`, server wiring,
inspect-text, token slimming, alias table for key migration. No existing src/lib file, server.ts or resolve-content was modified.

Commits: `343a593 feat(vocab-master): prototype master vocabulary table (split/join/shards, verification script)` on `feat/vocab-master`.

---

## Owner decisions (2026-10-13), supersede the prototype where they differ

1. **Every token type gets a master entry; no synthetic namespaces.** Source (JMDict / JMnedict name / composed / grammar label / supplementary / none) is a property of the entry, not part of the key. Master grows as stories are added.
2. **Key = spelling + sense.** Spelling = dictionary form in the text's spelling (食べた/食べます -> 食べる; forms stay per token). Sense = JMDict entry id + sense number when JMDict-backed, else the meaning itself (みどり "green" and みどり "(name)" are two entries). Reading is per token with a default on the entry (resolution decides it; the input text has none). 猫 and ねこ are separate entries linked by JMDict id (owner confirmed: keep separate; knowing ねこ is easier than knowing 猫). Rebuild garbage-collects entries no story references.
3. **Imports are stories.** One format, one code path; the app must not be able to tell them apart. Only storage location differs (committed corpus vs gitignored user data); import-only entries live in a local master merged at load time.
4. **Per-stage version stamps on each story** (tokenization, sense choice, context rules, translation, kana conversion; plus master/word-level version on entries). A story is stale if any stage at or upstream of a changed stage is behind. Re-resolve supports "N stale stories at a time" so a change can be tested on 10 stories before the corpus. Versions are hand-bumped constants per stage, documented in CLAUDE.md.
5. **No cross-story sentence cache** (measured: 37,601 sentences, ~4% real repeats after excluding separators/おしまい). Instead, translation and kana-conversion outputs are stored in the story doc as their own versioned stages and reused on re-resolve unless their version changed. TODO: time each stage before claiming translation dominates.
6. **Score from the dictionary form when the token has one**; otherwise from its own spelling. EVERY entry is scored, including names (learning that 田中 is a name is a skill) and grammar tokens (は, です, ので are vocabulary to learn too). Grammar scoring rule TBD (default: same formula as words; particles are JMDict entries with common flags). Note: commit 6a87eae on fix/scoring hides the score box on grammar cards and must be reverted.
