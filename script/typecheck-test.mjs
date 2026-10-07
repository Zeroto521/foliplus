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
 */
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Paths whose errors belong to the production program, not this one. */
const PRODUCTION = /^foliplus\//;

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

const main = () => {
  const out = spawnSync(
    process.execPath,
    [
      resolve(REPO_ROOT, "node_modules/typescript/bin/tsc"),
      "--noEmit",
      "--pretty",
      "false",
      "-p",
      "test/js/tsconfig.json",
    ],
    { cwd: REPO_ROOT, encoding: "utf8" },
  );

  if (out.error || (out.status !== 0 && out.status !== 2)) {
    console.error(out.error ? String(out.error) : `tsc exited ${out.status}`);
    process.exit(1);
  }

  const blocks = parseErrors(`${out.stdout ?? ""}\n${out.stderr ?? ""}`);
  const gated = blocks.filter(b => !PRODUCTION.test(b.path));
  const filtered = blocks.length - gated.length;

  if (gated.length) {
    for (const block of gated) console.error(block.lines.join("\n"));
    process.exit(1);
  }
  console.log(
    `test/js typecheck: 0 errors` +
      ` (production lines filtered by design: ${filtered})`,
  );
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}

export { PRODUCTION, parseErrors };
