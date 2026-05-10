# Sakura Story Tokenization & Vocabulary Extraction Analysis

## How the tokenizer works

Sudachi (all modes A/B/C) splits conjugated verbs into individual morphemes,
each carrying a `normalized_form` that maps back to the dictionary base form:

```
描きました → [描き  (動詞, normalized: 描く),
              まし (助動詞, normalized: ます),
              た   (助動詞, normalized: た)]
```

`SudachiWasmImpl.segment()` post-processes this morpheme stream to group related
morphemes into single display tokens while preserving the stem's `normalized_form`
as the `baseForm` for dictionary lookup:

- **Pure conjugation auxiliaries** (`ます`, `た`, `ず`) are appended to the
  preceding verb group.
- **Conjunctive て/で** after a verb sets a continuation flag; if the next verb
  is a grammaticalized aspectual/benefactive auxiliary (居る, 呉れる, 貰う, 仕舞う,
  おく, 見る, 有る, 行く, 来る, 上げる, 為る), it is absorbed into the group.
- **Semantic auxiliaries** (たい "want to", ない "not", られる passive/potential,
  させる causative) are kept as separate tokens so their meanings remain visible
  to learners.

Each token has `surface` (what the learner sees) and `baseForm` (what gets
looked up in the dictionary). These are the same for uninflected words and
differ for conjugated ones.

## Analysis Results — BirthdayPresent (Sakura) story

Traced against `src/stories/BirthdayPresent/content.md` using the current
`SudachiWasmImpl.segment()` logic.

| Category | Count | Examples |
|----------|-------|---------|
| ✅ Working | 34 | 親友, 誕生日, 一週間, 描きました, 考えました, 喜んでくれました |
| ❌ Missing / broken | 6 | 買えませ\*, 描こう†, 嬉しかっ‡, サクラちゃん§ |
| ⚠️ Questionable | 4 | あげたいです¶, プレゼント, ない, 似顔絵 |

**Overall Definition Accuracy: ~77%**

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

§ `サクラちゃん`: proper noun, not in JMDict or kanji-data.

¶ `あげたいです`: intentionally split — `あげ` (`baseForm: 上げる`) + `たい`
+ `です`. This is correct behaviour: `たい` is a semantic auxiliary ("want to")
that learners should see and learn separately. The meaning for `上げる` in a
benefactive context ("give to someone") is sometimes displaced by its literal
"raise" sense in JMDict's default sense order; `getSenseCommonness()` mitigates
this but doesn't eliminate it.

## What Works Well

- **Base nouns**: 親友, 誕生日, 似顔絵, お金, 名前, 背景, 一生
- **Simple adjectives**: 高い, 特別, 好き (base form)
- **Common adverbs / particles**: とても, ように, かけて
- **Polite past verbs** (X+ました): 描きました → 描く, 考えました → 考える,
  思いました → 思う, あげました → 上げる, 言ってくれました → 言う
- **Progressive / benefactive て-form chains**: 写っている → 写る,
  喜んでくれました → 喜ぶ

## What Doesn't Work

- **Volitional forms** (〜よう / 〜おう): `う` auxiliary is not in `GROUPABLE_AUX`;
  display shows the bare volitional stem.
- **Adjective conjugations** (〜かった, 〜くて): grouping is verb-only; adjective
  tense/te-forms still fragment.
- **Potential + negative polite** (〜えません): `ん` (normalized: `ぬ`) falls outside
  the grouping rules; minor display truncation.
- **Proper nouns / loanwords**: サクラちゃん, プレゼント — inherent dictionary gap.

## Possible Improvements

- Extend `GROUPABLE_AUX` to include the volitional `う` — would fix 描こう-class tokens.
- Add an adjective-conjugation grouper in `SudachiWasmImpl.segment()` analogous
  to the verb one — would fix 嬉しかった-class fragmentation.
- Either change would be an incremental addition to the post-processor and
  should push overall accuracy above ~85%.
