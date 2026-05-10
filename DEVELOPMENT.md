# Development Guide

Welcome! This guide covers everything you need to contribute to Kotonoha.

## Project Structure

```
Kotonoha-Japanese-Learning/
├── src/
│   ├── components/          # React UI components
│   ├── lib/                 # Utility functions (tokenizers, scoring, etc)
│   ├── hooks/               # Custom React hooks
│   ├── stories/             # All story content (organized by difficulty)
│   ├── App.tsx              # Main React app
│   └── main.tsx             # React entry point
├── integration/             # Standalone integration scripts (NOT run by `npm test`)
├── scripts/                 # Helper scripts
│   ├── add-story.ts         # CLI tool to add new stories
│   ├── add-series.ts        # CLI tool to add story series
│   └── setup-sudachi.sh     # Build Sudachi WASM tokenizer
├── server.ts                # Express.js backend server
├── package.json             # Dependencies and scripts
├── vite.config.ts           # Vite build configuration
├── tsconfig.json            # TypeScript configuration
└── README.md                # Main documentation
```

## Root Files Reference

### Documentation
- **README.md** - Main user-facing documentation with getting started instructions
- **DEVELOPMENT.md** - This file: developer guide and contribution workflow
- **STORIES_LIST.md** - Catalog of all 104 implemented stories with completion status
- **SONGS_LIST.md** - Curated list of Japanese songs for learning vocabulary
- **VIDEOS.md** - Recommended Japanese videos and streaming content
- **TOKENIZER_SETUP.md** - Installation troubleshooting and configuration guide for tokenizers
- **TOKENIZER_ANALYSIS.md** - Technical analysis comparing different tokenizer implementations

### Configuration & Build
- **package.json** - NPM dependencies, project scripts (dev, build, test, etc), project metadata
- **package-lock.json** - Locked versions of all dependencies for reproducible installs
- **tsconfig.json** - TypeScript compiler options and settings
- **vite.config.ts** - Vite bundler configuration (development server, build settings)
- **sudachi.json** - Sudachi tokenizer configuration and options

### Source Code
- **server.ts** - Express.js backend server
  - API endpoints for story retrieval, text analysis, dictionary lookups
  - Serves the frontend React app
  - Handles tokenization requests
- **index.html** - HTML entry point for the web application (loads React)
- **populate-cache.ts** - Utility to pre-populate the vocabulary cache (run via `npx tsx`)

### Tokenizer & Text Processing
- **char.def** - Character definition file used by Sudachi for morphological analysis
- **tokenizer-comparison.ts** - Utility script to test and compare different tokenizers (for development/debugging)
- **script.cjs** - CommonJS helper script for node operations

### Dictionary Data (Compressed)
- **jmdict-all-3.6.2.json.tgz** (25 MB) - Japanese-English dictionary (JMdict format)
  - Automatically decompressed by `setup-cache.sh` on first setup
  - Used for word lookups and definitions
- **jmnedict.json.gz** (8.8 MB) - Japanese names dictionary (JMnedict format)
  - For proper name recognition and reading

