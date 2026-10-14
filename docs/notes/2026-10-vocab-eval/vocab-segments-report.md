# vocab-segments report (branch fix/vocab-segments)

Environment: machine overloaded; enrich.py (translation context) hung on the sample, so the regression was run with --no-context on OLD vs NEW code (identical settings); the 4-text check used no-context too. The kana-conversion fix is covered by a unit test only.

## Rows
- 檸 / 檬の: FIXED (unit test only). Root cause: kanaConversion (zenz) re-converts a sentence that already holds kanji (その檸檬の冷たさは... is "kana heavy"); converter rewrote 檸檬, alignment then invented 檸 + 檬の. Rule: kanji already in the text are never the converter's to change; reject a conversion whose kanji do not contain the original's kanji in order (keepsKanji, kanaConversion.ts).
- びい (split of びいどろ): not reproduced without context; same stage (kana conversion) likely, 3 other split causes unverified. Probably addressed by the same guard only if the converter changed kanji (it did not: the sentence has none), so NOT FIXED / unverified.
- 蘇 "Soviet Union", 落|魄: NOT FIXED. Sudachi splits archaic okurigana verbs (蘇える -> 蘇|えっ; 落ち魄れる -> 落ち|魄|れ). JMDict has 蘇える, 落魄れる; fixing needs a deconjugator for kanji+kana fragments (large; described only).
- 中専: FIXED. composeUnknown generic noun split summed two single-kanji glosses. Rule: a bare two-kanji word is never composed from its characters (wordResolver.ts, bareJukugo). Now "Unknown meaning" (honest).
- かかわる "in spite of": FIXED. Set phrase (JMDict expression かかわらず) resolved from the inflected surface was filed under the lemma. WordResolution.viaPhrase; contentResolver skips lemma grouping. Row is now かかわらず.
- 動きかけた "to make someone move": NOT FIXED. JMDict itself has 動きかける with that single gloss; mergeDictionaryWords merges 動き|かけ|た into it. Would need a commonness signal for headwords (uncommon headword ending in an auxiliary-use 非自立可能 verb should compose via the aux table). Left.
- Grouping (MINOR): FIXED in buildWordsResponse / contentResolver:
  - grammar-table verbs (し, した, して, したら, させ, ある, あった, あり, いる, い, いて) carry lemma and group to one row (する, ある, いる) with forms.
  - sense-switched twin (すごい x2, みどり x3 "green"/"greenery") shares the row of its unswitched entry.
  - rows keyed by lemma reading + headline, so 言う/いう (and 一人 variants) merge; かた vs ほう "person" stay apart.
  - merged conjugated spans (立ち留まっ, 素晴しかっ) get lemma (new TokenInfo.inflected).
  - Not merged: ない "not" (aux) vs ない "nonexistent" (different headlines, intentional per-meaning rows), 時どき (senses agent).
  Four-text vocab rows: 2188 -> 2130.

## Regression (28 of 29 sample items, Fuwa-Fuwa-Kumo excluded, no-context OLD vs NEW)
Token meaning/reading/segmentation diffs: 1 (Yabu-no-Naka 時風 "time + wind" -> Unknown meaning): SAME-ish/judgement, counted WORSE 0 / BETTER 0 / SAME 1.
Word-level lemma grouping changed in 539 word entries (all grouping/label rows, e.g. お願い申し上げます, 靴を磨く, 気がする now filed under dictionary form; ください/やった no longer filed under くださる/やる). No WORSE seen.
Note: I did not re-run with the translation context (hang), so context-dependent effects (sense-switch rows, kana conversion guard) are checked by unit tests and the four-text no-context run only.

## Commits
a5c400a test(vocab) rows; 99310f2 test(vocab) kana kanji; 3e5a171 fix(vocab) grouping/viaPhrase/kana guard; plus the last commit "test+fix(vocab): do not compose a two-kanji word" (see git log).
lint: tsc clean. npm test: all pass (one dictionary.test timeout flake under load, passes alone).
