# CLAUDE.md

Guidance for Claude Code (and other AI agents) working in this repository.

This file is the source of truth for *how things actually work right now* — verified
by running the code, not just reading the docs. Some details here disagree with the
human-facing docs (README.md, DEVELOPMENT.md, TOKENIZER_SETUP.md); when they do,
this file is correct unless you re-verify and update it.

---

## What this project is

**Kotonoha** is a Japanese vocabulary learning app. It loads curated Japanese
content (stories / songs / videos), tokenizes the Japanese text with a
morphological analyzer, scores each word by JLPT level + kanji complexity +
frequency, and tracks per-user progress in `localStorage` (no accounts, no
cloud).

It is a Vite + React 19 SPA served by an Express backend that also exposes the
tokenization / dictionary lookup API. In dev, Vite middleware is mounted on the
Express server (single port).

## Tech stack — quick reference

| Area              | Choice                                                                |
|-------------------|-----------------------------------------------------------------------|
| Frontend          | React 19, TypeScript, Vite 6, Tailwind CSS 4 (`@tailwindcss/vite`)    |
| Backend           | Express 4 (`server.ts`), run via `tsx`                                |
| Tokenizer         | **Sudachi WASM** (default), with Sudachi-TS / Lindera / Kuromoji / TinySegmenter fallbacks |
| Dictionaries      | JMdict (`jmdict-all-3.6.2.json.tgz`), JMnedict (`jmnedict.json.gz`), `kanji-data` (npm) |
| Persistent cache  | SQLite via `sql.js` → `.cache.db` at repo root                        |
| Tests             | Vitest (`environment: 'node'`)                                        |
| Icons             | `lucide-react`                                                        |
| Animations        | `motion`                                                              |
| Module type       | ESM (`"type": "module"`); imports use `.js` extensions even for `.ts` source |

Node 18+ required.

---

## Repository layout (verified)

```
.
├── server.ts                  # Express backend (1087 lines)
├── src/
│   ├── App.tsx                # Main React app (920 lines, single-component-heavy)
│   ├── main.tsx               # React entry
│   ├── types.ts               # WordInfo, ScoreBreakdown, LessonType
│   ├── index.css
│   ├── components/            # 7 components (.tsx)
│   ├── hooks/                 # useContentData (+ test)
│   ├── lib/                   # tokenizers, scoring, dictionary, storyLoader, etc.
│   ├── data/content.ts        # Content type defs + loader; INITIAL_CONTENT is empty
│   ├── stories/               # 123 directories of stories on disk (README claims 104)
│   ├── music/                 # 21 directories
│   └── videos/                # 19 directories
├── scripts/                   # ~25 setup/maintenance/CLI scripts (.ts and .sh)
├── tests/                     # Standalone integration scripts (NOT run by `npm test`)
├── sudachi-wasm-built/        # Output of setup-sudachi.sh (must exist for default tokenizer)
├── jmdict-all-3.6.2.json.tgz  # 25 MB; auto-extracted on server start
├── jmnedict.json.gz           # 8.8 MB
├── .word-cache.json.gz / .jisho-cache.json.gz  # Pre-warmed lookup caches (gzipped)
├── .word-cache.json / .jisho-cache.json        # Decompressed by setup-cache.sh
├── .cache.db                  # SQLite DB (created on first run)
├── char.def                   # Sudachi character definitions
├── sudachi.json               # Sudachi tokenizer config
├── populate-cache.ts          # Utility to pre-populate the lookup cache
├── tokenizer-comparison.ts    # Dev-only tokenizer comparison
├── script.cjs                 # Misc CommonJS helper
└── index.html                 # Vite entry
```

There is **no `src/components/index.ts`** barrel — components are imported
directly. There are no formal route components either: `App.tsx` is a single
~900-line component that switches views via local state (`view`, `selectedContent`,
`selectedWord`).

---

## Commands you'll actually use

All measured on this checkout, on this machine. Re-measure if you doubt them.

