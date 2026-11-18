// test/js/script/check/mock-specifier — every vi.mock / vi.doMock /
// vi.importActual / vi.unmock specifier in test/js/**/*.ts must resolve
// to a real file. A misspelled specifier silently no-ops: vitest does not
// error on an unresolvable mock target, so the test reads the real module
// and the mock is dead code (#1209: bundle-fuse.test.ts wrote
// "#script/bundle-size-lib.mjs" instead of
// "#script/build/bundle-size-lib.mjs" — one missing path segment made the
// mock a no-op, local minified dist was under cap (false green), CI dev
// dist was over cap (red). This guard makes the mismatch visible.
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const REPO_ROOT = resolve(".");
const TEST_ROOT = resolve(REPO_ROOT, "test/js");

/** package.json "imports" aliases, hardcoded from the repo's package.json.
 *  Keys are the alias prefix (up to the first *); values are the resolved
 *  directory prefix. A specifier starting with a key has the prefix replaced
 *  and the rest appended. */
const ALIASES: readonly { prefix: string; dir: string }[] = [
  { prefix: "#platform/", dir: "foliplus/js/platform/" },
  { prefix: "#core/", dir: "foliplus/js/core/" },
  { prefix: "#ui/", dir: "foliplus/js/ui/" },
  { prefix: "#control/", dir: "foliplus/js/control/" },
  { prefix: "#foliplus/", dir: "foliplus/js/" },
  { prefix: "#script/", dir: "script/" },
];

/** The vi.* mock function names whose first string argument is a module
 *  specifier that must resolve. */
const MOCK_FNS = [
  "vi.mock",
  "vi.doMock",
  "vi.importActual",
  "vi.importMock",
  "vi.unmock",
];

/** Extract the first string-literal argument from a vi.mock* call at the
 *  given line. Returns null if no string literal is found (e.g. the
 *  specifier is computed at runtime). */
function extractSpecifier(line: string): string | null {
  for (const fn of MOCK_FNS) {
    const idx = line.indexOf(fn);
    if (idx === -1) continue;
    // Find the first quote after the function name.
    const rest = line.slice(idx + fn.length);
    const match = rest.match(/^\s*\(?\s*["']([^"']+)["']/);
    if (match) return match[1];
  }
  return null;
}

/** Resolve a specifier to an absolute path. Returns null for bare package
 *  names (npm packages — not resolvable without import). */
function resolveSpecifier(specifier: string, fromFile: string): string | null {
  // Alias specifier: #xxx/yyy → map through ALIASES.
  if (specifier.startsWith("#")) {
    for (const { prefix, dir } of ALIASES) {
      if (specifier.startsWith(prefix)) {
        const rest = specifier.slice(prefix.length);
        return resolve(REPO_ROOT, dir, rest);
      }
    }
    // Unknown # alias.
    return resolve(REPO_ROOT, specifier);
  }
  // Relative specifier: ./xxx or ../xxx.
  if (specifier.startsWith(".") || specifier.startsWith("/")) {
    return resolve(dirname(fromFile), specifier);
  }
  // Bare package name: not resolvable statically.
  return null;
}

/** Walk test/js/ recursively, return all .ts files. */
function walk(dir: string, out: string[]): string[] {
  for (const name of require("node:fs").readdirSync(dir)) {
    if (name === "node_modules" || name === "dist") continue;
    const p = resolve(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (name.endsWith(".ts")) out.push(p);
  }
  return out;
}

describe("mock-specifier guard: vi.mock specifiers must resolve", () => {
  const files = walk(TEST_ROOT, []);

  it("every vi.mock/vi.doMock specifier resolves to a real file", () => {
    const violations: string[] = [];
    for (const file of files) {
      const lines = readFileSync(file, "utf-8").split(/\r?\n/);
      for (let i = 0; i < lines.length; i++) {
        const spec = extractSpecifier(lines[i]);
        if (!spec) continue;
        const abs = resolveSpecifier(spec, file);
        if (!abs) continue; // bare package — skip
        // Try with and without .ts/.mjs extension (vitest resolves both).
        const candidates = [abs, abs + ".ts", abs + ".mjs", abs + ".js"];
        const found = candidates.some(c => existsSync(c));
        if (!found) {
          const rel = relative(REPO_ROOT, file);
          violations.push(`${rel}:${i + 1} — "${spec}" → ${abs} (not found)`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it("mutation check: a wrong #script specifier would be caught", () => {
    // Self-test: the wrong specifier from #1209 must fail resolution.
    const wrong = "#script/bundle-size-lib.mjs";
    const right = "#script/build/bundle-size-lib.mjs";
    const wrongAbs = resolveSpecifier(wrong, resolve(TEST_ROOT, "x.ts"));
    const rightAbs = resolveSpecifier(right, resolve(TEST_ROOT, "x.ts"));
    expect(wrongAbs).not.toBeNull();
    expect(existsSync(wrongAbs!)).toBe(false);
    expect(existsSync(rightAbs!)).toBe(true);
  });
});