### Other
- **metadata.json** - Project metadata file
- **sudachi-wasm-built/** - Directory containing compiled Sudachi WASM tokenizer (created during `npm install`)

## Story Structure

Each story is a folder in `src/stories/` with this structure:

```
src/stories/story-name/
├── metadata.json            # Story metadata (required)
└── content.md               # Story content in Markdown (required)
```

### metadata.json Format

```json
{
  "id": "story-1234567890",
  "title": "Story Title",
  "type": "story",
  "description": "Brief description of the story",
  "dateAdded": "2026-05-06T12:34:56.789Z",
  "level": "n5"
}
```

**Fields:**
- `id`: Unique identifier (can be auto-generated as `story-{timestamp}`)
- `title`: Display name in English or Japanese
- `type`: Always `"story"` for now
- `description`: One-line description
- `dateAdded`: ISO 8601 timestamp
- `level`: JLPT difficulty (n5, n4, n3, n2, n1)

### content.md Format

Regular Markdown with Japanese text. Example:

```markdown
# 桃太郎 (Momotaro)

## Introduction

昔々、あるところに、おじいさんとおばあさんがいました。
おじいさんは、毎日、山へ芝刈りに行きました。
おばあさんは、毎日、川へ洗濯に行きました。

## The Peach

ある日のこと、川の上流から、大きな桃が流れてきました。
```

## Adding Stories

### Quick Method (CLI Tool)

```bash
npx tsx scripts/add-story.ts \
  --title "Story Title" \
  --description "Brief description" \
  --level n5
```

This creates the folder and template files. Then edit the generated `content.md`.

### Manual Method

1. Create a new folder in `src/stories/story-name/` (use kebab-case)
2. Add `metadata.json` with required fields
3. Add `content.md` with Japanese text
4. Test by running the app: `npm run dev`

### Updating STORIES_LIST.md

After adding a story, add it to [STORIES_LIST.md](STORIES_LIST.md):
- Add ✅ checkmark to implemented stories
- Update summary statistics at the bottom

## Development Workflow

### Setup

```bash
git clone https://github.com/calebhk98/Kotonoha-Japanese-Learning.git
cd Kotonoha-Japanese-Learning
npm install
npm run dev
```

### Making Changes

1. Create a feature branch: `git checkout -b feature/description`
2. Make your changes
3. Test locally: `npm run dev`
4. Run linting: `npm run lint`
5. Commit with clear messages
6. Push to your fork and create a pull request

### Testing Your Changes

```bash
# Type checking
npm run lint

# Run tests (if available)
npm run test

# Build for production
npm run build
```

## Scripts & Tools

### NPM Scripts

```bash
npm run setup-sudachi       # Build/rebuild Sudachi WASM tokenizer (auto-runs on install)
npm run setup-cache         # Initialize vocabulary cache from dictionaries
npm run compress-cache      # Compress vocabulary cache for storage
npm run dev                 # Start dev server with hot reload
npm run start               # Start production server
npm run build               # Build for production
npm run preview             # Preview production build
npm run lint                # Check TypeScript compilation
npm run clean               # Remove build artifacts
npm run test                # Run tests (if available)
npm run test:watch          # Run tests in watch mode
npm run test:stories        # Quick test of story functionality
npm run test:stories:full   # Full test suite for all stories
npm run add-story           # CLI: Add a new story interactively
npm run migrate-stories     # Migrate old story format to new format
```

### Helper Scripts in `scripts/`

These are utility scripts for development and maintenance:

| Script | Purpose |
|--------|---------|
| `setup-sudachi.sh` | Downloads and builds Sudachi WASM tokenizer (runs automatically on `npm install`) |
| `setup-cache.sh` | Decompresses and initializes vocabulary cache from dictionary files |
| `compress-cache.sh` | Compresses the vocabulary cache for smaller file size |
| `add-story.ts` | CLI tool to create a new story with template files |
| `add-series.ts` | CLI tool to create a story series (for multi-episode content) |
| `migrate-stories.ts` | Migrates stories to new folder structure/format |
| `migrate-content-to-disk.ts` | Moves story content from database/memory to disk files |
| `analyze-story.ts` | Analyzes a story for vocabulary, difficulty, word frequency |
| `analyze-duplicates.ts` | Finds duplicate stories or content |
| `analyze-filtering.ts` | Analyzes word filtering and scoring behavior |
| `deduplicate-content.ts` | Removes duplicate stories/content |
| `list-filtered-tokens.ts` | Lists tokens that match certain filters |
| `setup-jmnedict.ts` | Sets up Japanese name dictionary |

### Dictionary Files

The following compressed dictionary files are in the root folder:

| File | Size | Purpose |
|------|------|---------|
| `jmdict-all-3.6.2.json.tgz` | 25 MB | Japanese-English dictionary (JMdict format). Decompressed on first setup via `setup-cache.sh` |
| `jmnedict.json.gz` | 8.8 MB | Japanese names dictionary. Used for proper name lookups |

These files are automatically decompressed and processed into the vocabulary cache when you run `npm run setup-cache`. They provide the word definitions and readings used by the scoring system.

## Tokenizers

The app supports multiple Japanese tokenizers. The default is **Sudachi WASM**.

### Available Tokenizers

- **Sudachi WASM** (default): Morphological analyzer, runs in WebAssembly
- **Sudachi-TS**: TypeScript implementation
- **Lindera**: Fast Rust-based tokenizer
- **Kuromoji**: Pure JavaScript tokenizer
- **TinySegmenter**: Lightweight JavaScript segmenter

### Switching Tokenizers

Set the `TOKENIZER` environment variable:

```bash
TOKENIZER=kuromoji npm run dev
```

Or in `.env`:

```
TOKENIZER=lindera
```

### Tokenizer Configuration

Tokenizers are implemented in `src/lib/tokenizers.ts`. Each implements the `Tokenizer` interface:

```typescript
interface Tokenizer {
  name: string;
  ready(): Promise<void>;
  segment(text: string): Promise<TokenInfo[]>;
}
```

To add a new tokenizer, implement this interface and add it to the `createTokenizer()` function.

## Word Scoring System

The scoring system is in `src/lib/` and ranks words by difficulty:

1. **JLPT Points** (15-100): Based on kanji JLPT level
2. **Kanji Penalties** (+5 to +30): Kanji grade complexity
3. **Frequency Adjustments** (-20 to +50): Word frequency in Japanese

See `src/lib/` for implementation details.

## Environment Variables

Create a `.env` file in the root:

```
TOKENIZER=sudachi-wasm
VITE_API_URL=http://localhost:3000
```

## API Endpoints

The backend (Express.js) provides these endpoints. `server.ts` is the source
of truth — if this list and the code disagree, the code wins.

**Vocabulary / tokenization:**

- `POST /api/extract` - Tokenize and score arbitrary Japanese text. Body: `{ text }`. Returns `WordInfo[]`. Enforces a 50,000-character limit and rejects text with no Japanese codepoints.
- `POST /api/batch-extract` - Same as `/api/extract`, but takes `{ texts: string[] }` and returns one result per input.
- `POST /api/process-story` - Tokenize a story for the reader view (returns tokens with positions, base forms, and per-token metadata). Same 50k-char limit.
- `POST /api/update-words` - Recompute scores for an array of `WordInfo` entries (used when the user edits a word).
- `POST /api/clear-cache` - Clear the in-memory and SQLite caches.

**Single word lookup:**

- `GET /api/word/:word` - Reading + meaning + score for a single word.

**Content (stories / music / videos loaded from `src/stories|music|videos/`):**

- `GET /api/content` - All content items.
- `GET /api/content/words` - All known content → words mappings.
- `GET /api/content/:contentId/words` - Words for one content item.

**WaniKani sync:**

- `POST /api/wanikani/validate` - Validate a WaniKani API token.
- `POST /api/wanikani/sync` - Pull SRS data for the user's known kanji.

The older endpoints `/api/stories`, `/api/stories/:id`, `/api/analyze`, and
`/api/dictionary/:word` no longer exist; if you find references to them in
old docs or code, update them to the equivalents above.

## Common Issues

### Tokenizer Won't Build

If Rust doesn't install automatically:

```bash
npm run setup-sudachi
```

See [TOKENIZER_SETUP.md](TOKENIZER_SETUP.md) for detailed troubleshooting.

### TypeScript Errors

Run type checking:

```bash
npm run lint
```

### Port 3000 Already in Use

Change the port in `server.ts` or kill the existing process:

```bash
lsof -i :3000
kill -9 <PID>
```

## File Organization

**src/components/** - Reusable React components
- Story cards, vocabulary list, progress tracker, etc.

**src/hooks/** - Custom React hooks
- `useContentData()` - Load and manage story data
- `useVocabulary()` - Track known/unknown words

**src/lib/** - Utility functions
- `tokenizers.ts` - Tokenization implementations
- `scoring.ts` - Word difficulty scoring
- `dictionaries.ts` - Dictionary lookups

**src/stories/** - Story content
- Each story is a folder with `metadata.json` and `content.md`
- Organized by difficulty level in subdirectories

**integration/** - Standalone integration scripts
- Run with `npx tsx integration/<script>.ts` (not picked up by `npm test`)
- Require real infrastructure: dictionary files, Sudachi WASM, or a running server

## Contributing

1. Fork the repository
2. Create a feature branch for your changes
3. Make clear, focused commits
4. Write a descriptive PR title and description
5. Reference any related issues

### Types of Contributions

- **Stories**: Add new Japanese stories (see "Adding Stories" above)
- **Bug Fixes**: Fix issues and add tests
- **Features**: New vocabulary tools, UI improvements, etc.
- **Documentation**: Improve guides and comments
- **Tokenizers**: Add or improve tokenizer implementations

## Questions?

- Check [README.md](README.md) for user-facing information
- Check [STORIES_LIST.md](STORIES_LIST.md) for story catalog
- Open an issue on GitHub with your question

Happy coding!
