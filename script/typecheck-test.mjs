#!/usr/bin/env node
/**
 * Typecheck the test suite and gate only on the `test/js` lines.
 *
 * `npm run typecheck:tests` used to report the raw program. Now that the
 * program is part of `npm run typecheck` it needs the same boundary the
 * production gate has: `test/js/globals.d.ts` declares the CDN globals
 * (`L`, `ss`, `turf`, …) loose so mocked fakes stay assignable, and that
 * cascades TS7006/TS18046 into ~20 production lines the tests pull in as
 * imports. Those files are checked strictly by the root tsconfig (the first
 * step of `npm run typecheck`), so filtering them here loses nothing — and
 * filtering anything else would hide real test errors, which is the failure
 * mode this script exists to prevent.
 *
 * The parsing and the split are pure so they can be asserted directly; only
 * `runTsc` and the `main` shell touch the filesystem or the exit status.
 */
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { repoRoot } from "./build-path.mjs";

const REPO_ROOT = repoRoot(import.meta.url);

/**
 * Paths whose errors belong to the production program, not this one. tsc
 * reports paths relative to the program root, so this is a repo-relative
 * prefix — `.claude/` and similar siblings are not in the program's include
 * set and can never surface here.
 */
const PRODUCTION = /^foliplus\//;

/**
 * The subset of spawnSync's result this script reads. Looser than
 * `SpawnSyncReturns` on purpose: `main` is called with fakes in its tests.
 *
 * @typedef {{error?: unknown, status?: number | null, stdout?: string, stderr?: string}} SpawnResult
 */

/**
 * Group tsc output into one block per error. A block starts at a line of the
 * form `path(line,col): error TSxxxx:`; continuation lines (nested type
 * listings) belong to the preceding block. Lines that carry no path are kept
 * as their own block so a config-level failure is never filtered away.
 *
 * @param {string} text — tsc stdout + stderr
 * @returns {{path: string, lines: string[]}[]}
 */
const parseErrors = text => {
  const blocks = [];
  let current = null;
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const match = line.match(/^(\S+?)\(\d+,\d+\):\s*error TS\d+/);
    if (match) {
      current = { path: match[1], lines: [line] };
      blocks.push(current);
    } else if (current) {
      current.lines.push(line);
    } else {
      blocks.push({ path: "", lines: [line] });
    }
  }
  return blocks;
};

/**
 * The filter itself: production blocks out, everything else gating. The count
 * of dropped blocks is returned so the summary can state how much was
 * filtered — an unexplained filter is where a real test error would hide.
 *
 * @param {{path: string, lines: string[]}[]} blocks — parseErrors output
 * @returns {{gated: {path: string, lines: string[]}[], filtered: number}}
 */
const filterProduction = blocks => {
  const gated = [];
  let filtered = 0;
  for (const block of blocks) {
    if (PRODUCTION.test(block.path)) filtered += 1;
    else gated.push(block);
  }
  return { gated, filtered };
};

/** The only tsc invocation; `spawn` is injectable so the call is testable. */
const runTsc = ({
  spawn = spawnSync,
  execPath = process.execPath,
  cwd = REPO_ROOT,
} = {}) =>
  spawn(
    execPath,
    [
      resolve(cwd, "node_modules/typescript/bin/tsc"),
      "--noEmit",
      "--pretty",
      "false",
      "-p",
      "test/js/tsconfig.json",
    ],
    { cwd, encoding: "utf8" },
  );

/**
 * One pass: run tsc, filter, report. Returns the exit code rather than
 * exiting, so the shell can run in-process without killing the caller.
 * Status 2 is tsc's "compilation failed", which still carries usable output.
 *
 * @param {{run?: () => SpawnResult, log?: (text: string) => void, error?: (text: string) => void}} options
 * @returns {number} the process exit code
 */
const main = ({ run = runTsc, log = console.log, error = console.error } = {}) => {
  const out = run();

  if (out.error || (out.status !== 0 && out.status !== 2)) {
    error(out.error ? String(out.error) : `tsc exited ${out.status}`);
    return 1;
  }

  const { gated, filtered } = filterProduction(
    parseErrors(`${out.stdout ?? ""}\n${out.stderr ?? ""}`),
  );
  if (gated.length) {
    for (const block of gated) error(block.lines.join("\n"));
    return 1;
  }

  log(`test/js typecheck: 0 errors (production lines filtered by design: ${filtered})`);
  return 0;
};

/**
 * Whether node was told to run this file, rather than some test importing it.
 * Both sides are taken as arguments so the comparison is testable without
 * touching `process`.
 *
 * @param {string} importMetaUrl the caller's own `import.meta.url`
 * @param {string | undefined} argv1 node's `process.argv[1]`
 * @returns {boolean}
 */
const isMain = (importMetaUrl, argv1) => argv1 === fileURLToPath(importMetaUrl);

// The module's only load-time side effect. One expression, so the decision and
// the action sit on the same line and importing the module leaves nothing
// behind.
process.exitCode = isMain(import.meta.url, process.argv[1]) ? main() : process.exitCode;

export { PRODUCTION, filterProduction, isMain, main, parseErrors, runTsc };