| Command              | What it does                                              | Observed time         |
|----------------------|-----------------------------------------------------------|-----------------------|
| `npm install`        | Installs deps + runs `postinstall` (Sudachi + cache setup; can be 3–5 min on a cold machine) | not re-run |
| `npm run dev`        | Starts Express + Vite dev middleware on port 3000         | port opens ~10 s; see "Dev server startup" below |
| `npm run lint`       | `tsc --noEmit` on the project (excludes `tests/`)         | **~23 s**, exit 0     |
| `npm test`           | `vitest run` — **5 test files, 94 tests passing**         | **~21 s**, exit 0     |
| `npm run test:watch` | Vitest in watch mode                                      | —                     |
| `npm run build`      | `vite build`                                              | not measured          |
| `npm run preview`    | Vite preview of build                                     | —                     |
| `npm run clean`      | `rm -rf dist`                                             | —                     |
| `npm run setup-sudachi` | Build/rebuild Sudachi WASM (needs Rust)                | first build 2–3 min   |
| `npm run setup-cache`   | Decompress dictionaries / caches                       | —                     |
| `npm run compress-cache`| Recompress caches                                      | —                     |
| `npm run add-story`     | `tsx scripts/add-story.ts` — interactive new story     | —                     |
| `npm run migrate-stories` | Migrate old story format                             | —                     |
| `npm run test:stories` / `:full` | Standalone story integration scripts (NOT vitest) | —              |

**Note on `npm start`**: the script is `node server.ts`, which will fail because
`server.ts` is TypeScript. Use `npm run dev` (which uses `tsx`) — `start` looks
broken.

### Vitest scope

`npm test` only runs `*.test.ts` files inside `src/` (vite.config.ts has
`environment: 'node'`). The 5 test files are:

- `src/lib/data-import-export.test.ts`
- `src/lib/dictionary.test.ts`
- `src/lib/scoring.test.ts`
- `src/lib/vocabulary-extraction.test.ts`
- `src/hooks/useContentData.test.ts`

Files in `tests/` (e.g. `test-all-stories.ts`, `test-server-api.ts`,
`test-sudachi-*.mjs`) are **not** picked up by vitest — `tsconfig.json`
explicitly excludes `tests/**`. They are standalone scripts you run with `tsx` /
`node`. Don't add new vitest specs there.

---

## Dev server startup

Logged sequence from `npm run dev` on this machine:

```
[Version] Branch: ... | Commit: ... | <commit subject>
[JMDict] Extracting compressed dictionary...
[JMnedict] Decompressing dictionary...
[Server] Starting up — please wait ~30s for dictionaries and tokenizer to load before sending requests...
[Tokenizer] Sudachi WASM ready
[Server] Tokenizer ready: Sudachi WASM
[JMnedict] Successfully decompressed dictionary
[JMnedict] Dictionary file prepared and ready
[JMDict] Successfully extracted dictionary
[JMDict] Dictionary file extracted and ready
[Database] Created new database / Loaded existing database
[Database] Tables created
[Dictionary] jmdict file found, attempting to initialize
... (then JMdict indexing, cache preload, then "listening on 3000")
```

The server logs say "wait ~30s"; on a warm machine after the WASM and gzipped
dictionaries are present, it's roughly that. First-ever start (cold caches,
Sudachi WASM not built, gzipped dictionaries not extracted) takes considerably
longer.

Boot sequence (in `server.ts`):

1. `tokenizerReady` — `createTokenizer()` from env `TOKENIZER` (default Sudachi WASM)
2. `jmdictReady` — extract `jmdict-all-3.6.2.json.tgz` if not already extracted
3. `jmnedictReady` — decompress `jmnedict.json.gz` (via `ensureJmnedictPrepared`)
4. `dictionaryReady` — `initDatabase()` (sql.js), build `WordsCache` / `JishoCache` / `ContentWordsStore`, `DictionaryManager.initialize(...)`, then `wordsCache.preload()`
5. `app.listen(3000, "0.0.0.0")` — port opens once.
6. **Background, non-blocking** but very loud:
   - `loadCachesInBackground()` — loads `.jisho-cache.json` if present (~98 entries observed; takes ~25 ms once decompressed); the gzipped `.word-cache.json.gz` is intentionally skipped.
   - **Startup extraction**: walks every content item (stories+music+videos = 163 on this checkout) that's missing from `content_words`, and runs `runBatchExtract` in chunks of 20. On a fresh DB this calls Jisho for hundreds of unique kana words per chunk and easily takes **minutes** to finish. The HTTP port is open, but the extraction lives on the same Node event loop, so the server is essentially unresponsive for user-facing API calls during this time. Expect the first `npm run dev` after a wipe of `.cache.db` to take *much* longer than 30 s before the app feels usable.
   - On second and later starts (cache hot), the log line `[Server] All content already extracted — skipping startup extraction` is what you want to see.

You'll see `Server running on http://localhost:3000` printed during step 5 even
though step 6 hasn't finished — don't trust that single line as "ready for
load testing".

