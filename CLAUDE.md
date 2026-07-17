# CLAUDE.md

Guidance for Claude Code (and other AI agents) working in this repository.

This file is a *rough orientation guide* for AI agents and humans dropping
into the repo cold. It was written by reading the code and running it on a
specific commit, so the broad strokes (architecture, what each piece does,
where the gotchas are) should hold up over time, but **specific numbers,
line counts, file paths, and timings will drift**. The codebase is the
only real source of truth — when something here disagrees with the code,
the code wins. If you spot drift while you're in here, fix the doc.

A few details here also disagree with the human-facing docs (README.md,
DEVELOPMENT.md, TOKENIZER_SETUP.md). Those have their own drift problem;
when in doubt, check `server.ts`, `package.json`, and `src/lib/`
directly.

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
| Tokenizer         | **Sudachi WASM** (default); TinySegmenter as emergency dev fallback; Sudachi-TS / Lindera / Kuromoji classes retained but `@deprecated` (packages removed — see tokenizers.ts for reinstall instructions) |
| Dictionaries      | JMdict (`jmdict-all-3.6.2.json.tgz`), JMnedict (`jmnedict.json.gz`), `kanji-data` (npm) |
| Persistent cache  | SQLite via `better-sqlite3` → `.cache.db` at repo root (write-through) |
| Content resolution| Precomputed `resolved.json` per content item (`npm run resolve-content`, #252) |
| Tests             | Vitest — unit (`npm test`) + HTTP API suite (`npm run test:api`)      |
| Icons             | `lucide-react`                                                        |
| Animations        | `motion`                                                              |
| Module type       | ESM (`"type": "module"`); imports use `.js` extensions even for `.ts` source |

Node 18+ required.

---

## Repository layout (verified)

```
.
├── server.ts                  # Express backend (routes + boot + extraction pipeline; splitting it further is an open thread)
├── src/
│   ├── App.tsx                # Thin shell (~300 lines) — views live in src/views/, state in src/hooks/
│   ├── main.tsx               # React entry
│   ├── types.ts               # WordInfo, ScoreBreakdown, LessonType
│   ├── index.css
│   ├── components/            # Reader, detail pages, modals (.tsx)
│   ├── views/                 # HomeView / VocabView / ScoringView
│   ├── hooks/                 # useContentData, useUrlRouting, useHomeFilters, useContentBootstrap
│   ├── hooks/                 # useContentData (+ test)
│   ├── lib/                   # tokenizers, scoring, dictionary, storyLoader, etc.
│   ├── data/content.ts        # Content type defs + loader (getContent/getStories/getMusic/getVideos)
│   ├── stories/               # one folder per story: metadata.json + content.md + resolved.json
│   ├── music/                 # same, with transcript.md
│   └── videos/                # same, with transcript.md
├── scripts/                   # ~25 setup/maintenance/CLI scripts (.ts and .sh); see scripts/README.md
│   ├── populate-cache.ts      # Pre-populate the server lookup cache (run via `npm run populate-cache`)
│   ├── dev/
│   │   └── tokenizer-comparison.ts  # Dev-only: compare TinySegmenter/BudouX/Kuromoji on test text
│   └── legacy/
│       └── script.cjs         # Historical: one-off content generator (pre-disk content model)
├── integration/               # Standalone integration scripts (NOT run by `npm test`)
├── sudachi-wasm-built/        # index_bg.wasm (~2MB glue) + system.dic (~215MB UniDic), shipped as .gz
├── jmdict-all-3.6.2.json.tgz  # 25 MB; auto-extracted on server start
├── jmnedict.json.gz           # 8.8 MB
├── .word-cache.json.gz        # Pre-warmed word-cache dump (gzipped)
├── .word-cache.json           # Decompressed by setup-cache.sh
├── .cache.db                  # SQLite DB (created on first run)
├── char.def                   # Sudachi character definitions
├── sudachi.json               # Sudachi tokenizer config
└── index.html                 # Vite entry
```

There is **no `src/components/index.ts`** barrel — components are imported
directly. There is no router: `App.tsx` switches views via local state
(`view`, `selectedContent`, `selectedWord`) with URL sync in `useUrlRouting`.

---

## Commands you'll actually use

All measured on this checkout, on this machine. Re-measure if you doubt them.

| Command              | What it does                                              | Observed time         |
|----------------------|-----------------------------------------------------------|-----------------------|
| `npm install`        | Installs deps + runs `postinstall` (Sudachi + cache setup; can be 3–5 min on a cold machine) | not re-run |
| `npm run dev`        | Starts Express + Vite dev middleware on port 3000         | port opens ~10 s; see "Dev server startup" below |
| `npm run lint`       | `tsc --noEmit` on the project (excludes `integration/`)   | **~23 s**, exit 0     |
| `npm test`           | `vitest run` — unit tests in `src/**` (counts drift; ~257 across 11 files at last update) | fast, exit 0 |
| `npm run test:api`   | HTTP tests that spawn the real server (`tests/api/`, own vitest config) | ~1–2 min incl. boot |
| `npm run test:watch` | Vitest in watch mode                                      | —                     |
| `npm run build`      | `vite build`                                              | not measured          |
| `npm run preview`    | Vite preview of build                                     | —                     |
| `npm run clean`      | `rm -rf dist`                                             | —                     |
| `npm run setup-sudachi` | Build/rebuild Sudachi WASM (needs Rust)                | first build 2–3 min   |
| `npm run setup-cache`   | Decompress dictionaries / caches                       | —                     |
| `npm run compress-cache`| Recompress caches                                      | —                     |
| `npm run add-story`     | `tsx scripts/add-story.ts` — interactive new story     | —                     |
| `npm run test:stories` / `:full` | Standalone story integration scripts (NOT vitest) | —              |
| `npm run resolve-content` | Write `resolved.json` for content missing it; `-- --all` re-resolves everything (run after ANY resolution-pipeline change) | ~2–3 min for all 600+ |
| `npm run scrape-captions` / `fetch-lyrics` | Manual scraper jobs (no longer auto-run by the dev server) | — |

`npm start` builds and serves production (`vite build` + `NODE_ENV=production tsx server.ts`).
For development use `npm run dev`.

### Vitest scope

`npm test` only runs `*.test.ts` files inside `src/` (vite.config.ts has
`environment: 'node'`). Key suites: `dictionary`, `wordResolver`,
`contentResolver`, `scoring`, `extraction-helpers`, `morpheme`/`database`,
`caption-scraper`, `useContentData`. The HTTP-level suite lives in
`tests/api/` with its own `vitest.api.config.ts` (`npm run test:api`) — it
spawns the real server as a subprocess, so it needs the WASM/dictionaries
set up and must not run while another server holds the LevelDB lock.

Files in `integration/` (e.g. `test-all-stories.ts`, `test-server-api.ts`,
`test-sudachi-*.mjs`) are **not** picked up by vitest — `tsconfig.json`
explicitly excludes `integration/**`. They are standalone scripts you run with `tsx` /
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
4. `dictionaryReady` — `initDatabase()` (better-sqlite3), build `WordsCache` / `ContentWordsStore`, `DictionaryManager.initialize(...)`, then `wordsCache.preload()`
5. `app.listen(3000, "0.0.0.0")` — port opens once.
6. **Background, non-blocking** but very loud:
   - `loadCachesInBackground()` — the gzipped `.word-cache.json.gz` is intentionally skipped (see "Cache architecture" below).
   - **Startup extraction**: walks every content item (stories+music+videos = 163 on this checkout) that's missing from both `content_words` and a committed `resolved.json` (see "Precomputed resolution" above — in practice this is close to a no-op on a checkout with resolved.json committed), and runs `runBatchExtract` in chunks of 20 via the local dictionary waterfall (JMDict/JMnedict/kanji-data — no network calls since #256 removed the Jisho fallback). Still worth watching on a fresh DB with un-resolved content, since Sudachi tokenization + JMDict lookups across many items can take a while.
   - On second and later starts (cache hot), the log line `[Server] All content already extracted — skipping startup extraction` is what you want to see.

You'll see `Server running on http://localhost:3000` printed during step 5 even
though step 6 hasn't finished — don't trust that single line as "ready for
load testing".

**Important**: Vite HMR is gated by `DISABLE_HMR` (vite.config.ts). The comment
there explicitly says do not modify file watching — it's tuned for the AI Studio
agent environment.

**SIGTERM shuts down gracefully** since #253 (closes the HTTP server,
flushes the DB, exits 0). The old ignore-SIGTERM behavior survives only
behind `IGNORE_SIGTERM=1` (Codespaces-idle survival). `PORT` env overrides
the default 3000 (added for the API test harness).

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
| GET    | `/api/content/:contentId/story`     | Reader tokens for one item — serves committed `resolved.json` when present (`precomputed: true`), else live-resolves |
| GET    | `/api/content/:contentId/words`     | Words for one content item (prefers `resolved.json`)          |
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

