import { readFileSync, readdirSync, statSync } from "node:fs";
import { relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

// Drift guard: no test file may reach the repo root (or any path outside its
// own subtree) with a parent-dir chain of three or more `../` segments.
// Deep chains were the failure mode — each `resolve(__dirname, up4)`
// encoded the file's own nesting depth (up4 = four parent levels), so moving one file (or the test tree)
// silently broke the anchor. The shared helper test/js/path.ts (imported via
// the #test alias) is now the single source for repo-relative paths; a test
// that needs the repo root imports { ROOT } or { repoPath } and lets the helper
// own the depth.
//
// This guard scans the tracked test tree and fails on any match, so a future
// author reintroducing a long parent-dir chain is caught at authoring time
// (CI), not in review.
const REPO_ROOT = resolve(".");
// 3+ parent segments (three parents, two slashes); the old
// /(?:..\/){3,}/ only caught 4+ levels and missed the common 3-level
// chain the lead's grep targets. A chain of two parent segments is
// legitimate for test-internal fixture imports, so it stays allowed.
const CHAIN_RE = /(?:\.\.\/){2,}\.\.(?=\/|["']|$)/;
const SOURCE_EXT = new Set([".ts", ".tsx", ".js", ".mjs", ".cjs"]);

function walk(dir: string, out: string[]): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules") continue;
    const p = resolve(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else {
      const dot = name.lastIndexOf(".");
      if (dot >= 0 && SOURCE_EXT.has(name.slice(dot))) out.push(p);
    }
  }
  return out;
}

describe("no deep parent-dir chains in the test suite", () => {
  it("finds no 3+ ../ segment in any test/js source file", () => {
    const files = walk(resolve(REPO_ROOT, "test/js"), []);
    const hits: string[] = [];
    for (const file of files) {
      const rel = relative(REPO_ROOT, file).replace(/\\/g, "/");
      const text = readFileSync(file, "utf-8");
      const m = text.match(CHAIN_RE);
      if (m) hits.push(`${rel}: 3+ parent-dir chain "${m[0]}"`);
    }
    expect(hits).toEqual([]);
  });
});
