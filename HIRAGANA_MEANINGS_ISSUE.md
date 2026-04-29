# Pure Hiragana Word Meanings Issue - Comprehensive Documentation

## Problem Statement

Pure hiragana particles and auxiliaries return incorrect, unusable definitions:
- `です` → "to profit at someone else's expense" (should be "be", "copula")
- `ます` → "to increase" or "box at theatre" (should be "polite auxiliary verb")
- `わたし` → "temporary approximate payment" (should be "I", "me")
- `はた` → "flag" (should be something else depending on context)
- `なか` → "relation" (should be "inside", "middle")

When a story is entirely pure hiragana, the definitions are useless and make the learning tool ineffective.

## Root Cause Analysis

The current system uses `kanji-data` library for word lookups:
- Designed for kanji-based word searches
- Searches by kanji characters extracted from words
- Pure hiragana words have no kanji, so matching breaks
- Falls back to generic results that are often wrong

Attempted fixes:

### 1. Jisho API Integration (FAILED)
**Approach:** Use Jisho.org public API for pure hiragana lookups

**What was tried:**
- Direct fetch to `https://jisho.org/api/v1/search/words`
- Request queuing (max 2 concurrent requests)
- Result caching
- 10-15 second timeout

**Why it failed:**
- Jisho API times out frequently, even with queuing
- Batch processing makes 30-100+ concurrent requests across stories
- Request queuing helps but doesn't fully solve timeout issue
- Pure hiragana queries still get "Jisho lookup error: The operation was aborted due to timeout"

**Evidence:** Server logs show continuous timeouts:
```
[Dictionary] Jisho lookup error: The operation was aborted due to timeout
[Dictionary] Jisho lookup error: The operation was aborted due to timeout
[Dictionary] Jisho lookup error: The operation was aborted due to timeout
```

### 2. Local Hardcoded Dictionary (NOT A SOLUTION)
**Why rejected:** Building a hardcoded dictionary of 140+ words:
- Only works for known words
- New words default to generic "Kana particle / expression"
- Becomes maintenance burden
- Doesn't scale with user's growing vocabulary

## Alternative Dictionaries Evaluated (Research Phase)

### 1. **jmdict-simplified-node** (via jmdict-wrapper)
- **Status:** Available but requires large 249MB JSON file download
- **Pros:** 
  - Offline, no API calls or timeouts
  - Comprehensive Japanese dictionary
  - Senses may be frequency-ordered
- **Cons:**
  - Large file (249MB), excluded from git
  - Initial setup/indexing required
  - File availability is issue (download from GitHub releases)
  - Has matching logic bugs for pure hiragana (tries exact match, falls back to first result)
- **Integration:** Already attempted via `jmdict-wrapper` npm package
- **Current blocker:** jmdict-all-3.6.2.json file not present in repo

### 2. **Unofficial Jisho-API** (npm package)
- **Status:** Investigated, has ESM/CommonJS compatibility issues
- **Pros:** Simple API
- **Cons:** 
  - Dependency on `cheerio` library with version conflicts
  - ESM/CommonJS interoperability problems
  - Still hits same timeout issues as direct API
- **Verdict:** Not viable

### 3. **JPDB (Japanese Phonetic Database)**
- **Status:** High-quality but API-based
- **Pros:**
  - Frequency-ordered senses (frequency-global and frequency-local)
  - Excellent for learning prioritization
  - 130M+ sentence corpus (anime/light novel focused)
- **Cons:**
  - API-based, requires API key
  - Rate limited (would have same timeout issues in batch processing)
  - Not suitable for offline/local use
- **Link:** https://jpdb.io/

### 4. **Yomitan Dictionaries**
- **Status:** Pre-compiled offline dictionaries
- **Pros:**
  - Offline capable
  - Pre-built JMDict+frequency data available
  - Frequency-ordered senses
  - Built specifically for dictionary lookups
- **Cons:**
  - Requires dictionary compilation or using pre-built
  - Would need to parse/integrate Yomitan format
  - More complex than jmdict-wrapper
- **Resources:**
  - https://yomitan.wiki/dictionaries/
  - https://github.com/yomidevs/jmdict-yomitan

### 5. **MeCab (with NAIST JDIC)**
- **Status:** Morphological analyzer, not dictionary lookup tool
- **Pros:** Good for tokenization and base form detection
- **Cons:**
  - Requires system installation (platform-specific)
  - Not designed for definition lookups
  - Would need separate dictionary anyway
