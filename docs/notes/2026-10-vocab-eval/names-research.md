# Recognising names, places, organisations, products and brands in Japanese text

Scope: Kotonoha offline pipeline (Node + Python venv, CPU, 4 cores). Date 2026-10-13.
Confidence labels: [V] = verified from a fetched page this session, [K] = general knowledge not re-verified now, [U] = unverified.
Time spent on web research was limited; many numeric claims are [U] and flagged.

## Part 1. Human readers

Cues, roughly from strongest to weakest:
1. Honorific/title directly after: さん くん ちゃん 様 氏 先生 殿 君. Nearly decisive for a person, even for hiragana (みどりさん). Also kinship-like titles (社長, 部長) after a surname.
2. Introduction frames: Xと申します / Xです / Xという(名前/人/店) / Xと呼ばれる / Xって(いう) / 名前はX / 通称X / 略してX.
3. Typography: 「」『』 around a title or name, ruby on an unusual reading, parenthetical reading (X(よみ)), Latin capitals or romaji, katakana for foreign names and for brands/characters, all-kana or mixed script for mascots and product names.
4. Morphology of the string itself: surname+given pattern (2+2 kanji, 1+2), name-kanji and endings (子 美 郎 太 蔵 助), place suffixes (町 市 県 駅 通 川 山 橋 公園), organisation suffixes (株式会社 社 大学 銀行 協会 賞 組), product suffixes (シリーズ 号 版).
5. Syntax/sentence role: a name is the topic/subject of many varied verbs (Xは/Xが ... 言った/笑った), takes vocatives (Xさん、), is addressed in quotes, never takes modifiers like adjective+X or "この/その X" (except の-modifiers for characters).
6. Discourse consistency: once a string is established as a name it is read as the same name throughout (one sense per discourse); first mention is often fully marked (surname+given+さん), later mentions are bare. Humans use the full first mention to interpret later bare mentions.
7. World knowledge (famous people, brands, shops). Learners lack this; they rely on 1-6 and on the translation.

Hard even for humans: hiragana names that are ordinary words (みどり, ひかり, まめ, さくら, あおい, ゆき); brand names built from common words (明治エッセルスーパーカップ, ホットクック); kanji names whose parts are common words (孫 泰蔵, 中山); old words that look like names (びいどろ, おでん); stylised interjections (わーい). Humans resolve these almost only by cues 1, 2, 5 and 6; without them a first mention can be ambiguous and readers wait for later evidence. This argues for propagating evidence across the document and for a visible "unsure" state.

(Part 1 is synthesis from general linguistics and from the failures in this repo; no single source. [K])

## Part 2. Programs

