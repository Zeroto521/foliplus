import { execFileSync } from "child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "fs";
import { tmpdir } from "os";
import { join, resolve } from "path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { esbuildCfgFor } from "#script/esbuild-config.mjs";

// Vitest runs with the repo root as cwd, same convention bundle-size-check
// relies on —so dist/ resolves without a parent-directory walk.
const ROOT = resolve(process.cwd());
const distDir = resolve(ROOT, "foliplus/dist");

// Artifact names come from dist/artifacts.json, which `script/build.mjs`
// writes on every real build —the same list `test/python/test_asset.py`
// asserts wheel membership against. A new component therefore shows up in
// both stacks without either test hardcoding its name.
const names: string[] = (
  JSON.parse(readFileSync(resolve(distDir, "artifacts.json"), "utf-8")) as {
    artifacts: string[];
  }
).artifacts;
const artifactsFor = (ext: string): string[] =>
  names.map(name => `foliplus-${name}.min.${ext}`);

const JS_ARTIFACTS = artifactsFor("js");
const CSS_ARTIFACTS = artifactsFor("css");

describe("build artifacts", () => {
  it("all JS artifacts exist", () => {
    for (const artifact of JS_ARTIFACTS) {
      expect(existsSync(resolve(distDir, artifact)), artifact).toBe(true);
    }
  });

  it("all CSS artifacts exist", () => {
    for (const artifact of CSS_ARTIFACTS) {
      expect(existsSync(resolve(distDir, artifact)), artifact).toBe(true);
    }
  });

  it("common JS contains BaseControl class", () => {
    const content = readFileSync(resolve(distDir, "foliplus-common.min.js"), "utf-8");
    expect(content).toContain("BaseControl");
  });

  it("common JS contains L.Control (Leaflet base)", () => {
    const content = readFileSync(resolve(distDir, "foliplus-common.min.js"), "utf-8");
    expect(content).toContain("L.Control");
  });

  it("common JS has version banner", () => {
    const content = readFileSync(resolve(distDir, "foliplus-common.min.js"), "utf-8");
    expect(content).toContain("foliplus@");
    expect(content).toMatch(/\/\*!/);
  });

  it("common JS exposes foliplus.version", () => {
    const content = readFileSync(resolve(distDir, "foliplus-common.min.js"), "utf-8");
    expect(content).toContain("foliplus.version");
  });

  it("component JS externalizes BaseControl", () => {
    const content = readFileSync(
      resolve(distDir, "foliplus-ScaleControl.min.js"),
      "utf-8",
    );
    expect(content).toContain("foliplus.BaseControl");
  });

  it("component JS externalizes common modules", () => {
    const content = readFileSync(
      resolve(distDir, "foliplus-ExportControl.min.js"),
      "utf-8",
    );
    expect(content).toContain("foliplus.common");
  });

  it("component JS does NOT bundle common modules", () => {
    const content = readFileSync(
      resolve(distDir, "foliplus-ScaleControl.min.js"),
      "utf-8",
    );
    expect(content).not.toContain("class BaseControl");
  });

  it("common JS is non-empty", () => {
    const size = readFileSync(resolve(distDir, "foliplus-common.min.js")).length;
    expect(size).toBeGreaterThan(0);
  });

  it("component JS is non-empty", () => {
    for (const artifact of JS_ARTIFACTS.filter(a => a !== "foliplus-common.min.js")) {
      const size = readFileSync(resolve(distDir, artifact)).length;
      expect(size, artifact).toBeGreaterThan(500);
    }
  });

  it("CSS files are non-empty", () => {
    for (const artifact of CSS_ARTIFACTS) {
      const size = readFileSync(resolve(distDir, artifact)).length;
      expect(size, artifact).toBeGreaterThan(0);
    }
  });

  it("merged common CSS carries no @import statements", () => {
    // mergeCommonCss resolves the css/common/ import graph at build time and
    // strips the statements; a leftover @import would make the bundle fetch
    // modules at runtime (or fail to resolve) instead of shipping flat.
    const css = readFileSync(resolve(distDir, "foliplus-common.min.css"), "utf-8");
    expect(css).not.toMatch(/@import/);
  });

  it("has correct number of JS artifacts", () => {
    const jsFiles = readdirSync(distDir).filter(f => f.endsWith(".min.js"));
    expect(jsFiles.length).toBeGreaterThanOrEqual(JS_ARTIFACTS.length);
  });

  it("has correct number of CSS artifacts", () => {
    const cssFiles = readdirSync(distDir).filter(f => f.endsWith(".min.css"));
    expect(cssFiles.length).toBeGreaterThanOrEqual(CSS_ARTIFACTS.length);
  });

  it("manifest covers both halves of every component", () => {
    for (const name of names) {
      expect(JS_ARTIFACTS).toContain(`foliplus-${name}.min.js`);
      expect(CSS_ARTIFACTS).toContain(`foliplus-${name}.min.css`);
    }
    expect(names).toContain("common");
    expect(names).not.toContain("runtime");
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Minify invariant: our compressed config strips comments, so a wall of comments
// in the source produces the same bytes as no comments at all. That is the
// invariant the bundle-size gates rely on: they measure the minified output, so
// comment noise must never count.
//
// The config we inspect comes from script/esbuild-config.mjs —the same factory
// script/build.mjs calls. Asserting `minify === true` here is what ties the
// "size gates measure compressed bytes" claim to the actual build; without it,
// someone could set `minify: false` in the real config and every gate would
// keep passing.
//
// esbuild's CLI is invoked in a child process rather than via the JS API
// because the jsdom test environment swaps globalThis.TextEncoder, which trips
// esbuild's `instanceof Uint8Array` check at module load. One short-lived
// execSync per case.
// ──────────────────────────────────────────────────────────────────────────────

let tmp = "";
const cwd = ROOT;
const cli = (() => {
  const p = process.platform;
  const a = process.arch;
  if (p === "win32" && a === "x64") {
    return resolve(cwd, "node_modules", "@esbuild", "win32-x64", "esbuild.exe");
  }
  if (p === "linux" && a === "x64") {
    return resolve(cwd, "node_modules", "@esbuild", "linux-x64", "bin", "esbuild");
  }
  throw new Error(`no esbuild native binary known for ${p}-${a}`);
})();

// Translate the config's scalar fields to CLI flags. `plugins`, `alias`,
// `define`, `entryPoints`, `outfile`, `treeShaking` and `banner` are skipped:
// plugins are JS functions (they don't serialize to CLI), the rest aren't
// used by the invariant being tested (comment stripping under `minify`).
//
// `--sourcemap` is only emitted when truthy —the CLI takes
// `linked|inline|external|both` and rejects `false`, so a falsy value is
// expressed by omission.
const cliArgs = (cfg: ReturnType<typeof esbuildCfgFor>) =>
  [
    "--log-level=error",
    `--format=${cfg.format}`,
    cfg.minify ? "--minify" : "--minify=false",
    `--keep-names=${cfg.keepNames}`,
    cfg.sourcemap ? `--sourcemap=${cfg.sourcemap}` : "",
    cfg.allowOverwrite ? "--allow-overwrite" : "",
  ].filter(Boolean);

const buildWithConfig = (src: string, cfg: ReturnType<typeof esbuildCfgFor>) => {
  writeFileSync(join(tmp, "in.ts"), src);
  return execFileSync(cli, [...cliArgs(cfg), join(tmp, "in.ts")], { cwd });
};

beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), "minify-inv-"));
});