The 50k cap isn't arbitrary: earlier attempts to feed entire stories /
transcripts in one POST were failing — the server would either time
out, blow up under tokenization load, or the response wouldn't make it
back to the browser (suspected hitting some
request/response/proxy-buffer limit on the way through). 50k is the
ceiling that empirically *worked*. If you find yourself wanting to
raise it, chunk the text on the client instead and use
`/api/batch-extract` — don't just bump the constant.

`/api/content` returns one entry per content folder (600+ and growing; the
count drifts — don't trust docs). Each entry has
`{ id, title, type, description, text, mediaUrl?, imageUrl? }`.

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
npm run resolve-content   # writes resolved.json for the new item (see below)
```

### Precomputed resolution (issue #252)

Every disk content item carries a committed `resolved.json` — the
deterministic output of the tokenize+resolve pipeline
(`src/lib/contentResolver.ts`), written by `npm run resolve-content`. The
server serves these directly (`GET /api/content/:id/story`, and
`/api/content/:id/words` prefers them), so disk content needs **no runtime
extraction and no cache warmup**. Live resolution remains the fallback for
custom/imported content only — like every other lookup path, it is entirely
local (JMDict -> JMnedict -> kanji-data) since #256 removed the unofficial
Jisho web fallback.

Consequences worth knowing:
- **If you change anything in the resolution pipeline** (tokenizers,
  wordResolver, dictionary, morphemeDefinitions, scoring), re-run
  `npm run resolve-content -- --all` and commit the artifact diffs — the
  diff over resolved.json files IS the regression review.
- The dictionary waterfall is entirely local (JMDict -> JMnedict -> kanji-data;
  the unofficial Jisho web fallback was removed in #256), so the resolve
  script never depends on network responses — determinism is now a property
  of the pipeline itself, not something the script has to work around.
- `resolved.json` positions are computed against the **trimmed** text, same
  as `/api/content` serves it.

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

**Treat the non-Sudachi entries as emergency-only crash carts, not real
alternatives.** Sudachi WASM is the only tokenizer this app is actually
tested against; the others exist because at various points we needed
something that ran while Sudachi was broken. Their accuracy and behaviour
diverge enough that swapping in a fallback masks bugs rather than fixing
them — vocabulary scores and word lookups will silently degrade. If
Sudachi WASM fails to load:

1. Diagnose the Sudachi issue first (rebuild `sudachi-wasm-built/`,
   reinstall Rust, check `setup-sudachi.sh` output).
2. Only fall back to `TOKENIZER=tinysegmenter` as a *temporary* workaround
   so you can keep the rest of the app working while you fix #1. Don't
   ship a tokenizer change.
3. Don't write code that branches on `tokenizer.name` to paper over the
   differences. Fix Sudachi.

Sudachi WASM lives in `sudachi-wasm-built/` (built by
`scripts/setup-sudachi.sh` from a **pinned commit** of hi-ogawa/sudachi.rs —
see `SUDACHI_RS_COMMIT` in the script). Since issue #254 the UniDic
dictionary ships as a separate `system.dic` (~215 MB, committed as
`system.dic.gz`) loaded at runtime via `Tokenizer.create(dictData)`; the
wasm binary itself is ~2 MB, so glue changes no longer recommit a 200 MB
blob. Legacy embedded builds (single >100 MB `index_bg.wasm`) still load.
Sudachi tokenization mode C (compound) is the default for accuracy; see
`TOKENIZER_SETUP.md` for modes.

**The WASM build is patched.** `scripts/setup-sudachi.sh` applies
`scripts/sudachi-wasm-reading.patch` after cloning upstream, adding
`reading_form` and `dictionary_form` to the exposed Morpheme interface.
The contextual reading (UniDic) drives furigana display and homograph
disambiguation (家の前→まえ, 頭 read かしら → head/leader entry) via
`TokenInfo.reading` → `WordResolver` → `LookupHint.reading`. All code
treats `reading_form` as optional, so an unpatched WASM build still works
— it just falls back to the POS/uk-only selection.

### Word resolution (`src/lib/wordResolver.ts` + `src/lib/contentResolver.ts`)

`WordResolver.resolve(wordStr, baseForm, lookupCache?, pos?, reading?)` is the
single resolution pipeline — every consumer (`/api/extract`, `/api/word`,
`/api/process-story`, the extraction worker, and the build-time
`resolve-content` script via `contentResolver.ts`) routes through it. Order:

1. **Grammar-morpheme guard** (`getGrammarDefinition` in extraction-helpers):
   pure-kana surfaces check the morpheme table by surface, then by base form
   (たく→たい, でし→です), then via the 為る/居る/有る → する/いる/ある map
   (Sudachi normalizes those to kanji). Prevents JMnedict "Masu"/homograph
   nonsense (#188 and successors).
2. `kanji-data` lookup (sync) — fallback meaning; its variant reading is only
   used for kanji surfaces (a pure-kana surface IS its own reading).
3. JMDict lookup with **hints**: the token's Sudachi POS and (for
   non-conjugating POS) its contextual UniDic reading. Entry selection
   (`pickBestEntry`/`getEntryCommonness` in dictionary.ts) scores exact
   matches by common flags, primary-form match, POS compatibility,
   usually-kana (uk, gated by POS compatibility), and reading match (+15,
   strongest). Sense ordering is **penalties-only** — JMDict's native order
   is kept; only slang/archaic/rare-marked senses sink. Near-ties surface the
   runner-up as `" — or: <gloss> (<form>)"` (`findCloseAlternatives`) so
   beginners see genuine ambiguity (kana あめ → candy or rain) instead of a
   silent guess.
4. Kana-only fallback: morpheme table or the literal `"Kana particle / expression"`.

The tokenizer's contextual reading, when present, is also the displayed
furigana (読みました→よみました). Waterfall behind DictionaryManager:
JMDict → JMnedict → kanji-data — entirely local (the Jisho web fallback was
removed in #256).

If you change ANY of this, re-run `npm run resolve-content -- --all` and
review the artifact diff — that diff over 600+ items is the regression test.

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

### Compositional fallback + supplementary dictionary (#257)

When the whole word is unknown, `composeUnknown` in wordResolver derives a
meaning from transparent parts — every branch requires the parts to resolve,
so nonsense can't compose. Branches (specific → generic): mimetic 〜と retry,
reduplication (パチパチパチ→ぱちぱち), trailing-stretch strip (達ァ→達;
mora-safe — only っ/ー strip after kana), honorific お/ご/御 (Sudachi
normalizes お→御 in base forms — match the SURFACE too), curated
prefix/suffix tables, の-compounds, compound verbs (aux table, then
passive/causative stripping, then generic V1+V2 with kanji-initial tails),
verbal nouns (振り返り→振り返る), and a best-scored recursive noun-compound
split (fewest parts, most balanced — picks ガラス+ケース over ガラ+スケース).
Composition uses `lookupPartStrict`, which rejects proper-noun glosses on
kana/single-char parts (JMnedict name noise: いしさ→"Ishisa"). Unresolvable
kana sound-words get honest labels ("onomatopoeia / sound effect" for
副詞/感動詞, "stretched vocalization" for ー/〜 tokens). Curated one-offs
(story names, brands, chants, literary coinages) live in
`src/data/supplementaryDictionary.ts`, checked BEFORE the waterfall so they
override wrong homographs (なつき ≠ 夏季 "summer season").

### Known limitations (measured against the committed artifacts)

Across all 310k word-occurrences in the resolved artifacts, **6 occurrences
(0.002%) remain "Unknown meaning"** — two whitespace+long-dash garbage
tokens, one 8-char address, one ambiguous song lyric, one Chinese character
in a story that features Chinese. If you touch composition rules, re-run the
scan and MANUALLY REVIEW the artifact meaning-diff — the composition rules
were tuned by exactly that review, and "composes to something wrong" is
worse than "unknown" in this app. Kana homographs with identical signals
(あめ) resolve to one entry and show the other as an alternative.
TOKENIZER_ANALYSIS.md predates all of this and is historical.

### Multi-language architecture (#258 target axis, #260 native axis)

Two independent axes, both seamed but ja/en-only in runtime today:

- **Target language (#258)**: `src/lib/language/` holds LanguageProfile —
  script predicates, Sudachi-POS→neutral-class mapping, score-breakdown
  rows, plus server-only tokenizer bindings in `serverProfile.ts`. The old
  scattered Japanese regexes now live ONLY in the ja profile and
  extraction-helpers (which the profile delegates to). `isPunctuation` is
  per-profile semantics on purpose — "no target-language content" is only
  correct scoped to a language. Content metadata carries optional
  `language` (absent = 'ja'). Adding a language = one display profile +
  server bindings + dictionary source + content folders.
- **Native/gloss language (#260)**: JMDict-all already CONTAINS
  multilingual glosses (spa 68k, ger 336k, …). `dictionary.ts` selects
  gloss language PER ENTRY (`getEntryGlossLang` — JMDict groups senses by
  language, English first, so per-sense fallback silently always returns
  English). `/api/word/:word?lang=es`, `/api/extract {lang}`. UI strings go
  through `src/lib/i18n.ts` + `src/locales/` (en source of truth, es stub;
  English is the mandatory fallback). resolved.json stays English-baked;
  non-English glosses resolve live on demand (see #260 for the
  entry-id-in-artifact migration plan).

---

## Cache architecture

There is one layer of cache, plus one on-disk seed artefact:

| Layer                    | Where it lives                                         | Loaded when                       |
|--------------------------|--------------------------------------------------------|-----------------------------------|
| In-memory `WordsCache`   | `src/lib/database.ts`, fed by SQLite                   | At server start, lazy-preloaded   |
| `ContentWordsStore`      | same — per-content extracted vocab                     | same                              |
| SQLite `.cache.db`       | repo root, two tables: `words_cache`, `content_words`  | persistent       |
| `.word-cache.json[.gz]`  | gzipped pre-warmed dump of the words cache             | optional, background-loaded       |

(Prior to #256 there was also a `JishoCache` layer, a `jisho_cache` table, and
committed `.jisho-cache.json.gz` seed data backing the now-removed unofficial
Jisho web fallback. All of that is gone — the dictionary waterfall is JMDict
-> JMnedict -> kanji-data, entirely local, so there is nothing left to
pre-warm from a network round-trip.)

### Why the JSON file exists alongside the SQLite DB — DO NOT delete it

`.cache.db` is **per-checkout, per-machine**. The server doesn't sync it
anywhere, and it's gitignored. So a fresh clone or a CI run starts with an
empty SQLite cache. Since #252's precomputed `resolved.json` artifacts cover
disk content already, this mostly matters for live/custom-content resolution
and for the startup-extraction fallback (see "Dev server startup") — both of
which now resolve purely from local dictionaries, so there's no multi-minute
network warmup penalty to worry about anymore.

The gzipped `.word-cache.json.gz` is how we share a pre-warmed word cache
across machines via git. It's committed on purpose. `setup-cache.sh`
decompresses it into the bare `.word-cache.json` working file.

So the three files do three different jobs and **none of them are
redundant**:

- `.cache.db` — the live, runtime, mutated SQLite cache.
- `.word-cache.json` — decompressed seed data used at startup. Generated
  locally; gitignored.
- `.word-cache.json.gz` — the *committed* shipping format of the seed data.
  This is the only way new clones inherit a warm cache.

People have deleted `.word-cache.json` thinking "the database has all this
already" — **don't**. The DB only has what *this machine* has happened to
look up. If you need to regenerate the gzipped version after intentionally
extending the cache, run `npm run compress-cache`.

The current `server.ts` deliberately **skips** loading `.word-cache.json.gz`
into memory (relies on the SQLite-backed `WordsCache` instead — see the
`loadCachesInBackground` block). If you find yourself "fixing" that, read the
comment first.

Since #253 (`better-sqlite3`) every write goes straight to disk;
`saveDatabase()` survives only as a no-op shim so old call sites compile.
Don't reintroduce write batching without measuring first.

---

## Frontend architecture (the things that aren't obvious)

- **No router**. `App.tsx` (~300-line shell after #255) wires views under `src/views/` (HomeView/VocabView/ScoringView) with state in hooks (`useUrlRouting`, `useHomeFilters`, `useContentBootstrap`, `useContentData`). Word detail uses `window.history.pushState` + `popstate` for `/word/:word?reading=&pos=` URLs — the query params carry the clicked token's in-context reading/POS so the detail page resolves the same homograph. Don't add `react-router` without a discussion.
- **The reader fetches by content id** (`GET /api/content/:id/story` → precomputed tokens) and falls back to POSTing raw text to `/api/process-story` only for custom/imported content.
- **State persistence is `localStorage` only**. Keys observed: `customContent`, `knownWords`, `contentVocab`. Vocab cache is invalidated on schema mismatch (it checks `breakdown.jlptScore` / `breakdown.highestGrade` exist).
- **`useContentData` is the data-orchestration hook** — it owns `knownWords`, `contentVocab`, WaniKani data, and the load-vocab-for-content lifecycle. New features that touch user state should go through it.
- **WaniKani integration** (`src/lib/wanikani.ts`) — server validates the token, then the client applies SRS-stage-based score multipliers in `applyWaniKaniToWords`.
- **Anki export** (`src/lib/anki.ts` + `AnkiExportModal.tsx`) — generates a TSV / CSV style export.
- Components: `ContentDetail`, `ContentReader`, `LessonProcess`, `WordDetailModal`, `WordDetailPage`, `SettingsPage`, `ImportModal`, `AnkiExportModal`. There's both a modal and a page version of word detail (modal in lists, page at `/word/:word`).

---

## Conventions to follow

- **Imports use `.js` extensions** even for `.ts` source — `tsconfig` uses `moduleResolution: bundler` + `allowImportingTsExtensions`, but server-side `tsx` runs ESM and the existing pattern in `server.ts` is `from "./src/lib/scoring.js"`. Match the surrounding file.
- Path alias `@/*` maps to repo root (`vite.config.ts` and `tsconfig.json`).
- Tests sit next to the code they test (`foo.ts` ↔ `foo.test.ts`). Keep them in `src/`, not `integration/`.
- Don't add deps for things `lucide-react` / `motion` / `tailwindcss` already cover.
- Don't put new content into `src/data/content.ts` — content is on disk under `src/stories|music|videos/`.
- Don't push `.cache.db`, `.word-cache.json` to git (the gzipped version *is* committed). See the "Why the JSON file exists…" section above before deleting either of these.
- Push to whichever branch the harness or task specifies for your run. Don't push to `main`.

---

## Common pitfalls (saves time)

- Content/test counts in ANY doc (including this one) drift constantly — measure, don't trust.
- `integration/` is **not** the vitest location — it's standalone integration scripts. New unit tests go into `src/**/*.test.ts`.
- `DEVELOPMENT.md`'s API endpoint list (`/api/stories`, `/api/analyze`, `/api/dictionary/:word`) is **stale** — see the API table above.
- Sudachi WASM: `npm run setup-sudachi` decompresses the committed artifacts (no Rust needed); Rust is only required for a full rebuild from the pinned source. The wasm binary and `system.dic` are a MATCHED PAIR — after a git checkout/pull that changes `sudachi-wasm-built/*.gz`, delete the stale decompressed `index_bg.wasm`/`system.dic` and re-run setup, or the wasm-bindgen glue will mismatch the binary at runtime.
- **Only one process can open `jmdict-db` (LevelDB) at a time** — the dev server, `resolve-content`, the API test suite, and the integration scripts all want that lock. A locked-out DictionaryManager logs "Database is not open" and silently degrades to fallbacks. Kill the server before running scripts, and vice versa.
- The first start of the server has to extract `jmdict-all-3.6.2.json.tgz` (25 MB → ~270 MB). Don't kill it during that step.
- `populate-cache.ts` and `tokenizer-comparison.ts` at the repo root are dev utilities — they shouldn't be imported by app code.

---

## GitHub issues are starting points, not specifications

**Issue descriptions in this repo can be wrong about root cause.** They're
written from observed symptoms — sometimes by an agent in a previous
session, sometimes by a human in a hurry — and the diagnosis hasn't always
been verified against the code. Treat the *bug report* (the user-visible
symptom and the input that triggers it) as authoritative; treat the *cause
analysis* and the *suggested fix* as a hypothesis to verify.

Concrete example: **issue #189** ("Sudachi mode C groups compound verb
forms, causing dictionary lookup to fail for conjugated verbs"). The issue
confidently asserted that mode C produced compound tokens like
`寝ています` as a single morpheme that the dictionary couldn't find, and
recommended switching to mode A. Actual investigation showed:

- Modes A, B, and C **produce identical splits** for the conjugated-verb
  cases in question — `走っています` always becomes `[走っ, て, い, ます]`.
- The `normalized_form` on each morpheme was already correct
  (`走っ → 走る`), so dictionary lookup was *not* failing.
- The real bug was **display fragmentation**: the server surfaced each
  morpheme as a separate vocab entry, so users saw `走っ | て | い | ます`
  as four words instead of `走っています` as one phrase.

An agent who'd followed the issue's prescription (switch to mode A) would
have made the UI fragmentation *worse* while believing they were fixing
dictionary lookups. The fix that landed (`claude/fix-sudachi-verb-grouping-ZEz4i`)
left the mode alone and post-processed Sudachi output to group verb stems
with their auxiliaries.

Process to apply:

1. Reproduce the user-visible symptom yourself before reading the cause
   section. Use the smallest input that triggers it.
2. Confirm the proposed root cause with a probe (a script, a console log,
   a unit test) — don't assume the issue's diagnosis is right.
3. If your investigation contradicts the issue, **say so in a comment on
   the issue and update the description before you start fixing**, so the
   next person isn't misled the same way.
4. The TDD workflow below is the safety net here: a failing test pinned
   to the symptom (not the supposed cause) catches misdirection early.

---

## Issues worth filing / known open threads

The original orientation-pass list (npm start, WordResolver refactor,
SIGTERM, startup extraction, App.tsx split, dependency pruning) has been
fully addressed — see issues #250–#256 and their merged implementations.
Still open or newly observed:

- **#257 — the remaining 0.12% unknown words.** Compositional fallback
  (お/ご prefixes, productive suffixes, compound verbs) + a small
  supplementary dictionary for story character names (なつき currently
  glosses as "summer season") and coinages. Measured breakdown in the issue.
- **`TOKENIZER_ANALYSIS.md` is historical.** Its accuracy numbers predate
  the sense-ordering, homograph, reading, and grouping fixes. Re-measure or
  mark clearly as archival.
- **`server.ts` decomposition (second half of #255).** The scrapers moved
  out and App.tsx was split, but server.ts still mixes boot orchestration,
  routes, and the extraction pipeline in one file.
- **README/DEVELOPMENT.md drift.** Endpoint lists and content counts in the
  human docs remain stale.

---

## TDD workflow (required for bug fixes and behaviour changes)

The git history shows this is the team's preferred pattern — see e.g.
`004dcc0 test(#189): add failing tests for conjugated verb display and lookup`
followed by the actual fix commits. Follow it:

1. **Write a failing test (or tests) first.** Add `*.test.ts` files next to
   the code you're about to change in `src/**`. Each test should describe a
   behaviour you *want*, expressed against the current API. Don't hand-wave
   with `expect(true).toBe(false)` — make it a real assertion that exercises
   the actual code path. Multiple tests in one commit is fine and often
   *preferable* for messy bugs: if you don't yet know exactly where the
   problem lives, shotgunning 5–20 small tests across the suspected surface
   area is a legitimate debugging technique. Some will go red, some green,
   and the pattern of failures tells you where the bug actually is.
2. **Run `npm test` and confirm the new tests fail for the right reasons.**
   Not "fails to compile", not "throws because a fixture is missing" — fails
   because the production code doesn't do the thing yet. If a failure mode is
   wrong, fix the test before touching production code.
3. **Commit the failing tests on their own.** Message format:
   `test(#<issue>): add failing test(s) for <behaviour>`. One commit can hold
   many tests — the point is that the failing-test commit is separate from
   the fix commit, so the bug is reproducible from git history alone (anyone
   can `git checkout <that sha>` and see the red).
4. **Implement the fix.** Keep the diff minimal — only what's needed to flip
   the new tests to green. Don't sneak in unrelated refactors.
5. **Run `npm test` again.** New tests pass, *and* nothing in the existing
   suite regresses. Run `npm run lint` too.
6. **Commit the fix separately.** `fix(#<issue>): <one-line description>`.

Why this matters here: tokenizer / scoring / dictionary-lookup logic is
interconnected (#188, #189 each touched 2–3 files) and it's easy to "fix" one
call site while leaving another broken. A test that nails down the desired
output for a representative input is the only way to keep the regression from
sneaking back in next sprint.

Exceptions where TDD is overkill:
- Pure docs / comment changes.
- New stories or content additions in `src/stories|music|videos/`.
- Mechanical renames where `tsc` is the actual safety net.

For everything else — especially anything that touches `server.ts`,
`src/lib/scoring.ts`, `src/lib/dictionary.ts`, `src/lib/tokenizers.ts`, or
`src/hooks/useContentData.ts` — write the failing test first.

---

## Environment quirks (cloud / agent sessions)

Hard-won lessons from working on this repo in sandboxed cloud sessions.
Most of these will bite silently if you don't know them:

- **The workspace can be restored from an OLD snapshot.** After a container
  restart, local HEAD and untracked files may lag what was already pushed —
  while origin has the truth. On resuming: `git fetch`, compare with
  `origin/<branch>`, fast-forward, then **re-sync generated artifacts**
  (delete stale `sudachi-wasm-built/index_bg.wasm`/`system.dic`, re-run
  `npm run setup-sudachi`, `npm install` if package.json moved, delete
  `.cache.db`). Never conclude work was "lost" from local state alone.
- **`pkill -f` / `pgrep -f` match their own command line.** A pattern like
  `pkill -f "resolve-content"` kills the shell running it (the pattern is in
  its own cmdline) — the compound dies mid-way and later commands never run.
  Use a self-excluding bracket pattern (`pkill -f "resolve[-]content"`) or
  kill by collected PIDs. Also scope patterns tightly: a broad
  `pkill -f "server.ts"` killed sibling worktree agents' dev servers.
- **One `jmdict-db` lock, one port.** See Common pitfalls — server XOR
  scripts. Sibling agent worktrees have their OWN clone/lock/node_modules,
  but they share port 3000 unless they use `PORT`.
- **Egress goes through a proxy that 403s some hosts.** Seen blocked:
  GitHub release binary downloads (binaryen/wasm-opt — which is why the
  Sudachi patch sets `wasm-opt = false`), uta-net, YouTube (yt-dlp also
  isn't installed). jisho.org was reachable, but the app no longer calls it.
- **The dev server is heavy**: ~1.9 GB RSS (WASM dictionary in linear
  memory + JMnedict map + JMDict LevelDB). Don't run several at once.
- **Long waits**: don't poll with bare `sleep` loops in foreground shells
  (the harness blocks them); use background tasks with `until` loops.

## Delegating issues to subagents

When farming an issue out to a subagent, **point it at the issue — don't
paste the issue into the prompt.** The agent must:

1. **Read the issue and its comments itself** (GitHub MCP tools / `gh`).
   Comments often carry corrections and measurements newer than the body.
   If you restate the issue in the prompt, the issue stops being the source
   of truth and the whole point of filing it is lost.
2. Do the work on a branch based on the **current integration branch** (not
   `main`) when one is active — agents that branched from main here produced
   avoidable merge conflicts. Worktree agents: create a named branch from
   `origin/<integration-branch>` first thing.
3. Follow this file (TDD, lint/test gates) and NEVER push or open PRs unless
   told to; report branch + worktree path + commit SHAs for the parent to
   merge.
4. **Comment the outcome back on the issue** — what was measured, what was
   changed, key numbers, commit SHAs. The issue thread is the durable
   record; a subagent report that only lives in a chat transcript is lost to
   the next session. (Issue-closing itself happens when the branch merges.)

The prompt should carry only: the issue number, environment constraints the
agent can't discover (locks, ports, concurrent sessions), scope boundaries
(files owned by concurrent work), and the base-branch instruction.

## House rules for agents

- **Run `npm run lint` and `npm test` before claiming you're done.** Both are fast (~20 s each). They will catch the things humans usually catch in review.
- Prefer editing existing files over creating new ones; this codebase already has a lot of one-off scripts in `scripts/` and an over-large `App.tsx` — don't add to the sprawl unless the task asks for it.
- When you touch tokenization or scoring, run a smoke test against a known story (`npm run test:stories`) and check that `/api/extract` still produces sensible output for short text.
- For UI changes, start the dev server and exercise the change in a browser at http://localhost:3000 if you can; a passing `tsc` doesn't prove the UI works.
- Don't regenerate `STORIES_LIST.md` automatically — it's hand-edited.
- This file (CLAUDE.md) is the place to record any *non-obvious* behaviour you discover while working. If you spend more than a few minutes hunting for something, document it here on the way out.
