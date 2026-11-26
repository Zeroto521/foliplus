import { readFileSync, readdirSync, statSync } from "fs";
import { join, relative, resolve } from "path";
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
//
// script/ follows the same convention anchored at the repo root: the first line
// (line 1, or line 2 after a shebang) is `// script/<rel> — <desc>` with <rel> the
// module path from the repo root with no .mjs extension. The tooling is the code
// with the fewest readers — a reader arrives at a 500-line gate script with nothing
// to orient them — so its header is the only place that says what the file is FOR.
// There is no allow-list here: the directory is finite, every module is shipped
// tooling, and a new script without a header fails immediately.
const REPO_ROOT = resolve(".");
const JS_DIR = resolve(REPO_ROOT, "foliplus/js");
const REGISTRY_PATH = resolve(REPO_ROOT, "test/js/guard/file-header.canonical.json");

function readRegistry(): string[] {
  const raw = readFileSync(REGISTRY_PATH, "utf8");
  return JSON.parse(raw) as string[];
}

/** Stat the file, treating any error (ENOENT, EACCES, race-delete) as
 *  "not a file". The caller reports a readable problem string instead of
 *  letting the stat exception escape as an opaque stack trace. */
function isRegisteredPathAFile(file: string): boolean {
  try {
    return statSync(file).isFile();
  } catch {
    return false;
  }
}

/** Check one registered path and push a problem string if it is missing.
 *  Returns true when the caller should continue to header checks. */
function isFileOrReport(file: string, rel: string, problems: string[]): boolean {
  if (!isRegisteredPathAFile(file)) {
    problems.push(`${rel}: registered but the file does not exist (stale entry)`);
    return false;
  }
  return true;
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

/** Check every registered rel path: report any that are missing, then any
 *  whose header is not canonical. Exported so the stale-entry branch is
 *  testable with a synthetic registry that names a file that does not exist
 *  (the crash-in-the-wild shape #989 hit). */
export function checkRegistryEntries(registry: string[]): string[] {
  const problems: string[] = [];
  for (const rel of registry) {
    const file = join(JS_DIR, `${rel}.ts`);
    if (!isFileOrReport(file, rel, problems)) continue;
    for (const p of headerProblems(file, rel)) {
      problems.push(`${rel}: ${p}`);
    }
  }
  return problems;
}

describe("file headers follow the canonical form", () => {
  it("every registered file exists and carries the canonical header", () => {
    expect(checkRegistryEntries(readRegistry())).toEqual([]);
  });

  it("reports a stale registry entry by path + 'does not exist', not ENOENT", () => {
    // The regression: a registry entry whose file was deleted used to escape
    // as a raw statSync ENOENT stack. The guard must name the path and say
    // the file does not exist instead.
    const rel = "core/layer/filterOwnerGone";
    expect(checkRegistryEntries([rel])).toEqual([
      `${rel}: registered but the file does not exist (stale entry)`,
    ]);
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
      if (!isRegisteredPathAFile(join(JS_DIR, `${rel}.ts`))) missing.push(rel);
    }
    expect(missing).toEqual([]);
  });
});

// ── script/ tooling ─────────────────────────────────────────────────────────
//
// The repo-root tooling carries the same header, anchored at the repo root:
// line 1 (line 2 after a shebang) is `// script/<rel> — <desc>`, <rel> being
// the module path from the root with no .mjs extension. The tooling is the
// code with the fewest readers — a gate script has no imports to orient one —
// so this header is the only statement of what the file is FOR. No registry:
// every module under script/ is shipped tooling, so the whole directory is
// scanned. script/sonda is generated build output, not tooling, and is skipped.

const SCRIPT_DIR = resolve(REPO_ROOT, "script");

/** Sorted .mjs modules under script/, skipping generated report output. */
function scriptModules(dir = SCRIPT_DIR): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "sonda") files.push(...scriptModules(full));
    } else if (entry.name.endsWith(".mjs")) {
      files.push(full);
    }
  }
  return files.sort();
}

/** The problem with one script module's header, or null when it is canonical.
 *  Pure over the file text so the shebang and stale-path cases are testable. */
function scriptHeaderProblem(text: string, rel: string): string | null {
  const lines = text.split(/\r?\n/);
  const at = lines[0]?.startsWith("#!") ? 1 : 0;
  const expected = `// ${rel} — `;
  const line = lines[at] ?? "";
  if (!line.startsWith(expected)) {
    return `line ${at + 1} is not "// ${rel} — <desc>": ${JSON.stringify(line)}`;
  }
  if (line.slice(expected.length).trim().length === 0) {
    return `line ${at + 1} has no description after the em dash`;
  }
  return null;
}

describe("script/ headers follow the canonical form", () => {
  it("every script module carries the canonical header", () => {
    const problems: string[] = [];
    for (const file of scriptModules()) {
      const rel = relative(REPO_ROOT, file)
        .replaceAll("\\", "/")
        .replace(/\.mjs$/, "");
      const problem = scriptHeaderProblem(readFileSync(file, "utf8"), rel);
      if (problem) problems.push(`${rel}.mjs: ${problem}`);
    }
    expect(problems).toEqual([]);
  });

  it("scans a non-vacuous tree (the walk cannot silently empty)", () => {
    expect(scriptModules().length).toBeGreaterThanOrEqual(30);
  });

  it("rejects a missing header, a stale path, a code-first file and an empty description", () => {
    expect(
      scriptHeaderProblem(
        "#!/usr/bin/env node\n// script/check/x — does y\n",
        "script/check/x",
      ),
    ).toBeNull();
    expect(scriptHeaderProblem("const x = 1;\n", "script/check/x")).toMatch(
      /line 1 is not/,
    );
    expect(
      scriptHeaderProblem("#!/usr/bin/env node\nconst x = 1;\n", "script/check/x"),
    ).toMatch(/line 2 is not/);
    expect(
      scriptHeaderProblem("// script/check/old — does y\n", "script/check/x"),
    ).toMatch(/line 1 is not/);
    expect(scriptHeaderProblem("// script/check/x — \n", "script/check/x")).toMatch(
      /no description/,
    );
  });
});
