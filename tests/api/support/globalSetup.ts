/**
 * Vitest globalSetup for the API test suite (tests/api/**).
 *
 * Spawns the *real* Express server (`server.ts`, via the local `tsx` binary)
 * as a subprocess and waits for it to actually answer HTTP requests before
 * handing control to the test files. Torn down with SIGKILL once all API
 * tests finish.
 *
 * Deliberately NOT importing anything from server.ts / src/lib — issue #251
 * is scoped to test the app over real HTTP, not to refactor server.ts to
 * export an Express `app` (that refactor belongs to a different concurrent
 * issue). The only server.ts change made for this harness is honoring
 * `process.env.PORT`.
 */
import { spawn, type ChildProcess } from 'child_process';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { fileURLToPath } from 'url';
import { BASE_URL, SERVER_BOOT_TIMEOUT_MS, TEST_API_PORT } from './config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// tests/api/support -> repo root
const REPO_ROOT = path.resolve(__dirname, '../../..');

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForServer(deadline: number, tail: string[]): Promise<void> {
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE_URL}/api/content`);
      if (res.ok) return;
    } catch {
      // Connection refused / server not up yet — keep polling.
    }
    await sleep(1000);
  }
  throw new Error(
    `[tests/api] Server did not become ready at ${BASE_URL}/api/content within ` +
      `${SERVER_BOOT_TIMEOUT_MS}ms.\n--- last server output ---\n${tail.join('')}`
  );
}

export default async function setup() {
  const tsxBin = path.join(REPO_ROOT, 'node_modules', '.bin', 'tsx');
  if (!fs.existsSync(tsxBin)) {
    throw new Error(`[tests/api] Could not find ${tsxBin} — run \`npm install\` first.`);
  }

  const logPath = path.join(os.tmpdir(), `kotonoha-test-api-server-${TEST_API_PORT}.log`);
  const logFd = fs.openSync(logPath, 'w');
  const tail: string[] = [];
  const record = (chunk: Buffer) => {
    const s = chunk.toString('utf8');
    fs.writeSync(logFd, s);
    tail.push(s);
    if (tail.length > 200) tail.shift();
  };

  console.log(`[tests/api] Starting server subprocess on ${BASE_URL} (log: ${logPath})...`);

  const child: ChildProcess = spawn(tsxBin, ['server.ts'], {
    cwd: REPO_ROOT,
    env: { ...process.env, PORT: String(TEST_API_PORT) },
    // detached so we own the whole process group at teardown — tsx/esbuild
    // can spawn helper processes, and the server itself ignores SIGTERM
    // handling nuance is irrelevant here since we always SIGKILL.
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  child.stdout?.on('data', record);
  child.stderr?.on('data', record);

  let exitedEarly: number | null = null;
  child.on('exit', (code) => {
    exitedEarly = code;
  });

  const deadline = Date.now() + SERVER_BOOT_TIMEOUT_MS;

  try {
    await waitForServer(deadline, tail);
  } catch (err) {
    if (exitedEarly !== null) {
      throw new Error(
        `[tests/api] Server subprocess exited early with code ${exitedEarly} before becoming ready.\n` +
          `--- last server output ---\n${tail.join('')}`
      );
    }
    throw err;
  }

  console.log('[tests/api] Server is up — running API tests.');

  return async function teardown() {
    if (child.pid && exitedEarly === null) {
      try {
        // Negative pid == kill the whole detached process group (server.ts
        // ignores/gracefully-handles SIGTERM in some builds, and may spawn
        // helper child processes for transcription/caption scraping — SIGKILL
        // the group so nothing lingers after the test run).
        process.kill(-child.pid, 'SIGKILL');
      } catch {
        // Already dead, or platform doesn't support process groups — fall
        // back to killing just the direct child.
        try { child.kill('SIGKILL'); } catch { /* ignore */ }
      }
    }
    try { fs.closeSync(logFd); } catch { /* ignore */ }
  };
}
