import { readFileSync, readdirSync, statSync } from "fs";
import { join, relative, resolve } from "path";
import { describe, expect, it } from "vitest";

// Drift guard: internal identifiers must never leak into source, tests, or
// comments. Two families are internal-only:
//
//   - `task-NN`: task-board ids. A PR or issue reference is spelled "#1234"
//     (no "task-" prefix) and is fine; a bare dash-number id is not.
//   - `§N.N`: section numbers of design/spec notes that live outside this
//     repository. A reader here cannot follow them, so the sentence has to
//     stand on its own instead.
//
// This guard scans the tracked source tree (foliplus/ + test/) and fails on any
// match, so a future author reintroducing an internal id is caught at authoring
// time (CI), not in review.
//
// Allowed (documented) exceptions live in ALLOWED as path fragments.
const REPO_ROOT = resolve(".");
const INTERNAL_RES: { name: string; re: RegExp }[] = [
  { name: "task-NN", re: /task-\d+/ },
  { name: "§N.N", re: /§\s*\d/ },
];
const ALLOWED: string[] = [];
const SOURCE_EXT = new Set([".ts", ".tsx", ".py", ".js", ".mjs", ".cjs"]);
const SKIP_DIR = new Set([
  "node_modules",
  "dist",
  ".venv",
  ".git",
  "coverage",
  ".agents",
]);

function walk(dir: string, out: string[]): string[] {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIR.has(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      walk(p, out);
    } else {
      const dot = name.lastIndexOf(".");
      if (dot >= 0 && SOURCE_EXT.has(name.slice(dot))) out.push(p);
    }
  }
  return out;
}

describe("internal identifiers stay out of source", () => {
  it("finds no task-NN or section number in the tracked source tree", () => {
    const files = [
      ...walk(resolve(REPO_ROOT, "foliplus"), []),
      ...walk(resolve(REPO_ROOT, "test"), []),
    ];
    const hits: string[] = [];
    for (const file of files) {
      const rel = relative(REPO_ROOT, file).replace(/\\/g, "/");
      if (ALLOWED.some(a => rel.includes(a))) continue;
      const text = readFileSync(file, "utf-8");
      for (const { name, re } of INTERNAL_RES) {
        const m = text.match(re);
        if (m) hits.push(`${rel}: ${name} matched "${m[0]}"`);
      }
    }
    expect(hits).toEqual([]);
  });
});