**Important**: Vite HMR is gated by `DISABLE_HMR` (vite.config.ts). The comment
there explicitly says do not modify file watching — it's tuned for the AI Studio
agent environment.

**SIGTERM is ignored** (server.ts catches it and logs "ignoring gracefully")
plus `setInterval(...30000)` keeps the event loop alive. To stop the dev server
you have to `SIGINT` (Ctrl+C) or `kill -9`. Don't be surprised when `kill <pid>`
appears to do nothing.

---

## API surface (Express, mounted at `/api/*`)

Source of truth: `server.ts`. Endpoints found:

| Method | Path                                | Purpose                                                      |
|--------|-------------------------------------|--------------------------------------------------------------|
| POST   | `/api/extract`                      | Tokenize + score arbitrary text (`{ text }` → `WordInfo[]`)  |
| POST   | `/api/batch-extract`                | Batched version of `/api/extract`                            |
| POST   | `/api/process-story`                | Tokenize a story for the reader (positions + per-token data) |
| POST   | `/api/update-words`                 | Update WordInfo entries (e.g. user edits)                    |
| POST   | `/api/clear-cache`                  | Clear server-side caches                                     |
| GET    | `/api/content`                      | List all content items (stories+music+videos from disk)      |
| GET    | `/api/content/words`                | All known content→words mappings                             |
| GET    | `/api/content/:contentId/words`     | Words for one content item                                   |
| GET    | `/api/word/:word`                   | Single-word reading + meaning + score                        |
| POST   | `/api/wanikani/validate`            | Validate WaniKani API token                                  |
| POST   | `/api/wanikani/sync`                | Pull WaniKani SRS data                                       |

`DEVELOPMENT.md` lists `/api/stories`, `/api/stories/:id`, `/api/analyze`,
`/api/dictionary/:word` — **none of those exist**. Use the table above.

JSON body limit is 50 MB (`express.json({ limit: '50mb' })`) — large because
some endpoints take whole story texts.

`/api/extract` and `/api/process-story` enforce `MAX_TEXT_LENGTH = 50_000` chars
*and* require the body to contain at least one Japanese codepoint
(`/[぀-ゟ゠-ヿ一-鿿]/`). 400-status is returned otherwise.

`/api/content` returns 163 entries on this checkout (123 stories + 21 music + 19 videos).
Each entry has `{ id, title, type, description, text, mediaUrl?, imageUrl? }`. Total
payload was ~440 KB.

`/api/extract` example: input `"猫が好きです。本を読みました。"` returned 7 `WordInfo`
entries in ~0.6 s once the server was warm (with cache hits). Note that the
*raw* JMDict `entry` returned from `/api/word/:word` exposes JMDict's native
sense order (which puts the rare/slang sense of 猫 first); the `meaning` /
`meanings` fields are the *re-ordered* version, so always show those, never
`entry.meanings[0].glosses[0]`.

Score floor: scores returned can be as low as 1 — `本` returned score 1 (jlpt
15 + joyo 5 + freq −20 → clamped to 1) even though it's an N5 word. The
client should not interpret a score of 1 as "missing data".

In dev mode, after the API routes, Vite is mounted as middleware
(`app.use(vite.middlewares)`), so the SPA is served from the same port.
In production (when a `dist/` exists), Express serves the built files
statically and falls back to `index.html` for SPA routes.

---

## Content model (what's actually on disk)

Each story / song / video is a folder under `src/stories/` (123 folders),
`src/music/` (21 folders), `src/videos/` (19 folders). Each folder has at
minimum:

- `metadata.json` — see `StoryMetadata` / `MusicMetadata` / `VideoMetadata` in
  `src/lib/storyLoader.ts`.
- `content.md` (stories) / `transcript.md` (music, videos) — Markdown body.

`storyLoader.ts` is the loader; `src/data/content.ts` exposes
`getContent()` / `getStories()` / `getMusic()` / `getVideos()`.
`INITIAL_CONTENT` is intentionally **empty** — all content is on disk now. Don't
add content arrays back in.

Story metadata supports two relationship fields (use one, not both):
- `parentId` — episodes/variants of a single story
- `seriesId` (+ `episodeNumber`) — independent episodes in a series

Variants can carry `variantType: 'kanji' | 'hiragana' | 'simplified' | 'full' | string`.

The README claims **104** stories; on disk there are **123** story folders and
the count drifts as stories are added — don't rely on the README number.

### Adding a story (the right way)

```bash
npx tsx scripts/add-story.ts --title "..." --description "..." --level n5
# then edit src/stories/<new-folder>/content.md
```

