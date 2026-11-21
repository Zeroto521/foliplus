import { readFileSync, readdirSync, statSync } from "fs";
import { join, relative, resolve } from "path";
import { describe, expect, it } from "vitest";

// v8-ignore drift guard (patch-coverage-policy §3.2).
//
// v8 provider ignore comments are a whitelist for genuinely unreachable
// branches. Without a guard they become a brush for "I could not write the
// test" — so every `/* v8 ignore next */` (and every `/* v8 ignore start */`
// block) MUST sit within two lines of a `// unreachable:` or
// `// type-enforced:` label explaining WHY the branch cannot run. A bare
// ignore with no label is a red flag: it hides a real coverage gap.
//
// Per-file and per-repo ceilings stop the whitelist from growing unbounded:
//  - single file: at most 3 ignore directives
//  - whole repo:  at most 30 ignore directives
//
// `/* v8 ignore stop */` lines are not directives — they close a start block
// and are exempt (they pair with the labeled start line).
const REPO_ROOT = resolve(".");
const JS_DIR = resolve(REPO_ROOT, "foliplus/js");
const LABEL_RE = /\/\/\s*(unreachable|type-enforced)\s*:\s*(\S.*)$/;
// A label must name a real reason, not a placeholder: "unreachable: TODO"
// (or FIXME/XXX) would pass an existence-only check while saying nothing
// about why the branch cannot run.
const PLACEHOLDER_RE = /^\s*(TODO|FIXME|XXX)\b/i;
const SKIP_DIR = new Set(["node_modules", "dist", "coverage", ".git"]);
const PER_FILE_MAX = 3;
const REPO_MAX = 30;

function walk(dir: string, out: string[]): string[] {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIR.has(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (name.endsWith(".ts")) out.push(p);
  }
  return out;
}

/** Is a candidate label line semantically meaningful? A label must name a
 *  reason, not a placeholder: `// unreachable: TODO` is a label in name only. */
export function isLabelMeaningful(line: string): boolean {
  const m = line.match(LABEL_RE);
  return m !== null && !PLACEHOLDER_RE.test(m[2]);
}

/** Collect every ignore directive in one file. A directive is a
 *  `v8 ignore next` or `v8 ignore start` line; `v8 ignore stop` lines are
 *  closers, not directives, and are skipped. Returns { line, labeled, block }. */
function collectDirectives(file: string): { line: number; labeled: boolean }[] {
  const lines = readFileSync(file, "utf-8").split(/\r?\n/);
  const directives: { line: number; labeled: boolean }[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (/v8 ignore (next|start)/.test(lines[i])) {
      // Label must appear in the 2 lines above (not counting the ignore line
      // itself) and name a real reason (not a TODO/FIXME/XXX placeholder).
      const window = lines.slice(Math.max(0, i - 2), i);
      const labeled = window.some(isLabelMeaningful);
      directives.push({ line: i + 1, labeled });
    }
  }
  return directives;
}

describe("v8 ignore comments are labeled and bounded", () => {
  const files = walk(JS_DIR, []);
  const perFile = new Map<string, { line: number; labeled: boolean }[]>();
  let total = 0;
  for (const file of files) {
    const dirs = collectDirectives(file);
    if (dirs.length > 0) {
      perFile.set(relative(REPO_ROOT, file).replace(/\\/g, "/"), dirs);
    }
    total += dirs.length;
  }

  it("labels every v8 ignore directive", () => {
    const unlabeled: string[] = [];
    for (const [file, dirs] of perFile) {
      for (const d of dirs) {
        if (!d.labeled) unlabeled.push(`${file}:${d.line}`);
      }
    }
    expect(unlabeled).toEqual([]);
  });

  it("keeps each file at or below the per-file ceiling", () => {
    const over: string[] = [];
    for (const [file, dirs] of perFile) {
      if (dirs.length > PER_FILE_MAX) over.push(`${file} (${dirs.length})`);
    }
    expect(over).toEqual([]);
  });

  it("keeps the whole repo at or below the repo ceiling", () => {
    expect(total).toBeLessThanOrEqual(REPO_MAX);
  });

  it("rejects a placeholder label (TODO) as not meaningful", () => {
    expect(isLabelMeaningful("  // unreachable: TODO handle this")).toBe(false);
    expect(isLabelMeaningful("  // type-enforced: FIXME")).toBe(false);
  });

  it("accepts a label naming a real reason", () => {
    expect(
      isLabelMeaningful("  // unreachable: jsdom defines the Leaflet global"),
    ).toBe(true);
    expect(
      isLabelMeaningful("  // type-enforced: the guard is a type-level invariant"),
    ).toBe(true);
  });
});
