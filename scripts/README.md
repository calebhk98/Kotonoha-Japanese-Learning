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
| `transcribe.ts` | `npm run transcribe -- <url>` | Downloads audio from a YouTube URL (or reads a local file) and runs OpenAI Whisper to produce a draft `transcript.md`. Works for both `src/music/` and `src/videos/` content. See below for details. |
| `transcribe-missing.ts` | `npm run transcribe-missing` | Scans all `src/music/` and `src/videos/` directories, finds entries that have a playable `mediaUrl` but no `transcript.md`, and batch-transcribes them. Supports `--concurrency N`, `--dry-run`, `--model`, and `--type music\|videos\|all`. Run in background with `nohup npm run transcribe-missing >> transcribe.log 2>&1 &`. |

### transcribe.ts — audio transcription helper

Requires two external tools installed via pip (not npm):
```
pip install openai-whisper
pip install yt-dlp        # or: brew install yt-dlp
```

**Basic usage:**
```bash
# Print draft transcript to stdout
npm run transcribe -- "https://www.youtube.com/watch?v=XXXX"

# Write directly to a content folder
npm run transcribe -- "https://www.youtube.com/watch?v=XXXX" --output src/music/MySong/transcript.md

# Use a smaller/faster model for a quick draft
npm run transcribe -- "https://www.youtube.com/watch?v=XXXX" --model medium

# Include SRT timestamps (useful for video content)
npm run transcribe -- "https://www.youtube.com/watch?v=XXXX" --timestamps --output src/videos/MyVideo/transcript.md

# Transcribe a local file
npm run transcribe -- ./audio.mp3
```

**Model tradeoffs:**

| Model | Speed | Accuracy | Notes |
|-------|-------|----------|-------|
| `tiny` / `base` | Very fast | Lower | Good for quick draft check |
| `small` / `medium` | Moderate | Good | Reasonable for most songs |
| `large-v3` | Slow (default) | Best | Best for production use |

**Important:** Output is always a **draft**. Japanese homophones cause frequent kanji errors (e.g. 橋/箸, 春/晴). Review every line before committing. Also: transcription does not affect copyright — only use this for public domain or CC-licensed content.

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
