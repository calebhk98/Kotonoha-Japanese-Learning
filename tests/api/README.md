# API test harness (issue #251)

Real end-to-end tests over the Express API, exercised over HTTP against the
actual `server.ts` — no mocking of the tokenizer, dictionaries, or database.

## Running

```bash
npm run test:api
```

This is a **separate suite from `npm test`**. It is not picked up by the
default `vitest run` (see `vite.config.ts`'s `test.exclude`, which lists
`tests/api/**`), because it's much slower: `tests/api/support/globalSetup.ts`
spawns a real server subprocess and waits for it to actually answer requests
before any test file runs. On a warm cache that's a few seconds; on a cold
one (fresh `.cache.db`, jmdict/jmnedict not yet extracted, Sudachi WASM not
yet built) it can take minutes — the setup step allows up to 240s
(`SERVER_BOOT_TIMEOUT_MS` in `support/config.ts`).

**Side effect to know about:** booting the real server also starts its
background caption-scraper/lyrics-fetcher jobs (see server.ts's
`runStartupCaptionScraper` / `loadMusicTranscriptsInBackground`), which write
scrape-attempt bookkeeping directly into `src/videos/*/metadata.json` on
disk. A short-lived test run rarely gets far enough to touch much, but check
`git status` after running this suite and `git checkout -- src/videos/` (or
`src/music/`) if anything unrelated shows up as modified — it's noise from
the live server, not from the tests themselves.

## How it works

- `vitest.api.config.ts` (repo root) is a standalone Vitest config — not
  named `vitest.config.ts` on purpose, since Vitest prefers an exact
  `vitest.config.*` over `vite.config.*` for a bare `vitest` invocation,
  which would otherwise silently replace the unit-test config used by
  `npm test`. It's only picked up via `npm run test:api`'s explicit
  `--config vitest.api.config.ts`.
- `tests/api/support/config.ts` — the fixed test port (`34125` by default,
  override with `TEST_API_PORT`) and the boot timeout.
- `tests/api/support/globalSetup.ts` — Vitest `globalSetup`. Spawns
  `node_modules/.bin/tsx server.ts` directly (not `npx tsx`, to avoid an
  extra process-tree layer) with `PORT` set to the test port, `detached:
  true` so the child gets its own process group, and polls
  `GET /api/content` until it returns 200. Teardown sends `SIGKILL` to the
  whole process group (`process.kill(-pid, 'SIGKILL')`) rather than
  `SIGTERM` — server.ts's shutdown handling has changed over time (see
  CLAUDE.md's drift warning), and SIGKILL is unconditionally reliable
  regardless of what the current handler does.
- `tests/api/support/client.ts` — thin `fetch` wrappers (`apiGet`/`apiPost`)
  plus small helpers (`findWord`, `primarySense`) shared across test files.
- Server logs are captured to
  `${os.tmpdir()}/kotonoha-test-api-server-<port>.log` for post-mortem
  debugging if the server fails to boot in time; the path is printed to the
  console at the start of the run.

This harness deliberately does **not** import or refactor `server.ts` to
expose an `app` for in-process testing (that refactor is scoped to a
different, concurrently-landing issue). The only change made to `server.ts`
for this harness is honoring `process.env.PORT` (falls back to `3000`) so
tests can run on a non-default port without colliding with a `npm run dev`
instance.

## Known deviations from a "clean" pass (read before extending)

While building this harness, a few places where reality didn't match the
originally-assumed behaviour were found by actually hitting the running
server repeatedly (per CLAUDE.md's "verify before you assert" guidance)
rather than assumed from the issue description:

1. **`GET /api/word/読みました` (bare conjugated surface form, no tokenizer
   context) is genuinely non-deterministic**, not just a one-off cold-cache
   artifact — repeated `npm run test:api` runs (with and without a
   from-scratch `.cache.db`) saw its `meaning` flip between a real
   "read"-related gloss and literal `"Unknown meaning"`. Two structural
   causes, not incidental flakiness: (a) the JMDict lookup step falls back to
   a *live Jisho API network call* capped at 2 concurrent requests
   (`JishoApiDictionary` in `src/lib/dictionary.ts`), which the startup
   content-extraction background worker is also competing for; and (b) this
   harness's `SIGKILL` teardown (required — see below) can discard a
   `wordsCache` write that hadn't been flushed to `.cache.db` yet, so a later
   run doesn't reliably inherit a warm cache entry for this exact literal
   string. `word.test.ts` pins only the reliable contract (200, non-empty
   meaning) for this specific unstemmed-standalone-lookup case;
   `extract.test.ts` / `consistency.test.ts` pin the real "read"-related
   meaning where it's actually stable (via the tokenizer-supplied baseForm).
2. **`本` ("book") does not resolve to a "book" meaning.** `POST
   /api/extract` / `GET /api/word/本` currently resolve 本's primary
   `meaning` to "origin", not "book" — even though the raw JMDict `entry`
   *does* list `["book", "volume", "script"]` as its first gloss group
   (visible in `GET /api/word/:word`'s `entry` field). This looks like a
   real, narrow sense-ordering bug where the JMDict-backed lookup path
   (`DictionaryManager`) disagrees with the kanji-data path used to build
   `entry`. `extract.test.ts` and `word.test.ts` pin the current behaviour
   (a real, non-"Unknown meaning" result, with `score === 1` as documented
   in CLAUDE.md) and flag the discrepancy inline rather than asserting a
   "book" meaning that isn't actually produced. Worth its own issue.
3. **The `reading`/`pos` query-hint homograph disambiguation for
   `GET /api/word/:word` doesn't exist in this checkout.** A sibling branch
   (commit `a250f40`, "feat: carry in-context reading/POS to the word detail
   page") implements exactly this — `人` read `にん` (counter, e.g. 六人)
   should resolve differently than `人` read `ひと` (person) — but that
   branch hadn't merged into this checkout's base when this harness was
   built, and implementing it here was out of scope (would require editing
   `server.ts`/`wordResolver.ts` beyond the PORT change this task is scoped
   to). `word.test.ts`'s `reading/pos context hints (人)` block pins
   *today's* behaviour (query hints accepted, not yet honored — all three
   variants currently agree) and has a comment pointing at what to change
   once that branch lands.

None of the above are bugs introduced by this harness — they were verified
against the live server before being written down. Flagging them here (and
in the relevant test files) rather than silently asserting the originally
expected — but not actually true — behaviour.
