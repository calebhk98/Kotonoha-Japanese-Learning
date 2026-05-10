# Sakura Story Tokenization & Vocabulary Extraction Analysis

> **Updated for #189 (post-grouping-fix).** This document was re-analysed
> after the verb-stem grouping post-process landed in `SudachiWasmImpl.segment()`
> (branch `claude/fix-sudachi-verb-grouping-ZEz4i`, merged PR #195). The
> accuracy numbers and root-cause description below reflect the current behaviour.
> The previous version (pre-#189) is recoverable from git history.

---

## Root Cause — corrected

The original version of this document mis-stated the problem:

> "Tokenizer outputs (good for reading): 描きました = 'painted' (as one
> readable unit)"

That was wrong. Sudachi (modes A, B, and C alike) has always split conjugated
verbs into individual morphemes:

```
描きました → [描き  (動詞, normalized: 描く),
              まし (助動詞, normalized: ます),
              た   (助動詞, normalized: た)]
```

Each morpheme already carried the correct `normalized_form`, so dictionary
lookup for the *stem* was never broken. The real bug was **display
fragmentation**: the server surfaced each morpheme as a separate vocabulary
entry, so learners saw `描き | まし | た` as three words instead of
`描きました` as one.

The #189 fix post-processes Sudachi's morpheme stream in `SudachiWasmImpl.segment()`:
- **Pure conjugation auxiliaries** (`ます`, `た`, `ず`) are appended to the
  preceding verb group, keeping the stem's `normalized_form` as the `baseForm`.
- **Conjunctive て/で** after a verb sets a continuation flag; if the next verb
  is a grammaticalized aspectual/benefactive auxiliary (居る, 呉れる, 貰う, 仕舞う,
  おく, 見る, 有る, 行く, 来る, 上げる, 為る), it is absorbed into the group.
- **Semantic auxiliaries** (たい "want to", ない "not", られる passive/potential,
  させる causative) are intentionally kept as separate tokens so their
  meanings remain visible to learners.

---

## Updated Analysis — BirthdayPresent (Sakura) story

Analysis derived by tracing the post-#189 `SudachiWasmImpl.segment()` logic
against the story text in `src/stories/BirthdayPresent/content.md`.
Counts match the original 44 unique content tokens for direct comparison.

| Category | Count | Examples |
|----------|-------|---------|
| ✅ Working | 34 | 親友, 誕生日, 一週間, 描きました, 考えました, 喜んでくれました |
| ❌ Missing / broken | 6 | 買えませ\*, 描こう†, 嬉しかっ‡, サクラちゃん§ |
| ⚠️ Questionable | 4 | あげたいです¶, プレゼント, ない, 似顔絵 |

**Overall Definition Accuracy: ~77%** (up from ~61% pre-#189)

\* `買えません` (potential negative polite): Sudachi splits as `買え`+`ませ`+`ん`.
`ませ` (normalized: `ます`) groups with `買え`, giving surface `買えませ` with
`baseForm: 買う`. The trailing `ん` (normalized: `ぬ`) falls outside `GROUPABLE_AUX`
and becomes a lone token. `stemming.ts` has an explicit `ません` handler as a
server-side fallback, so full-word lookup still resolves, but the display unit
is truncated.

† `描こう` (volitional): `描こ` (動詞, normalized: `描く`) + `う` (助動詞).
The volitional `う` is not in `GROUPABLE_AUX`, so the group flushes after `描こ`.
Lookup finds `描く` correctly; display shows `描こ` rather than `描こう`.

‡ `嬉しかったです` (adjective past polite): the grouping logic only activates when
`pos === '動詞'`. The adjective `嬉しかっ` (normalized: `嬉しい`) starts its own
group, then `た` and `です` flush separately. Dictionary lookup for `嬉しい`
succeeds via the `baseForm`; the display is fragmented.

§ `サクラちゃん`: proper noun, not in JMDict or kanji-data. Unchanged.

¶ `あげたいです`: intentionally split — `あげ` (`baseForm: 上げる`) + `たい`
+ `です`. This is correct behaviour: `たい` is a semantic auxiliary ("want to")
that learners should see and learn separately. The meaning for `上げる` in a
benefactive context ("give to someone") is sometimes displaced by its literal
"raise" sense in JMDict's default sense order; `getSenseCommonness()` mitigates
this but doesn't eliminate it.

---

## What Works Well (post-#189)

- **Base nouns**: 親友, 誕生日, 似顔絵, お金, 名前, 背景, 一生
- **Simple adjectives**: 高い, 特別, 好き (base form)
- **Common adverbs / particles**: とても, ように, かけて
- **Polite past verbs** (X+ました pattern): 描きました → 描く, 考えました → 考える,
  思いました → 思う, あげました → 上げる, 言ってくれました → 言う
- **Progressive / benefactive て-form chains**: 写っている → 写る,
  喜んでくれました → 喜ぶ

## What Still Doesn't Work

- **Volitional forms** (〜よう / 〜おう): `う` auxiliary is not in `GROUPABLE_AUX`;
  display shows the bare volitional stem.
- **Adjective conjugations** (〜かった, 〜くて): grouping is verb-only; adjective
  tense/te-forms still fragment.
- **Potential + negative polite** (〜えません): `ん` (normalized: `ぬ`) falls outside
  the grouping rules; minor display truncation.
- **Proper nouns / loanwords**: サクラちゃん, プレゼント — inherent dictionary gap.

---

## Solutions Status

| Solution | Status |
|----------|--------|
| Accept lower accuracy as "good enough" | Superseded — accuracy improved |
| **Add verb stemming** | ✅ Shipped — `src/lib/stemming.ts` + server-side fallback in `resolveWordMeaning` |
| **Group verb stems + auxiliaries (post-process)** | ✅ Shipped — `SudachiWasmImpl.segment()` post-processor (#189) |
| Dual tokenization (display vs. lookup form) | Effectively implemented: `surface` = display, `baseForm` = lookup |
| Split on dictionary boundaries (mode A) | Not pursued — investigation showed mode A/B/C produce identical splits for these cases |
| Extend grouping to volitional / adjective forms | 🔲 Open — would push accuracy above ~85% |

---

## Verdict (updated)

**~77% definition accuracy** on the BirthdayPresent story after the #189
grouping fix. The core verb vocabulary (polite past, progressive, benefactive
giving/receiving verbs) now resolves correctly. Remaining gaps are limited to
volitional forms, adjective conjugations, and proper nouns — lower-frequency
and lower-learner-impact than the conjugated-verb class that dominated the
pre-fix missing list.

The next meaningful accuracy gain would come from extending `GROUPABLE_AUX` to
include volitional `う` and adding an adjective-conjugation grouper analogous to
the verb one. Both are incremental additions to `SudachiWasmImpl.segment()`.
