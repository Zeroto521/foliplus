import { readFileSync, readdirSync, statSync } from "fs";
import { basename, join, relative, resolve } from "path";
import { describe, expect, it } from "vitest";

// Drift guard: internal identifiers must never leak into source, tests, or
// comments. Three families are internal-only:
//
//   - `task-NN`: task-board ids. A PR or issue reference is spelled "#1234"
//     (no "task-" prefix) and is fine; a bare dash-number id is not.
//   - `§N.N`: clause numbers of design/spec notes that live outside this
//     repository. A reader here cannot follow them, so the sentence has to
//     stand on its own instead.
//   - a citation of a markdown file that this repository does not contain: a
//     design note kept beside the checkout is invisible to everyone else, so
//     the comment has to carry the reasoning itself.
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
const MD_CITE_RE = /\b([A-Za-z0-9_.-]+\.md)\b/;
const COMMENT_RE = /(^|\s)(\/\/|\*|\/\*|#|"""|''')/;
const ALLOWED: string[] = [];
const SOURCE_EXT = new Set([".ts", ".tsx", ".py", ".js", ".mjs", ".cjs"]);
const SKIP_DIR = new Set([
  "node_modules",
  "dist",
  ".venv",
  ".git",
  "coverage",
  ".agents",
  "__pycache__",
  // Scratch space (notes / tmp / design packets) and sandbox-generated pytest
  // caches: untracked, not source. The walker also cannot read some of them in
  // a sandboxed checkout.
  ".foliplus",
  ".pytest_cache",
]);

function walk(dir: string, out: string[], exts: Set<string>): string[] {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIR.has(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      walk(p, out, exts);
    } else {
      const dot = name.lastIndexOf(".");
      if (dot >= 0 && exts.has(name.slice(dot))) out.push(p);
    }
  }
  return out;
}

/** Every markdown file this repository actually contains, by basename. A
 *  citation of anything else is a pointer to a checkout-local note. */
function repoMarkdown(): Set<string> {
  const files = walk(REPO_ROOT, [], new Set([".md"]));
  return new Set(files.map(f => basename(f)));
}

describe("internal identifiers stay out of source", () => {
  it("finds no task-NN, clause number or foreign markdown citation", () => {
    const files = [
      ...walk(resolve(REPO_ROOT, "foliplus"), [], SOURCE_EXT),
      ...walk(resolve(REPO_ROOT, "test"), [], SOURCE_EXT),
      ...walk(resolve(REPO_ROOT, "script"), [], SOURCE_EXT),
    ];
    const md = repoMarkdown();
    const hits: string[] = [];
    for (const file of files) {
      const rel = relative(REPO_ROOT, file).replace(/\\/g, "/");
      if (ALLOWED.some(a => rel.includes(a))) continue;
      const text = readFileSync(file, "utf-8");
      for (const { name, re } of INTERNAL_RES) {
        const m = text.match(re);
        if (m) hits.push(`${rel}: ${name} matched "${m[0]}"`);
      }
      for (const line of text.split("\n")) {
        if (!COMMENT_RE.test(line)) continue;
        const m = line.match(MD_CITE_RE);
        if (!m || md.has(m[1])) continue;
        // A CLI example such as `--report=out.md` names a file the command
        // writes, not a document it cites.
        const before = line.slice(0, m.index ?? 0).trimEnd();
        if (before.endsWith("=")) continue;
        hits.push(`${rel}: cites untracked markdown "${m[1]}"`);
      }
    }
    expect(hits).toEqual([]);
  });
});
