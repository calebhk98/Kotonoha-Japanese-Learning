# scripts/

Utility and maintenance scripts for Kotonoha. Run with `npx tsx <script>` unless noted.

## Setup / build

| Script | Command | What it does |
|--------|---------|--------------|
| `setup-sudachi.sh` | `npm run setup-sudachi` | Builds Sudachi WASM from source (needs Rust). Safe to re-run; skips if already built. |
| `setup-cache.sh` | `npm run setup-cache` | Decompresses `.word-cache.json.gz` and `.jisho-cache.json.gz` into working files. |
| `compress-cache.sh` | `npm run compress-cache` | Recompresses the working cache files for committing. Run after extending the cache. |
| `setup-jmnedict.ts` | `npx tsx scripts/setup-jmnedict.ts` | Downloads and prepares the JMnedict proper-noun dictionary. |
| `print-version.js` | (called by `npm run dev`) | Prints git branch, commit hash, and subject to the console at startup. |

## Content management

| Script | Command | What it does |
|--------|---------|--------------|
| `add-story.ts` | `npm run add-story` | Interactive prompt to scaffold a new story folder under `src/stories/`. |
| `add-series.ts` | `npx tsx scripts/add-series.ts` | Like `add-story.ts` but for a new series with episode metadata. |
| `migrate-stories.ts` | `npm run migrate-stories` | Migrates stories from the old inline `INITIAL_CONTENT` format to disk. Historical record; do not re-run on a live checkout. |
| `migrate-content-to-disk.ts` | `npx tsx scripts/migrate-content-to-disk.ts` | Earlier migration step (predates `migrate-stories.ts`). Historical record only. |

## Cache utilities

| Script | Command | What it does |
|--------|---------|--------------|
| `populate-cache.ts` | `npm run populate-cache` | Pre-populates the server-side word cache by hitting `/api/batch-extract` for every story. Requires the dev server to be running on port 3000. |
| `simple-cache-test.ts` | `npx tsx scripts/simple-cache-test.ts` | Quick sanity check that the cache files can be read and contain expected entries. |

## Analysis / diagnostics

| Script | What it does |
|--------|--------------|
| `analyze-dictionary-coverage.ts` | Reports what fraction of story vocabulary has JMDict entries. |
| `analyze-duplicates.ts` | Finds duplicate content IDs across stories/music/videos. |
| `analyze-filtering.ts` | Inspects which tokens the server word-filter drops. |
| `analyze-story.ts` | Prints tokenization and scoring details for a single story. |
| `check-definitions.ts` | Checks a word list against the dictionary and reports missing entries. |
| `compare-definitions.ts` | Compares dictionary lookup results across two tokenizer modes. |
| `deduplicate-content.ts` | Removes duplicate word entries from the content_words store. |
| `diagnostic-batch-extract.ts` | Sends a batch-extract request and prints the raw response for debugging. |
| `inspect-jisho-response.ts` | Fetches a single word from Jisho and prints the raw API response. |
| `investigate-lookups.ts` | Traces the full lookup pipeline for a given word. |
| `list-filtered-tokens.ts` | Lists all tokens that are filtered out during word extraction. |
| `quick-coverage-check.ts` | Faster version of `analyze-dictionary-coverage.ts`. |
| `test-jisho-api.ts` | Integration test for the Jisho API client. |
| `test-kana-improved.ts` | Tests hiragana word recognition improvements. |
| `test-kana-local-dict.ts` | Tests kana lookups against the local dictionary. |
| `test-local-dict.ts` | Tests general dictionary lookups against the local JMDict. |

## dev/

Scripts only used during development exploration — not part of any normal workflow.

| Script | What it does |
|--------|--------------|
| `dev/tokenizer-comparison.ts` | Compares TinySegmenter, BudouX, and Kuromoji on a fixed test sentence. Run with `npx tsx scripts/dev/tokenizer-comparison.ts` (requires `npm install kuromoji` first). |

## legacy/

Scripts preserved as historical record. Do not run on a live checkout.

| Script | What it was |
|--------|-------------|
| `legacy/script.cjs` | One-off content generator that populated `src/data/content.ts` with random entries. Predates the on-disk content model. |
