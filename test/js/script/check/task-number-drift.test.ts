import { readFileSync, readdirSync, statSync } from "fs";
import { join, relative, resolve } from "path";
import { describe, expect, it } from "vitest";

// Drift guard: internal task numbers (task-NN) are internal task-board ids and
// must never leak into source, tests, or comments. A PR or issue reference is
// spelled "#1234" (no "task-" prefix) and is fine; a bare dash-number id is not.
//
// This guard scans the tracked source tree (foliplus/ + test/) and fails on any
// match, so a future author reintroducing an internal task id is caught at
// authoring time (CI), not in review.
//
// Allowed (documented) exceptions live in ALLOWED as path fragments.
const REPO_ROOT = resolve(".");
const TASK_RE = /task-\d+/;
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

describe("internal task numbers stay out of source", () => {
  it("finds no task-NN in the tracked source tree", () => {
    const files = [
      ...walk(resolve(REPO_ROOT, "foliplus"), []),
      ...walk(resolve(REPO_ROOT, "test"), []),
    ];
    const hits: string[] = [];
    for (const file of files) {
      const rel = relative(REPO_ROOT, file).replace(/\\/g, "/");
      if (ALLOWED.some(a => rel.includes(a))) continue;
      const text = readFileSync(file, "utf-8");
      const m = text.match(TASK_RE);
      if (m) hits.push(`${rel}: task-\\d+ matched "${m[0]}"`);
    }
    expect(hits).toEqual([]);
  });
});
