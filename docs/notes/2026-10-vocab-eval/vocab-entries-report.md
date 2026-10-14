# Agent "entries" report (branch fix/vocab-entries, worktree /home/user/wt/vocab-entries)

Commits: 7e9b13c test(vocab) failing tests | 2b1e86e fix(vocab) | c2ed80e fix(vocab) follow-up.
(Tests for 通, ピッ|と, おでん were written red-first locally but committed together with the fix, not in 7e9b13c.)
Lint clean. npm test: 520 pass, 1 fail = dictionary.test "おく as a VERB" (5 s timeout loading real JMDict under machine load; passes when run alone, unrelated to my change).

## Rows (verification level: CTX = text run with translation context ON; NC = inspect-text --no-context only; none)
| Row | Result | Root cause / stage / rule |
|---|---|---|
| おでん "Oden (name)" | FIXED (CTX, web-1) | contentResolver name-from-translation loop: translator leaves words romanized and capitalised; `common` test required a COMMON KANJI form so the uk word おでん (御田) passed as a name. Rule: an untagged kana token that is a JMDict kana headword (or whose katakana base form, e.g. ビードロ, is a headword) is never renamed from the translation; only Sudachi's own name tag overrules. |
| びいどろ "Biidoro (name)" | Same rule applied (baseForm ビードロ is a headword); NOT verified (web-3 context run not completed). NC shows "biidoro, poppin" (ビードロ entry) |
| わーい "Waai (name)" | FIXED (NC) -> "onomatopoeia / sound effect" | DictionaryManager.lookup: JMnedict fallback ran for an interjection. Rule: name fallback only for nouns/unknown POS (NON_NAME_POS). Also kanji-data is now consulted only for words containing kanji (it matched わあい to "common merganser" via a reading). JMDict has no わあい "yay" entry, so the label is generic. |
| ピッと "pit (hole)" | FIXED by unit test only (not seen end-to-end; web-2 ctx run not completed) | tokenContext.mergeDictionaryWords merged ピッ+と into a span whose normalized form hits the loanword ピット. Rule: never merge a span mixing katakana and hiragana without kanji (headwords are single-script). |
| 通 "Tsuu (name)" in 寺町通/二条通 | FIXED (NC) -> reads どおり, "street (suffix of street names: -dori)" | Sudachi tags 通 as a given name. Rule in contentResolver: single 通 tagged 固有名詞 directly after a proper-noun or 2+ kanji token is the street suffix. Small closed-class (one suffix). |
| 清 read きよし / "Qing dynasty" | FIXED (CTX, web-1; NC) -> しん | wordResolver step 4.5: UniDic's name-reading overrode the reading of the JMDict entry shown. Rule: name-tagged token whose gloss is an ordinary JMDict entry takes that entry's reading (compare in hiragana so katakana names keep theirs). |
| 入る reading いる | FIXED (CTX, story-original; also regression sample) | wordResolver passed no reading hint for conjugated tokens, so 入る (いる, "set") won; vocab row lemmaReading = entry reading. Rule: `lemmaReadingFor(surface, reading, lemma)` derives the dictionary-form reading (はいっ -> はいる) and passes it as hint.reading. Side effects (all reviewed better): 辛く -> "painful", 開いた ひらく, 開けた etc. lose spurious "— or:" tails. |
| 少なし / 少なから proverb gloss | FIXED (CTX, web-1; NC web-2) -> "few, little" | Two stages: wordResolver kanji dictionary_form lookup (少なし) accepted a POS-mismatched result, and the answer actually came from the kanji-data fallback (proverb text). Rule: new LookupHint.requirePos for that lookup: JMDict entry must fit POS and no name/kanji-data fallback follows; falls back to the normalized form 少ない. |
| カンナ "plane" vs canna flower | NOT FIXED | JMDict has no separate canna entry (only 鉋 with カンナ as alt kana), JMnedict is names only. Would need a translation-derived gloss for katakana words; not attempted (no signal in dictionaries). |
| より "more" separate row | NOT CHANGED (judged correct) | In "より快適なもの" より is the adverb (JMDict adv sense "more"), so the row is right in context; only the card gives no hint it is the adverb. Possible UI/POS label, not done. |

## Regression (resolve-content on 30 sample ids, context ON, run under the shared flock; 34 distinct changed word entries)
BETTER 25, WORSE 0, SAME 9. All artifact changes reverted (git checkout of src/stories|music|videos).
- BETTER: 白し (Chinese herb -> white), 入る x9 (reading + sense), 開 ひらけ, ぶわ, んた (proverb -> particle), 開けました, 開いた, 開きます, 解いた, 解き, 突か, 注いだ, 埋めてある (spurious "— or:" tails removed), わらわ (name -> child), 恐しい, 覚 (さとり), 長き (Nagashi (name) -> long).
- SAME (garbage before and after, fragments): ほ, ばし, おわ, ウー, う, あおむ, ぼさ, 止まります, 止まら.
No-context 4-text diffs (before vs after): only intended rows plus 辛く (spicy -> painful), 得る, 留める, 漁る tail changes (all neutral/better), イトイ "all pungs" -> Unknown meaning (kanji-data junk removed).

## Not verified / limits
- Context-ON runs of web-2 and web-3 did not finish before wrap-up (killed): ピッと, びいどろ, わーい, 通, カンナ were not seen in the context-ON pipeline end to end. わーい/通 verified NC; ピッと and びいどろ only by unit tests / rule reasoning.
- Not re-run: full-corpus resolve-content; the real-app vocab view (buildWordsResponse grouping untouched).
- Left unfixed by design: カンナ, adverb より labelling.