### 2.1 Morphological analyzers
- Sudachi (UniDic-derived POS in this app: 名詞,固有名詞,人名/地名/組織,{姓,名,一般}). Example from the sudachi.rs README: 高輪ゲートウェイ駅 and 選挙管理委員会 come out as 名詞,固有名詞,一般 in default (C) mode [V: https://github.com/worksapplications/sudachi.rs, via search snippet]. Known weaknesses [K, matching this repo's own CLAUDE.md]: tags many hiragana common words as names (おでん, わーい, びいどろ in these failures), splits rare/new names and brand names into common words, tags suffixes like 通 as a name piece. No published precision/recall per tag found [U].
- MeCab+IPAdic has 固有名詞/人名/地名/組織 too; IPAdic is old (NAIST BSD-style license) [K]; same weaknesses plus an older vocabulary.
- Takeaway: POS 固有名詞 is a good prior (recall of known names), poor as a decision (precision on hiragana and on suffix pieces).

### 2.2 Name dictionaries
- JMnedict/ENAMDICT (EDRDG): counts by type, e.g. surnames 138.5k, places 99.5k, unclassified person 139k, female given 106.3k, male given 14.5k, full names 30.5k, stations 8.3k, but only 55 product and 34 company entries; license: free use with acknowledgement (plus EDRDG conditions) [V: https://www.edrdg.org/enamdict/enamdict_doc.html]. Implication: good for persons/places, almost useless for brands/products/organisations. Many entries are also common words (みどり, ひかり), so presence in JMnedict is not evidence of a name.
- mecab-ipadic-NEologd: Apache-2.0; about 3.22M surface/furigana pairs; max binary ~1.2 GB, needs 2 GB RAM (6 GB recommended); sources include Hatena Keyword dump, postal codes, station lists, person names, web crawl; README promises twice-weekly updates but the page shows copyright 2015-2019 and I could not confirm a recent commit [V: https://github.com/neologd/mecab-ipadic-neologd]. Treat as stale for new brands [U for exact date]. This repo already tried NEologd (2020 seed) and found it lacks the single-name tokens graders flagged (CLAUDE.md). It targets MeCab/IPAdic, not Sudachi, so reuse needs conversion.
- Wikipedia/Wikidata-derived entity lists: titles of Japanese Wikipedia articles (brands, products, organisations, works) are the obvious source for brand/product names. Wikipedia text is CC BY-SA; Wikidata is CC0 [K]. Size of a useful offline extract (title + redirects + category) is on the order of a few million strings [U]. Same issue as NEologd: long-tail brands change quickly, and many titles are common words (disambiguation pages) so a match alone is weak evidence.
- Company/product lists (e.g. government corporate number registry, 国税庁 法人番号 data) exist and are open [K, U for license details]; only useful for the legal-name form (株式会社X), not the colloquial brand name.

### 2.3 Statistical/neural NER
- GiNZA (spaCy; MIT license). Models ja_ginza (speed-oriented) and ja_ginza_electra / ja_ginza_bert_large (transformer; README says they need at least 16 GB memory). NER labels: Sekine's Extended Named Entity Hierarchy (~200 types incl. product, organisation, facility) and extended OntoNotes5; trained on a part of GSK2014-A (BCCWJ). Transformer weights download from the Hugging Face Hub on first run [V: https://github.com/megagonlabs/ginza]. README gives no NE F1 and no absolute speed; ja_ginza package ~59 MB [V via search snippet: https://pypi.org/project/ja-ginza/]. NE F1 figures and CPU latency are [U]. Note GiNZA uses SudachiPy internally, so its tokens would differ from this app's WASM Sudachi.
- Stockmark Wikipedia NER dataset: 5,343 sentences, 4 MB, CC-BY-SA 3.0, eight labels: person, location, corporation, political org, other org, facility, product, event [V: https://huggingface.co/datasets/stockmark/ner-wikipedia-dataset]. A third-party fine-tune of tohoku-nlp/bert-base-japanese-v3 on it reports F1 0.8428 (overall) [V that the repo claims it; single personal project, https://github.com/KeshavSingh29/fa_ner_japanese]. Wikipedia-trained: expect a drop on stories, lyrics and blog text [K]. A BERT-base model is about 110M params / ~440 MB, CPU latency roughly tens of ms per sentence with ONNX/quantisation [K, U].
- KWJA (Kyoto Univ.; MIT): performs NER among many tasks, sizes tiny/base/large, CPU allowed. The performance table lists NER 84.6 (v2 base) and 85.9 (v2 large) with unnamed metric, 83.0/82.1 for v1 [V: https://github.com/ku-nlp/kwja]. Speed not reported; large is slow on CPU [U]. Also includes coreference, which is the discourse-consistency signal in model form.
- Stanza ja: one NER model gsd.pt, 54.3 MB; no published F1 found; Stanza's paper has no Japanese NER row [V: https://huggingface.co/stanfordnlp/stanza-ja]. OpenNER reports Japanese GSD F1 83.46 for XLM-R, 81.08 mBERT (not Stanza) [V via snippet: https://arxiv.org/pdf/2412.09587].
- Cross-cutting: NER corpora are news/Wikipedia; they rarely include hiragana-only character names or mascots; the NER literature itself lists unknown words, hiragana names, and brand/character classes as weak points (a Japanese survey search returned nothing specific about ひらがな人名 or ブランド名 [U]).

### 2.4 Document-level consistency
- One sense per discourse: Gale, Church & Yarowsky 1992, ~94-96% same-sense for polysemous nouns in the same document [V via a later paper's summary: https://aclanthology.org/H92-1045/ ; numbers from Barrena et al. 2014 https://preview.aclanthology.org/fix_video/C14-1213.pdf]. The same paper reports the hypothesis holds for 96-98% of documents for named entities [V via snippet, claim from that paper, I did not read the paper].
- NER with global features: Chieu & Ng 2002 use other occurrences of the same token in the document (title https://aclanthology.org/C02-1025.bib; exact feature design [U]).
- Method: collect high-precision evidence per surface (honorific after, introduction frame, tagged-name POS, translation capitalised), then label every occurrence of the surface in the document consistently unless the local context contradicts (modifier before it, a different POS, kanji variant). This is label propagation; the repo already does a weak version (the `confirmed` map in contentResolver.ts).

### 2.5 MT + alignment signal
The pipeline already uses capitalised mid-sentence words of the FuguMT output (nameFromTranslation.ts). Weakness shown in failures: MT translates the name as a word (みどり -> "Greenery"), so absence of a capitalised romanisation is not evidence against a name, and MT sometimes capitalises unknown words (ほし "Hoshi", せんせい "Sensei"), so presence is not strong evidence either. Better use: the MT output is a consistency check across sentences (does the same Japanese surface surface as the same capitalised English token in several sentences?). No literature figure found [U].

### 2.6 LLM approaches (reference)
Prompting an LLM with the passage gives the best accuracy, especially for hiragana characters and brands, and could produce a per-document entity list [K, U for numbers]. Not offline-CPU feasible at the needed scale in this app; a small local LLM (1-3B) would be slow on 4 cores. Could be used once at build time, offline in dev only (the app's resolve-content step), if the project rules allow a one-time-generated artifact; otherwise skip.

### 2.7 Transliteration matching
Kana -> romaji compared with a capitalised English token. Already implemented (romanizeKatakana + loose spelling + skeleton). Works when MT transliterates; fails when MT translates (Greenery) or merges (Chibatetsuya Award). Variant: compare against the multi-sentence set of English capitalised tokens and allow a prefix/substring match inside a longer capitalised token (Chibatetsuya contains chiba+tetsuya), which would bridge the ちば|てつや case. The repo's current rule needs equality of loose spellings for exact matches.

## Part 3. What the pipeline already does (read-only)

- Sudachi 固有名詞 tags feed `properNoun`/`placeName`/`nameType` flags in contentResolver.ts (~l.552); wordResolver trusts JMnedict only for person/place/organisation tags (wordResolver.ts ~l.533-538).
- contentResolver.ts ~l.186-250: hiragana word followed by ちゃん/くん >= 2 times is a name; with さん only if not a common kana word (so みどりさん is excluded because みどり is a common word); a common word becomes a name only for occurrences that are Sudachi-tagged or followed by an honorific, and only if the translation spells it (kanaNameIn). A tagged hiragana name that the translation does not spell and that is a common word is demoted to the common word.
- nameFromTranslation.ts: katakana runs (up to 4 tokens) matched to capitalised mid-sentence English words, with a skeleton-consonant match and matching opening syllable; kanaNameIn for hiragana (>=4 letters or capitalised 3-letter mid-sentence name; "san/chan/kun/sama" suffix forms).
- tokenContext.ts ~l.590-640: traditional given-name merge (kanji + 蔵/衛門/郎...), katakana fragment runs get one token and an honest label.
- Hard-coded one-off: あおい -> Aoi (contentResolver.ts ~l.180). This is a word list case and does not generalise.
- CLAUDE.md "Rejected": demoting a kana name that is also a common word broke ~22 names; NEologd (2020 seed) lacks most single-name tokens; embedding sense chooser for names; entry switching.

### Diagnosis of the listed failures
| Failure | Why it happens (from code) |
|---|---|
| みどり: 5 "Midori (name)" + 21 "green" | `count` for さん requires non-common word, so みどり is never `confirmed` by honorific alone. kanaNameIn gets "Greenery", so no match. The 5 name tokens come from the tagged-and-honorific path; the other 21 bare mentions have neither tag nor honorific, so they stay words. No document-level propagation of the honorific evidence. |
| ちば\|てつや (hiragana, 「ちばてつや賞」) | Two common-word tokens, no merge rule; MT output "Chibatetsuya" is one capitalised token that no single token matches; no 賞 suffix / 「」 rule for hiragana runs. |
| 孫 泰蔵 | Names are recognised by `weak/strong` suffix rules only when the first piece is a kanji not already tagged; here 孫 is a common noun and a space separates the parts; no surname+given pairing across a space or with MT "Son Taizo". |
| Brands 明治エッセルスーパーカップ, ホットクック, R-1 | Brand = known words concatenated; no signal for "this is one product". Sudachi splits it; MT output may keep it capitalised ("Meiji Essel Super Cup"). Katakana-run fragment rule only applies to katakana-only runs and gives an honest label rather than a merge when the pieces are real words. |
| 寺町通 / 二条通: 通 "Tsuu (name)" | 通 after a place-name kanji tagged as 固有名詞 is treated as a name piece; no suffix rule (通=どおり street, 町, 駅, 県 etc.) that glues the suffix to the preceding name and glosses it as a place. |
| わーい / おでん / びいどろ "(name)" | Sudachi tags these 固有名詞 or JMnedict hits; the sanity check demotes a tagged hiragana word only when a translation exists and it is a common kana word, but these were kept (no honorific, MT left romanised: おでん "Oden", びいどろ "Biidoro"). No requirement for positive evidence beyond the tag. |

## Ranked recommendations (general methods, no word lists)

### 1. Document-level evidence propagation for names (label consistency)
What: per document, build an evidence table per surface (and per surface+reading): honorific follows (さん くん ちゃん 様 氏 先生), introduction frame (と申します, という名前, と呼ばれ), 「」 title/award context, Sudachi 固有名詞/人名 tag, translation capitalised. If a surface has strong evidence (>= 2 independent occurrences, or one honorific + one other signal), label the other occurrences as the name only when their local context fits a name: used as subject/topic (は/が/も/の/と after), not preceded by a modifier (adjective, この, 連体詞, a number), not followed by a noun/suffix forming a compound, and not in a quote of a colour/word context. Otherwise leave as ambiguous and show both ("Midori (name) — or: green") instead of picking one. Extend the existing `confirmed` map: allow common-word hiragana (みどり) when the honorific count is >= 3 or the bare-subject ratio is high, with `taggedOnly` replaced by "context-fits-name".
Fixes: みどり (the 21 bare mentions), likely 孫/泰蔵 repeats, ゆうた-style cases kept.
False-positive risk: common words used as colour/word in the same text (みどり green in a story with a Midori): mitigated by the context-fit test and the "— or:" display. Repeated honorific on an animal/object (くまさん "Mr. Bear") stays covered by existing strict mode. CLAUDE.md records a past regression when demoting kana names, so the test must be the corpus BETTER/WORSE diff, not a rule on its own.
Cost: pure TypeScript, negligible CPU. 1-2 days.
Measure: (a) on the 4 graded eval texts plus the 10 random stories used before, count name-vs-word flips; (b) an automatic yardstick: texts where names are marked by ruby or honorifics (Aozora, stories in this corpus) — hold out honorific evidence, check that propagation recovers the same surface; (c) all-items diff review (resolve-content -- --all) graded BETTER/WORSE, as the repo already does.

### 2. Suffix and affix grammar for names (places, organisations, awards, titles) as a merge step
What: general rules, not lists. Name-piece (固有名詞 or a name-like run) + suffix class: 通 町 市 区 県 駅 橋 川 山 寺 公園 大学 協会 賞 社 会社 株式会社 さん様 氏. Merge into one token and gloss with the suffix meaning ("Teramachi-dori street", "X Award", "X Co."). Add the reverse guard: a suffix of this class never gets its own "(name)" gloss, it keeps the suffix sense (通 -> street/どおり after a place name; the counter/other senses stay elsewhere). For hiragana/katakana runs ending in 賞 or inside 「」 + 賞/展/杯, merge the run into one title token and use the MT capitalised token (Chibatetsuya) as the display, matched by substring/prefix of the concatenated romaji rather than equality of a single token.
Fixes: 寺町通, 二条通, ちばてつや賞 (with MT substring match), partly 孫 泰蔵 (surname + given across a space/with MT "Son Taizo": use the MT two-token capitalised pair as confirmation for kanji pairs where one piece is a common noun).
False-positive risk: 通 as "pass through/expert" (通りに, 日本通 "Japan expert"), 町 as a town word (町の人). Require: preceding token is 固有名詞 or tagged place/kanji run, the suffix is not followed by に/り inflection that makes it a verb, and fall back to the word reading otherwise.
Cost: TypeScript, small, similar to the existing given-name merge in tokenContext.ts. 1 day.
Measure: grep the corpus (resolved.json) for tokens where the suffix class follows a 地名/固有名詞 token; review the diff; check unit tests for positions/merging (well-defined behaviour, TDD applies).

### 3. Require positive evidence before showing "(name)" for tagged hiragana/common-word entries; show uncertainty instead
What: a token tagged 固有名詞 (or found only in JMnedict) that is a short hiragana/katakana word, an interjection-like stretched kana, or has a common JMDict reading with a consistent meaning is shown as the word unless one of: honorific follows, introduction frame, in a title position (「」/『』), or MT capitalises it mid-sentence in a majority of its sentences (not just one). Otherwise show the common meaning with a note "(could be a name)" or "unknown". Stretched forms (わーい, ー/〜 variants) are routed to the existing interjection labels first. This is the "unknown over confidently wrong" principle applied to the (name) label itself.
Fixes: わーい, おでん, びいどろ (names wrongly shown), likely other tagged-but-common cases.
False-positive risk: real hiragana names without any cue become "word" instead of "name"; mitigated because method 1 propagates cues from other mentions and the note keeps the name possibility visible. CLAUDE.md records a rejected blanket demotion that broke ~22 names (なな, けんじ), so keep the demotion conditional on the absence of any cue and only for tokens that have a common-word entry with a high-frequency gloss.
Cost: TypeScript, trivial. Half a day.
Measure: corpus diff on all hiragana 固有名詞 tokens; sample 200 changed tokens, grade BETTER/WORSE; also confirm names such as ゆうた, めい stay named.

### 4. Brand/product-name grouping from MT capitalisation and mixed-script cues
What: use the MT output at span level. If a maximal run of adjacent tokens (kanji + katakana + Latin/digit, no particle, no verb inflection) is translated by FuguMT into a capitalised multi-word span that appears verbatim in the translation (e.g. "Meiji Essel Super Cup"), or the run contains Latin letters/digits/hyphen (R-1), merge into one "product/brand name" token with the gloss "<English span> (product/brand)", and mark the pieces as not-separate vocabulary entries. Needs word alignment, but a cheap proxy works: the capitalised English span's lowercased words each correspond to a piece's gloss or romanisation.
Fixes: 明治エッセルスーパーカップ, 明治プロビオヨーグルト R-1, ホットクック (if MT capitalises it).
False-positive risk: MT capitalises sentence-initial words and some titles, and may hallucinate capitalised text; mixed-script compounds that are plain words (大阪 + ビル). Require 2+ sentences or a Latin/digit element, and keep the "honest label" fallback (the existing katakana fragment rule) otherwise.
Cost: TypeScript over existing MT output; no new model. 2 days; reliability depends on FuguMT behaviour (I did not test it) [U].
Measure: brand sentences from 20 web-diary/blog texts, grade whether the grouped token and gloss are right; compare against the old per-piece output; check GiNZA/Stockmark-type "product" annotations only if a model is added (method 5).

### 5. Optional: small offline NER model as an extra vote (not the decision-maker)
What: run a token-classification model (a cl-tohoku BERT fine-tuned on Stockmark, or KWJA base) once per document in the Python venv at resolve-content time, and use its PER/LOC/ORG/PRODUCT spans only as additional evidence for methods 1-4 (a span boundary vote that merges tokens, a type vote that disambiguates 人名 vs 地名). Never override a negative cue, never produce a name label alone for hiragana common words.
Fixes: partial help on 孫 泰蔵 (person span), ちばてつや (if the model knows the manga artist), brand spans (product label), 通 street as part of a LOC span.
False-positive risk: Wikipedia-trained models degrade on stories/lyrics (reported F1 about 0.84 in-domain: [V third-party repo]; out-of-domain unknown [U]); spans may disagree with Sudachi boundaries. License: Stockmark data CC-BY-SA 3.0; model licenses [U]. KWJA is MIT [V].
Cost: model download ~0.3-0.5 GB, CPU inference per document is a one-time build cost (resolve-content) rather than runtime; RAM fine within the 15 GB budget [U for latency]. 3-5 days including span-to-token alignment.
Measure: apply to the graded eval texts and the Tanaka-like automatic yardstick is not applicable (Tanaka has no NE labels); instead grade 100 random model-vs-pipeline disagreements as BETTER/WORSE. Adopt only if BETTER >= 2x WORSE, as the project already requires.

### 6. Not recommended now
- NEologd (stale, large, other tokenizer, already rejected here) and a full Wikipedia-title gazetteer as a deciding signal (many titles equal common words; large). A Wikipedia gazetteer restricted to multi-token, multi-script titles used only as an extra vote for method 4 could be tried later [U on size/benefit].
- LLM tagging at runtime (too slow/large for CPU). Possible only as a dev-time grader of the diff.
- More transliteration tricks alone: they depend on MT behaviour.

## Suggested order
1 (propagation) and 2 (suffix grammar) first: cheapest, general, fix the largest share of listed failures. 3 next (precision guard). 4 after testing how FuguMT treats brand strings. 5 only if the grading shows names still dominate the residual errors.

## Sources
- https://github.com/megagonlabs/ginza (GiNZA models, labels, license)
- https://pypi.org/project/ja-ginza/ (package size snippet)
- https://github.com/ku-nlp/kwja (KWJA tasks, NER scores)
- https://huggingface.co/datasets/stockmark/ner-wikipedia-dataset (dataset facts)
- https://github.com/KeshavSingh29/fa_ner_japanese (BERT fine-tune F1 0.8428, third-party)
- https://huggingface.co/stanfordnlp/stanza-ja (Stanza ja NER file size)
- https://arxiv.org/pdf/2412.09587 (OpenNER, Japanese GSD F1 for other models)
- https://github.com/neologd/mecab-ipadic-neologd (NEologd license, size, sources)
- https://www.edrdg.org/enamdict/enamdict_doc.html (JMnedict counts, license)
- https://github.com/worksapplications/sudachi.rs (Sudachi compound proper-noun examples)
- https://aclanthology.org/H92-1045/ , https://preview.aclanthology.org/fix_video/C14-1213.pdf (one sense per discourse; NE claim), https://aclanthology.org/C02-1025.bib (Chieu & Ng)
- Repo files: CLAUDE.md, src/lib/nameFromTranslation.ts, src/lib/contentResolver.ts, src/lib/tokenContext.ts, src/lib/wordResolver.ts; eval evidence in scratchpad/eval/grade/*/phase2.md

## Unverified / not found
GiNZA and cl-tohoku NE F1 on out-of-domain text; CPU latency and exact model sizes for BERT/KWJA/ja_ginza_electra; NEologd last-update date; Sudachi per-tag precision; Wikipedia gazetteer size; FuguMT behaviour on brand strings; licenses of the cl-tohoku weights; all LLM claims.
