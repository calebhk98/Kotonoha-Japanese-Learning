/**
 * Shared constants for the API test harness.
 *
 * Kept in its own module (rather than computed inside globalSetup) so that
 * both the global setup (which spawns the server) and individual test files
 * (which make HTTP requests) agree on the same port/base URL without relying
 * on cross-process env propagation timing.
 */

// A fixed, unusual port so it doesn't collide with `npm run dev` (3000) or
// Vite's own dev server. Overridable via TEST_API_PORT if it's ever taken.
export const TEST_API_PORT = Number(process.env.TEST_API_PORT) || 34125;

export const BASE_URL = `http://127.0.0.1:${TEST_API_PORT}`;

// First boot has to extract jmdict-all-3.6.2.json.tgz (~25MB -> ~270MB) and
// jmnedict.json.gz, plus load the Sudachi WASM tokenizer, before app.listen()
// is reached. CLAUDE.md documents ~30s warm / considerably longer cold —
// 240s gives generous headroom for a cold sandbox.
export const SERVER_BOOT_TIMEOUT_MS = 240_000;
