# Sakura Story Tokenization & Vocabulary Extraction Analysis

## Summary
The tokenizer produces **logical phrase grouping** (bunsetsu), but this creates a **vocabulary lookup problem**: verb conjugations don't exist in the dictionary.

## The Issue: Tokenizer vs Dictionary Mismatch

**Tokenizer outputs (good for reading):**
```
描きました = "painted" (as one readable unit)
あげたいです = "want to give" (as one readable unit)
喜んでくれました = "was pleased for me" (as one readable unit)
```

**Dictionary contains (base forms only):**
```
描く = "to paint"
あげる = "to give"  
喜ぶ = "to be pleased"
```

Result: Dictionary lookup fails for conjugated forms → "Unknown meaning"

## Analysis Results

| Category | Count | Examples |
|----------|-------|----------|
| ✅ Working Well | 27 | 親友(friend), 誕生日(birthday), 一週間(one week) |
| ❌ Missing Defs | 13 | 描きました, 考えました, 買えません |
| ⚠️ Questionable | 4 | あげたいです, ない |

**Overall Definition Accuracy: ~60%**

## What Works Well
- **Base nouns**: 親友, 誕生日, 似顔絵, お金, 名前
- **Simple adjectives**: 高い, 特別 (when base form exists in dictionary)
- **Common adverbs**: とても, ように, かけて

## What Doesn't Work
- **Conjugated verbs**: 描きました→Unknown, 考えました→Unknown
- **Verb+auxiliary**: あげたいです→Unknown, 喜んでくれました→Unknown
- **Proper nouns/loan words**: サクラちゃん, プレゼント (not in dictionary)

## The Trade-off

**Tokenizer's current approach (GOOD):**
- Groups verbs with auxiliaries for readability
- Produces logical phrase boundaries (bunsetsu)
- Helps with comprehension of full verb forms

**But it breaks (BAD):**
- Dictionary lookups need base forms
- Conjugations don't exist in kanji-data dictionary
- Results in missing definitions

## Possible Solutions

1. **Keep current approach**: Accept ~60% accuracy as "good enough" - users can often infer meaning from context
2. **Add verb stemming**: Modify dictionary lookup to extract base form before searching
3. **Dual tokenization**: Output both conjugated form (for display) and base form (for lookup)
4. **Split on dictionary boundaries**: Don't group verb+auxiliaries, keep them separate for lookup

## Verdict

For **vocabulary learning**: The current tokenizer is **reasonably good** because:
- Core content words (nouns, adjectives) have good definitions
- Verb conjugations can be inferred from base form + context
- Most common words are covered

**Better for actual use** would be option 2 or 3 (add stemming or dual tokenization).
