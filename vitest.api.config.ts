import path from 'path';
import { defineConfig } from 'vitest/config';

/**
 * Separate Vitest project for the API-level test suite (issue #251).
 *
 * These tests spawn the real `server.ts` as a subprocess (see
 * tests/api/support/globalSetup.ts) and exercise it over HTTP — they take
 * much longer than the unit suite (server boot alone can take up to ~240s
 * on a cold cache) so they're deliberately kept out of the default
 * `npm test` / vite.config.ts run. Use `npm run test:api` to run this suite.
 *
 * Not named `vitest.config.ts` on purpose: Vitest prefers an exact
 * `vitest.config.*` over `vite.config.*` when resolving config for a bare
 * `vitest` invocation, which would silently swallow the existing unit-test
 * config. Keeping this as `vitest.api.config.ts` means it's only used when
 * explicitly passed via `--config`.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/api/**/*.test.ts'],
    globalSetup: ['tests/api/support/globalSetup.ts'],
    // Server boot (cold cache: jmdict/jmnedict extraction + Sudachi WASM) can
    // legitimately take minutes; give the setup/teardown hooks lots of room.
    hookTimeout: 250_000,
    // Individual requests should be fast once the server is warm, but the
    // first hit of a cold word can trigger a live Jisho lookup.
    testTimeout: 30_000,
    // All test files share one live server instance — running them across
    // multiple worker processes wouldn't help (network-bound, not CPU-bound)
    // and serial execution keeps failure output easy to read.
    fileParallelism: false,
  },
});