After adding content, `STORIES_LIST.md` is hand-maintained; update it if
relevant. There is no automatic regeneration.

---

## Tokenization & scoring (the core logic)

### Tokenizer interface (`src/lib/tokenizers.ts`)

```ts
interface TokenInfo { surface: string; baseForm: string; }
interface Tokenizer {
  name: string;
  ready(): Promise<void>;
  segment(text: string): Promise<TokenInfo[]>;
}
```

Default is selected by `createTokenizer()` based on `process.env.TOKENIZER`:

| `TOKENIZER` value | Tokenizer            | Notes                                 |
|-------------------|----------------------|---------------------------------------|
| (unset)           | Sudachi WASM         | default, ~83% hiragana accuracy       |
| `sudachi-wasm`    | Sudachi WASM         | same as default                       |
| `sudachi-ts`      | Sudachi-TS           | reads `sudachi.json` from cwd         |
| `lindera`         | Lindera (Rust nodejs)|                                       |
| `kuromoji`        | Kuromoji             | poor hiragana support                 |
| `tinysegmenter`   | TinySegmenter        | no base forms — surface = baseForm    |

Sudachi WASM lives in `sudachi-wasm-built/` (built by
`scripts/setup-sudachi.sh`). The `index_bg.wasm` blob is ~208 MB and includes
the UniDic dictionary. Sudachi tokenization mode C (compound) is the default
for accuracy; see `TOKENIZER_SETUP.md` for modes.

### Word resolution (`resolveWordMeaning` in server.ts)

Single source of truth introduced as fix for issue #188 — three earlier code
paths had different lookup logic. Order:

1. If pure-kana (`/^[ぁ-んー]+$/`), check `getMorphemeDefinition()` first, return early on hit.
   - Reason: JMnedict stores ます/ない as proper-noun glosses ("Masu", "Nai"); without this guard those would shadow the correct grammatical definition.
2. `kanji-data` lookup (sync) — used for reading + fallback meaning.
3. JMDict lookup — preferred when it has a real gloss; sense ordering in JMDict is sorted by `getSenseCommonness()` to bury rare/archaic senses (e.g. 猫→"submissive partner", 春→"New Year").
4. Final fallback for kana-only: morpheme definition or the literal string `"Kana particle / expression"`.

If you change lookup behaviour, update **all** call sites by routing through
`resolveWordMeaning` — that was the whole point.

### Scoring (`src/lib/scoring.ts`)

`getWordScoreBreakdown(wordStr, variant)` produces:

- **JLPT score** (15..100) — driven by the *hardest* JLPT-level kanji in the word
  (N5=15, N4=30, N3=50, N2=70, N1=90, none=100). Pure-kana words default to N5=15.
- **Joyo penalty** (5..30) — by the *highest* (= latest-grade) joyo grade kanji.
  Non-joyo kanji = grade 9 = +30.
- **Frequency penalty** — `getFrequencyPenalty()` reads JMdict priority tags
  (`news1/2`, `ichi1/2`, `gai1/2`, `spec1/2`, `nf01..nf48`); pure-kana with no
  variant gets −20.

Score range exposed externally is 1..100; `WordInfo.score` is the integer-rounded
final. WaniKani SRS data, when present, multiplies the *base* score by 0.05–1.0
(`useContentData.applyWaniKaniToWords`).

### Known limitation (from TOKENIZER_ANALYSIS.md, still accurate)

The tokenizer outputs *bunsetsu*-style chunks like 描きました, but the dictionaries
key on base forms (描く). This causes ~40% of conjugated verb forms to land on
"Unknown meaning" without stemming. `src/lib/stemming.ts` exists as a
mitigation; don't assume it covers every conjugation.

---

## Cache architecture

There are two layers of cache, plus two on-disk artefacts:

| Layer                    | Where it lives                                         | Loaded when                       |
|--------------------------|--------------------------------------------------------|-----------------------------------|
| In-memory `WordsCache`   | `src/lib/database.ts`, fed by SQLite                   | At server start, lazy-preloaded   |
| In-memory `JishoCache`   | same                                                   | same                              |
| `ContentWordsStore`      | same — per-content extracted vocab                     | same                              |
| SQLite `.cache.db`       | repo root, three tables: `words_cache`, `jisho_cache`, `content_words` | persistent       |
| `.word-cache.json[.gz]`  | gzipped pre-warmed dump of the words cache             | optional, background-loaded       |
| `.jisho-cache.json[.gz]` | gzipped pre-warmed dump of the Jisho lookup cache      | optional, background-loaded       |

