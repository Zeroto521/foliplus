/**
 * Shared pipeline for the two bundle-size gates (bundle-fuse.mjs and
 * bundle-size-check.mjs).
 *
 * The two gates were split by RESPONSIBILITY — the fuse judges each bundle
 * against a fixed absolute ceiling; the check judges growth against a
 * captured baseline. What they have in common is the measurement and
 * formatting pipeline: both read brotli bytes off the minified artifacts,
 * both need a project-root flag, and both render byte counts the same way.
 * That shared pipeline lives here, once.
 *
 * Exit codes are defined once so a CI script can read the code and know
 * which gate fired without grepping the log. Historically EXIT_THRESHOLD
 * and EXIT_UNKNOWN both lived at 2, which meant CI could not tell a
 * threshold breach from a new-unknown bundle. They are distinct numbers
 * here; see the constants below for the table.
 *
 * This module has no CLI of its own — it is imported by the two gates.
 */
import { readFileSync, readdirSync } from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";
import { brotliCompressSync } from "zlib";
import { parseArgs as parseArgsCore } from "./args.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

// ── Exit codes ──────────────────────────────────────────────────────────────
// One table, shared by both gates. The numbers are fixed:
//
//   0 = passed
//   1 = fuse tripped (an absolute ceiling was crossed) or a build error
//       (no bundles found, unwritable path, malformed CLI flag). Build
//       errors are folded in because a broken build is not "the code grew
//       too much" — both mean the pipeline cannot produce a trustworthy
//       verdict.
//   2 = delta exceeded the threshold (bundle-size-check under --enforce)
//   3 = an artifact has no fuse cap. Neither silently passing nor failing
//       under another code is right: a new bundle needs a human to either
//       add a cap or explain the drop.
//   4 = no baseline was passed to bundle-size-check under --enforce. A
//       distinct code separates "no evidence" from "evidence says over".
const EXIT_OK = 0;
const EXIT_FUSE = 1;
const EXIT_THRESHOLD = 2;
const EXIT_UNKNOWN = 3;
const EXIT_NO_BASELINE = 4;

// ── Dist dir + size reading ─────────────────────────────────────────────────
/** Resolve the dist directory under a project root. */
const distDir = root => resolve(root, "foliplus/dist");

// Drop the leading block comment — esbuild's `banner`. It is emitted by both
// builds being compared and carries no runtime code, and its byte count drifts
// with the build config, so counting it is pure diff noise. It stays in the
// shipped bundle: it is how a served asset is tied to the version that built it.
//
// Both gates use this so they measure the same bytes. A gate that stripped
// the banner and one that did not would silently disagree by ~50 bytes on
// every artifact — invisible against the fuse's 5 KB ceiling but visible
// against the check's 128 B floor.
const stripLeadingBlockComment = src => {
  const body = src.replace(/^﻿?\/\*[\s\S]*?\*\/\s*/, "");
  return body !== src ? body : src;
};

/**
 * Read brotli-byte sizes of every `*.min.{js,css}` in `<root>/foliplus/dist`.
 * Returns `{ filename: brotliByteCount }` in filename-sorted order.
 *
 * `brotliCompressSync` on the stripped source, not on the raw bytes — see
 * the stripLeadingBlockComment comment above for why.
 */
const readSizes = (root = ROOT) => {
  const dir = distDir(root);
  const files = readdirSync(dir)
    .filter(f => /\.min\.(js|css)$/.test(f))
    .sort();
  const sizes = {};
  for (const f of files) {
    const src = readFileSync(resolve(dir, f), "utf-8");
    sizes[f] = brotliCompressSync(stripLeadingBlockComment(src)).length;
  }
  return sizes;
};

// ── Formatting ──────────────────────────────────────────────────────────────
/** Format a byte count as a two-decimal KB string. */
const fmtBytes = n => (n / 1024).toFixed(2) + " KB";

// ── Shared SPEC base ────────────────────────────────────────────────────────
// Both gates accept `--root=<path>` for reading a different checkout's dist.
// `bundle-size-check` also takes `--emit` / `--baseline` / `--report` /
// `--threshold` / `--enforce` / `--base` / `--head`; `bundle-fuse` takes no
// extra flags. They each spread `baseSpec` into their own SPEC.
const baseSpec = {
  root: { type: "string", desc: "Project root (reads <root>/foliplus/dist)" },
};

/** Parse CLI args with `baseSpec` merged in. Same as parseArgs but with the
 *  `--root` flag always present. */
const parseArgsWithBase = (argv, extraSpec = {}) =>
  parseArgsCore(argv, { ...baseSpec, ...extraSpec });

export {
  EXIT_FUSE,
  EXIT_NO_BASELINE,
  EXIT_OK,
  EXIT_THRESHOLD,
  EXIT_UNKNOWN,
  ROOT,
  baseSpec,
  distDir,
  fmtBytes,
  parseArgsWithBase,
  readSizes,
  stripLeadingBlockComment,
};
