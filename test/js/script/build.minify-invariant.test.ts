// The minify invariant, pinned as a permanent test.
//
// Bundle-size gates (bundle-fuse.mjs, bundle-size-check.mjs) read bytes off
// minified builds. esbuild strips all `/* */` and `//` comments that are
// not marked `@preserve` or `@license`, so a source file with tens of KB of
// inline comments produces the same bytes as the same file without any
// comments — that is the invariant this test locks down. (Note: this holds
// regardless of whether --minify is passed; esbuild strips comments even in
// unminified output. That's why the "turn minify off" inverse from terser
// doesn't apply here.)
//
// We invoke esbuild's CLI in a child process rather than importing
// transformSync, because the CLI runs in a fresh Node realm and bypasses
// jsdom's TextEncoder (which trips esbuild's `instanceof Uint8Array`
// check at module load). One short-lived exec per case.
import { execFileSync } from "child_process";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join, resolve } from "path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const cwd = process.cwd();
let tmp = "";
// esbuild's JS API tripped over jsdom's TextEncoder (the `instanceof
// Uint8Array` check at module load). We invoke the CLI in a child process
// so it runs in a fresh Node realm. The native binary lives under
// `@esbuild/<platform>-<arch>/`; the exact subdir and file name depend on
// the host. Only the two platforms we build on are named explicitly — a
// third platform should fail loudly here rather than silently.
const cli = (() => {
  const p = process.platform,
    a = process.arch;
  if (p === "win32" && a === "x64")
    return resolve(cwd, "node_modules", "@esbuild", "win32-x64", "esbuild.exe");
  if (p === "linux" && a === "x64")
    return resolve(cwd, "node_modules", "@esbuild", "linux-x64", "bin", "esbuild");
  throw new Error(`no esbuild native binary known for ${p}-${a}`);
})();

beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), "minify-inv-"));
});

afterAll(() => {
  rmSync(tmp, { recursive: true, force: true });
});

// One synthetic TypeScript source, and the same source with a 51,200-char
// `//` comment prefix. The comment size is deliberately above the largest
// comment budget recorded in build.test.ts history (~17 KB), so any build
// path that counts comments will visibly change between the two.
const SRC = "export function add(a: number, b: number): number { return a + b; }";
const NOISE = "// " + "x".repeat(51196) + "\n";

const baseOpts = [
  "--log-level=error",
  "--format=iife",
  "--keep-names=false",
  "--target=es2022",
  "--loader:.ts=ts",
];

const build = (src: string, extra: string[] = []) => {
  writeFileSync(resolve(tmp, "in.ts"), src);
  return execFileSync(cli, [...baseOpts, ...extra, resolve(tmp, "in.ts")], {
    cwd,
  });
};

describe("minify invariant", () => {
  it("comments are stripped when minify is on", () => {
    const a = build(SRC, ["--minify"]);
    const b = build(NOISE + SRC, ["--minify"]);
    expect(Buffer.compare(a, b)).toBe(0);
  });

  it("reverse proof: @preserve comments survive, so stripping is real", () => {
    // Directly the mirror of the first test. esbuild keeps `@preserve` and
    // `@license` comments even under --minify (they are "legal comments" —
    // the tool can't legally strip attribution). So if we swap the plain
    // `//` comment for a `@preserve` block, the two outputs must differ:
    // the invariant in the first test really is about ordinary comments
    // being stripped, not about trivially-passing assertions.
    const LEGAL = "/* @preserve " + "x".repeat(51196) + " */\n";
    const a = build(SRC, ["--minify"]);
    const b = build(LEGAL + SRC, ["--minify"]);
    // The preserved comment shows up in the output as-is: 51,200+ bytes.
    expect(b.byteLength).toBeGreaterThan(a.byteLength + 50_000);
    expect(Buffer.compare(a, b)).not.toBe(0);
  });

  it("the noise really is comment-only — whitespace padding behaves the same", () => {
    const blank = " ".repeat(51196) + SRC;
    // Under --minify both comments and excess whitespace are stripped, so
    // three inputs (no noise, comment noise, blank noise) all collapse to
    // the same bytes. If the first test isn't a quirk of `//` specifically,
    // this still holds.
    const a = build(SRC, ["--minify"]);
    const c = build(blank, ["--minify"]);
    expect(Buffer.compare(a, c)).toBe(0);
  });
});
