/**
 * Plain-JS bootstrap shim for extraction-worker.ts (fix for #200).
 *
 * Worker threads cannot inherit the parent's tsx module hooks — tsx skips
 * hook registration when isMainThread is false.  Passing --import tsx/esm in
 * execArgv has the same problem: tsx's initialize() requires a truthy data
 * argument that only arrives when Node itself invokes it via --import on the
 * CLI, not when the module is loaded inside a worker.
 *
 * This shim:
 *   1. Calls register() with the tsx ESM loader and { data: {} } so that tsx's
 *      initialize() hook receives a truthy argument and wires up its resolve/load
 *      hooks for this worker thread.
 *   2. Dynamically imports extraction-worker.ts so all its .js-extension imports
 *      resolve to the corresponding .ts source files via the now-active tsx hooks.
 *
 * server.ts spawns this shim as the Worker entry point instead of pointing
 * directly at the .ts file.
 */

import { register } from 'node:module';
import { createRequire } from 'module';
import { pathToFileURL } from 'url';

const req = createRequire(import.meta.url);
const tsxEsm = req.resolve('tsx/esm');

// { data: {} } satisfies tsx's initialize() check (it throws if data is falsy)
register(tsxEsm, pathToFileURL(process.cwd() + '/'), { data: {} });

// With tsx hooks active, .ts files can now be imported from this worker thread.
await import('./extraction-worker.ts');