- **Current usage:** Already using `kuromoji` for tokenization, which is similar

### 6. **Tatoeba (Example Sentences)**
- **Status:** Example sentences, not definitions
- **Pros:** Good for context
- **Cons:** Doesn't solve definition problem

## Recommended Solutions for Future Work

### Option A: Use jmdict-simplified-node (BEST FOR OFFLINE)
**Implementation effort:** Medium

1. **Obtain jmdict file:**
   - Download `jmdict-all-3.6.2.json` from https://github.com/scriptin/jmdict-simplified/releases
   - Place in project root (249MB, add to .gitignore)
   - Or implement CI/CD to download at build time

2. **Fix matching logic:**
   - Current `jmdict-wrapper` has bugs in matching pure hiragana
   - Need better exact matching that handles pure hiragana forms
   - Consider matching all `kana` variants, not just first `kana[0]`

3. **Update dictionary interface:**
   ```typescript
   // In src/lib/dictionary.ts JmdictDictionary class:
   // - Better exact matching for pure hiragana
   // - Check ALL kana variants, not just first
   // - Verify senses are actually frequency-ordered
   ```

4. **Testing:**
   - Verify `です`, `ます`, `わたし` return correct definitions
   - Check that multiple senses are returned in frequency order
   - No API timeouts (fully offline)

### Option B: Implement Yomitan Dictionary Support
**Implementation effort:** High

1. **Research Yomitan format:**
   - Understand binary/dictionary format
   - Find parsing libraries or write custom parser

2. **Integrate pre-built dictionaries:**
   - Use pre-compiled JMDict+frequency from https://github.com/yomidevs/jmdict-yomitan
   - Parse frequency data

3. **Implement YomitanDictionary class:**
   - Add to dictionary interface
   - Make primary source for pure hiragana

### Option C: Hybrid Approach (RECOMMENDED)
**Implementation effort:** Medium-High

1. **Primary:** jmdict-simplified-node for offline capability
   - Fix matching logic for pure hiragana
   - No API timeouts
   - Comprehensive dictionary

2. **Fallback:** Keep kanji-data for kanji/mixed words
   - Works reasonably well for non-pure-hiragana
   - Fast lookups

3. **Future enhancement:** Add Yomitan support
   - Better frequency ordering
   - More accurate senses

## Current Code State

**Files involved:**
- `src/lib/dictionary.ts` - Dictionary abstraction with implementations
- `server.ts` - Request handling and dictionary integration
- `src/lib/scoring.ts` - Word lookup and caching

**Dictionary classes:**
- `Dictionary` interface - Defines `lookup()` and `isInitialized()`
- `KanjiDataDictionary` - Uses kanji-data (fallback, works for kanji words)
- `JishoApiDictionary` - Uses Jisho.org API (unreliable due to timeouts)
- `JmdictDictionary` - Stub for jmdict-wrapper (needs jmdict file)
- `DictionaryManager` - Handles initialization and fallback chain

**Current fallback chain:**
1. Try JmdictDictionary (skipped if file missing)
2. Try JishoApiDictionary (times out frequently during batch)
3. Fall back to KanjiDataDictionary (gives wrong definitions for pure hiragana)
4. Generic "Kana particle / expression" as last resort

## Testing Checklist for Future Developer

When implementing a fix, verify:
- [ ] `です` returns "be" or "copula" (not "to profit...")
- [ ] `ます` returns "polite auxiliary" or similar (not "to increase")
- [ ] `わたし` returns "I" or "me" (not "temporary payment")
- [ ] `ぎて` etc. in stories show proper definitions
- [ ] Batch processing completes without timeouts (< 2 minutes for 32 stories)
- [ ] New pure hiragana words not previously seen still work correctly
- [ ] Cache persists and improves performance on repeated lookups

## Key Insight

**The core issue:** kanji-data is fundamentally the wrong tool for looking up pure hiragana particles and auxiliaries. Pure hiragana lookups need a different approach - either:
1. A dedicated dictionary with pure hiragana entries indexed by reading (jmdict-simplified)
2. A reliable API that returns accurate results (Jisho.org, but with proper request management)
3. A specialized hiragana particle dictionary resource

Using kanji-data as primary and trying to supplement with API is a Band-Aid solution that creates architectural problems.
