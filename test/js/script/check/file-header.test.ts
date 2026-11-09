import { readFileSync, readdirSync, statSync } from "fs";
import { join, resolve } from "path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

// File-header drift guard.
//
// Canonical header: `// <rel> — <one-line description>` where <rel> is the module path
// relative to foliplus/js (no .ts extension). Barrel files (index.ts) and
// runtime/index.ts are exempt.
//
// The registry (file-header.canonical.json) lists every file that MUST carry the
// canonical header. A new .ts file under foliplus/js/platform/ or foliplus/js/ui/
// top level MUST be added to the registry; the completeness assertion below
// fails when one is forgotten. core/ and control/ files are checked only when
// registered (they are large and still converging).
//
// Why a registry and not git diff: CI checks out a shallow history (fetch-depth
// 1), so `git diff base...HEAD` cannot see which files are new. The registry is
// the stable, CI-safe source of truth for "must be canonical".
const REPO_ROOT = resolve(".");
const JS_DIR = resolve(REPO_ROOT, "foliplus/js");
const REGISTRY_PATH = resolve(
  REPO_ROOT,
  "test/js/script/check/file-header.canonical.json",
);

function readRegistry(): string[] {
  const raw = readFileSync(REGISTRY_PATH, "utf8");
  return JSON.parse(raw) as string[];
}

function headerProblems(file: string, rel: string): string[] {
  const problems: string[] = [];
  const text = readFileSync(file, "utf8");
  const lines = text.split(/\r?\n/);
  const first = lines[0] || "";
  const escaped = rel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`^// ${escaped} — .+`);
  if (!pattern.test(first)) {
    problems.push(`first line is not "// ${rel} — <desc>": ${JSON.stringify(first)}`);
  }
  const src = ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const firstStmt = src.statements[0];
  if (!firstStmt) {
    problems.push("file has no statements");
    return problems;
  }
  const leading = ts.getLeadingCommentRanges(src.text, 0);
  let hasHeaderComment = false;
  if (leading) {
    for (const range of leading) {
      const commentText = src.text.slice(range.pos, range.end);
      const commentLines = commentText.split(/\r?\n/);
      if (commentLines[0] && commentLines[0].startsWith(`// ${rel}`)) {
        hasHeaderComment = true;
        break;
      }
    }
  }
  if (!hasHeaderComment) {
    problems.push("first line is not the leading comment of the first statement");
  }
  return problems;
}

describe("file headers follow the canonical form", () => {
  it("every registered file exists and carries the canonical header", () => {
    const registry = readRegistry();
    const problems: string[] = [];
    for (const rel of registry) {
      const file = join(JS_DIR, `${rel}.ts`);
      if (!statSync(file).isFile()) {
        problems.push(`${rel}: registered but the file does not exist (stale entry)`);
        continue;
      }
      for (const p of headerProblems(file, rel)) {
        problems.push(`${rel}: ${p}`);
      }
    }
    expect(problems).toEqual([]);
  });

  it("platform/ and ui/ top-level non-barrel files are all registered", () => {
    const registry = new Set(readRegistry());
    const missing: string[] = [];
    for (const tier of ["platform", "ui"]) {
      const dir = join(JS_DIR, tier);
      for (const name of readdirSync(dir)) {
        if (!name.endsWith(".ts") || name === "index.ts") continue;
        const rel = `${tier}/${name.replace(/\.ts$/, "")}`;
        if (!registry.has(rel)) missing.push(rel);
      }
    }
    expect(missing).toEqual([]);
  });

  it("registry has no stale entries", () => {
    const registry = readRegistry();
    const missing: string[] = [];
    for (const rel of registry) {
      if (!statSync(join(JS_DIR, `${rel}.ts`)).isFile()) missing.push(rel);
    }
    expect(missing).toEqual([]);
  });
});