The current `server.ts` deliberately **skips** loading `.word-cache.json.gz`
into memory (relies on the SQLite-backed `WordsCache` instead — see the
`loadCachesInBackground` block). If you find yourself "fixing" that, read the
comment first.

`saveDatabase()` only writes if `isDirty`; cache flushes are throttled with
`shouldSaveCache()` / `clearCacheDirtyFlag()` — don't flush on every write.

---

## Frontend architecture (the things that aren't obvious)

- **No router**. `App.tsx` switches `view: 'home' | 'vocab' | 'scoring' | 'settings'`. Word detail uses `window.history.pushState` + `popstate` for `/word/:word` URLs. Don't add `react-router` without a discussion.
- **State persistence is `localStorage` only**. Keys observed: `customContent`, `knownWords`, `contentVocab`. Vocab cache is invalidated on schema mismatch (it checks `breakdown.jlptScore` / `breakdown.highestGrade` exist).
- **`useContentData` is the data-orchestration hook** — it owns `knownWords`, `contentVocab`, WaniKani data, and the load-vocab-for-content lifecycle. New features that touch user state should go through it.
- **WaniKani integration** (`src/lib/wanikani.ts`) — server validates the token, then the client applies SRS-stage-based score multipliers in `applyWaniKaniToWords`.
- **Anki export** (`src/lib/anki.ts` + `AnkiExportModal.tsx`) — generates a TSV / CSV style export.
- Components: `ContentDetail`, `ContentReader`, `LessonProcess`, `WordDetailModal`, `WordDetailPage`, `SettingsPage`, `ImportModal`, `AnkiExportModal`. There's both a modal and a page version of word detail (modal in lists, page at `/word/:word`).

---

## Conventions to follow

- **Imports use `.js` extensions** even for `.ts` source — `tsconfig` uses `moduleResolution: bundler` + `allowImportingTsExtensions`, but server-side `tsx` runs ESM and the existing pattern in `server.ts` is `from "./src/lib/scoring.js"`. Match the surrounding file.
- Path alias `@/*` maps to repo root (`vite.config.ts` and `tsconfig.json`).
- Tests sit next to the code they test (`foo.ts` ↔ `foo.test.ts`). Keep them in `src/`, not `tests/`.
- Don't add deps for things `lucide-react` / `motion` / `tailwindcss` already cover.
- Don't put new content into `src/data/content.ts` — content is on disk under `src/stories|music|videos/`.
- Don't push `.cache.db`, `.word-cache.json`, `.jisho-cache.json` to git (the gzipped versions *are* committed).
- The branch you're on for any agent work specified by the harness — currently `claude/create-claude-md-OoPU9` — is where commits go. Don't push to `main`.

---

## Common pitfalls (saves time)

- `npm start` is broken (it tries to `node server.ts`). Use `npm run dev`.
- The README says 104 stories; the disk has 123. Don't trust counts in docs.
- `tests/` is **not** the vitest location — it's standalone scripts. New unit tests go into `src/**/*.test.ts`.
- `DEVELOPMENT.md`'s API endpoint list (`/api/stories`, `/api/analyze`, `/api/dictionary/:word`) is **stale** — see the API table above.
- Sudachi WASM build needs Rust. If `sudachi-wasm-built/` is missing, the default tokenizer fails to start. Fall back with `TOKENIZER=tinysegmenter npm run dev` while you fix it.
- The first start of the server has to extract `jmdict-all-3.6.2.json.tgz` (25 MB → ~270 MB). Don't kill it during that step.
- `populate-cache.ts` and `tokenizer-comparison.ts` at the repo root are dev utilities — they shouldn't be imported by app code.

---

## House rules for agents

- **Run `npm run lint` and `npm test` before claiming you're done.** Both are fast (~20 s each). They will catch the things humans usually catch in review.
- Prefer editing existing files over creating new ones; this codebase already has a lot of one-off scripts in `scripts/` and an over-large `App.tsx` — don't add to the sprawl unless the task asks for it.
- When you touch tokenization or scoring, run a smoke test against a known story (`npm run test:stories`) and check that `/api/extract` still produces sensible output for short text.
- For UI changes, start the dev server and exercise the change in a browser at http://localhost:3000 if you can; a passing `tsc` doesn't prove the UI works.
- Don't regenerate `STORIES_LIST.md` automatically — it's hand-edited.
- This file (CLAUDE.md) is the place to record any *non-obvious* behaviour you discover while working. If you spend more than a few minutes hunting for something, document it here on the way out.