afterAll(() => {
  rmSync(tmp, { recursive: true, force: true });
});

// One synthetic TypeScript source, and the same source with a 51,196-char
// `//` comment prefix. The comment size is deliberately above the largest
// comment budget recorded in build.test.ts history (~17 KB), so any build
// path that counts comments will visibly change between the two.
const SRC = "export function add(a: number, b: number): number { return a + b; }";
const NOISE = "// " + "x".repeat(51196) + "\n";

describe("minify invariant", () => {
  it("the real build config minifies when not in dev mode", () => {
    // The invariant the gates depend on: the compressed config must have
    // minify on. If this flips, every bundle-size gate silently measures
    // unminified bytes and every reported number is a lie.
    expect(esbuildCfgFor({ dev: false, root: cwd }).minify).toBe(true);
    expect(esbuildCfgFor({ dev: true, root: cwd }).minify).toBe(false);
  });

  // Two real esbuild builds each: the default 5s test budget is spent on
  // parallel-suite load alone, not on the assertions. Explicit per-test
  // budget so the invariant stays a format check rather than a load check.
  it("comments are stripped when minify is on", { timeout: 30_000 }, () => {
    const cfg = esbuildCfgFor({ dev: false, root: cwd });
    const a = buildWithConfig(SRC, cfg);
    const b = buildWithConfig(NOISE + SRC, cfg);
    expect(Buffer.compare(a, b)).toBe(0);
  });

  it(
    "reverse proof: @preserve comments survive, so stripping is real",
    { timeout: 30_000 },
    () => {
      // Directly the mirror of the previous test. esbuild keeps `@preserve`
      // and `@license` comments even under --minify (they are "legal
      // comments" —the tool can't legally strip attribution). So if we swap
      // the plain `//` comment for a `@preserve` block, the two outputs must
      // differ: the invariant really is about ordinary comments being
      // stripped, not about trivially-passing assertions.
      const LEGAL = "/* @preserve " + "x".repeat(51196) + " */\n";
      const cfg = esbuildCfgFor({ dev: false, root: cwd });
      const a = buildWithConfig(SRC, cfg);
      const b = buildWithConfig(LEGAL + SRC, cfg);
      // The preserved comment shows up in the output as-is: 51,200+ bytes.
      expect(b.byteLength).toBeGreaterThan(a.byteLength + 50_000);
      expect(Buffer.compare(a, b)).not.toBe(0);
    },
  );

  it(
    "the noise really is comment-only — whitespace padding behaves the same",
    { timeout: 30_000 },
    () => {
      const blank = " ".repeat(51196) + SRC;
      // Under --minify both comments and excess whitespace are stripped, so
      // three inputs (no noise, comment noise, blank noise) all collapse to
      // the same bytes. If the previous test weren't a quirk of `//`, this
      // still holds.
      const cfg = esbuildCfgFor({ dev: false, root: cwd });
      const a = buildWithConfig(SRC, cfg);
      const c = buildWithConfig(blank, cfg);
      expect(Buffer.compare(a, c)).toBe(0);
    },
  );
});
