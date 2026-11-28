import { readFileSync, readdirSync, statSync } from "fs";
import { join, relative, resolve } from "path";
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
// fails when one is forgotten. core/ is fully registered and mandatory too: its
// headers used to be registry-optional, so ten of them named a path that does
// not exist ("core/<Name>", "core/events/<Name>") and stayed invisible until the
// whole tree was registered. control/ modules get a header-presence assertion
// across the whole tier and the canonical path form when registered (the tier
// is still converging to the canonical shape).
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

/** One file's canonical-header problem, judged from the text alone.
 *
 *  This used to also parse the module with `ts.createSourceFile` to prove the
 *  header was the *leading comment* of the first statement. That was redundant:
 *  once line 1 must literally be `// <rel> — <desc>`, it cannot be anything but
 *  the leading comment (there is no line above it), and a module whose first
 *  line is code or blank already fails the same assertion. The parse cost an
 *  AST per registered module — the load-sensitive 10 s timeout this guard kept
 *  hitting under coverage — so it is gone; the "header pushed to line 2" case
 *  is pinned in the tests below. */
function headerProblem(text: string, rel: string): string | null {
  const first = text.split(/\r?\n/, 1)[0] ?? "";
  const escaped = rel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`^// ${escaped} — .+`);
  if (pattern.test(first)) return null;
  return `first line is not "// ${rel} — <desc>": ${JSON.stringify(first)}`;
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
    const problem = headerProblem(readFileSync(file, "utf8"), rel);
    if (problem) problems.push(`${rel}: ${problem}`);
  }
  return problems;
}

describe("file headers follow the canonical form", () => {
  it("every registered file exists and carries the canonical header", () => {
    expect(checkRegistryEntries(readRegistry())).toEqual([]);
  });

  it("rejects a header that is not on the first line", () => {
    const rel = "platform/color";
    expect(headerProblem("// platform/color — colors.\n", rel)).toBeNull();
    // The removed AST branch proved "leading comment"; the first-line rule
    // alone already catches everything that branch was protecting against: a
    // blank line, an import, or a shebang pushes the header down and the first
    // line no longer matches. These are the cases that branch existed for.
    expect(headerProblem("\n// platform/color — colors.\n", rel)).toMatch(
      /first line is not/,
    );
    expect(
      headerProblem('import x from "y";\n// platform/color — colors.\n', rel),
    ).toMatch(/first line is not/);
    expect(headerProblem("#!/usr/bin/env node\n// platform/color — c.\n", rel)).toMatch(
      /first line is not/,
    );
    expect(headerProblem("// platform/color — \n", rel)).toMatch(/first line is not/);
    expect(headerProblem("// platform/other — colors.\n", rel)).toMatch(
      /first line is not/,
    );
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

  it("core/ non-barrel files are all registered", () => {
    // Added with the core/ registration pass. Before it, core/ headers were
    // registry-optional, so LayerInfoRegistry / PaneLedger / PaneManager /
    // SurfaceIndex (and ten more) could claim a path that does not exist while
    // this guard stayed green. Registering the whole tree makes that drift red.
    const registry = new Set(readRegistry());
    const missing: string[] = [];
    const walkModules = (dir: string, prefix: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) {
          walkModules(join(dir, entry.name), `${prefix}${entry.name}/`);
          continue;
        }
        if (!entry.name.endsWith(".ts") || entry.name === "index.ts") continue;
        const rel = `${prefix}${entry.name.replace(/\.ts$/, "")}`;
        if (!registry.has(rel)) missing.push(rel);
      }
    };
    walkModules(join(JS_DIR, "core"), "core/");
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

// ── control/ module headers ─────────────────────────────────────────────────
//
// control/ is the last tier without exact-path enforcement. Its modules already
// carry descriptive headers in a local house style ("// LayerControl UI — ..."),
// so the canonical path form is checked for the files the registry lists, and a
// module is registered as it is converged. What is enforced for the whole tier
// is header PRESENCE: every non-barrel module opens with a "// ..." comment, so
// a new control module cannot arrive as a bare import block with nothing to
// orient a reader.
//
// FOREIGN_HEADER_OWNERS is a burn-down list, not an allow-list: that module is
// being rewritten by the LayerControl order work (#1402), which owns its header.
// The stale-entry assertion below fails as soon as it gains a header, so the
// entry must be deleted in the PR that fixes it.

const CONTROL_DIR = resolve(JS_DIR, "control");

/** Module whose header is owned by another in-flight change (#1402). */
const FOREIGN_HEADER_OWNERS: Record<string, string> = {
  "control/LayerControl/controller": "#1402 (LayerControl order work)",
};

/** Every non-barrel module under control/, as control/-prefixed rel paths. */
function controlModules(): string[] {
  const found: string[] = [];
  const walk = (dir: string, prefix: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        walk(join(dir, entry.name), `${prefix}${entry.name}/`);
        continue;
      }
      if (!entry.name.endsWith(".ts") || entry.name === "index.ts") continue;
      found.push(prefix + entry.name.replace(/\.ts$/, ""));
    }
  };
  walk(CONTROL_DIR, "control/");
  return found.sort();
}

/** The header-presence problem with one module's text, or null. Pure over the
 *  text so the code-first / empty / rule-line cases stay testable. */
function controlHeaderProblem(text: string): string | null {
  const first = (text.split(/\r?\n/)[0] ?? "").trimEnd();
  if (!first.startsWith("//")) {
    return `first line is not a header comment: ${JSON.stringify(first)}`;
  }
  const body = first.slice(2).trim();
  if (body.length === 0) return "header comment is empty";
  if (/^[=\-*#_]{4,}$/.test(body)) {
    return `first line is a rule, not a header: ${JSON.stringify(first)}`;
  }
  return null;
}

describe("control/ module headers", () => {
  it("every non-barrel control module opens with a header comment", () => {
    const problems: string[] = [];
    for (const rel of controlModules()) {
      if (rel in FOREIGN_HEADER_OWNERS) continue;
      const text = readFileSync(join(JS_DIR, `${rel}.ts`), "utf8");
      const problem = controlHeaderProblem(text);
      if (problem) problems.push(`${rel}: ${problem}`);
    }
    expect(problems).toEqual([]);
  });

  it("scans a non-vacuous tree (the walk cannot silently empty)", () => {
    expect(controlModules().length).toBeGreaterThanOrEqual(100);
  });

  it("the foreign-owned list only names modules that still lack a header", () => {
    const stale: string[] = [];
    for (const rel of Object.keys(FOREIGN_HEADER_OWNERS)) {
      const file = join(JS_DIR, `${rel}.ts`);
      if (!isRegisteredPathAFile(file)) {
        stale.push(`${rel}: no such module (stale entry)`);
        continue;
      }
      if (controlHeaderProblem(readFileSync(file, "utf8")) === null) {
        stale.push(`${rel}: now carries a header — drop it from FOREIGN_HEADER_OWNERS`);
      }
    }
    expect(stale).toEqual([]);
  });

  it("rejects a code-first module, an empty comment and a rule-line banner", () => {
    expect(
      controlHeaderProblem("// control/LayerControl/ui — class shell.\n"),
    ).toBeNull();
    expect(controlHeaderProblem('import * as CONST from "./const.js";\n')).toMatch(
      /not a header comment/,
    );
    expect(controlHeaderProblem("//\n")).toMatch(/header comment is empty/);
    expect(controlHeaderProblem("// ============\n")).toMatch(/a rule, not a header/);
  });
});
