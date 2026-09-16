import { existsSync, readFileSync, readdirSync } from "fs";
import { join, resolve } from "path";
import { describe, expect, it } from "vitest";

// Resolved against cwd, the same repo root every build script assumes.
const ROOT = resolve(".");
const JS_DIR = resolve(ROOT, "foliplus/js");

// Every import alias declared in `package.json` `imports`, resolved the way the
// bundler resolves it: `#core/foo.js` lands at `foliplus/js/core/foo.ts`.
const ALIASES = new Map([
  ["#core/", resolve(JS_DIR, "core")],
  ["#common/", resolve(JS_DIR, "common")],
  ["#foliplus/", JS_DIR],
]);

// All `.ts` sources under foliplus/js, flat.
const tsSources = (): string[] => {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".ts")) out.push(full);
    }
  };
  walk(JS_DIR);
  return out;
};

// `from "…"` specifiers across the sources, keyed by specifier.
const aliasedSpecifiers = (): Map<string, string[]> => {
  const seen = new Map<string, string[]>();
  for (const file of tsSources()) {
    for (const match of readFileSync(file, "utf8").matchAll(
      /from\s+["']([^"']+)["']/g,
    )) {
      const spec = match[1];
      if (![...ALIASES].some(([alias]) => spec.startsWith(alias))) continue;
      seen.set(spec, [...(seen.get(spec) ?? []), file]);
    }
  }
  return seen;
};

// The `.ts` source a specifier points at, or null when the file is gone.
const resolveSpecifier = (spec: string): string | null => {
  const alias = [...ALIASES].find(([a]) => spec.startsWith(a))![0];
  const root = ALIASES.get(alias)!;
  const rel = spec
    .slice(alias.length)
    .replace(/^foliplus\//, "")
    .replace(/\.js$/, ".ts");
  return existsSync(resolve(root, rel)) ? rel : null;
};

describe("shared-library imports", () => {
  it("every imported specifier resolves to an existing source file", () => {
    // A specifier pointing at a module that is already gone is the class of bug
    // the deleted `core/index.ts` barrel had: it re-exported names through a
    // path nothing followed, so the break stayed invisible until something
    // finally did.
    const missing: Array<[string, string[]]> = [];
    for (const [spec, files] of aliasedSpecifiers().entries()) {
      if (resolveSpecifier(spec) === null) missing.push([spec, files]);
    }
    expect(missing).toEqual([]);
  });

  it("no source imports a core or common directory barrel", () => {
    // A directory barrel (`#core/index.js`) is an entry point only when the
    // bundler points at it, and nothing bundles one — `script/build.mjs`
    // skips `core` entirely, so no `foliplus-core` artifact is emitted.
    const domainBarrels = [...aliasedSpecifiers().entries()].filter(([spec]) =>
      /#(core|common)\/index\.js$/.test(spec),
    );
    expect(domainBarrels).toEqual([]);
  });

  it("core has no domain barrel", () => {
    // `script/build.mjs` skips `entry.name === "core"` when discovering
    // components, so `core/index.ts` was never an entry point; a file added
    // here would be an import nobody resolves.
    expect(existsSync(resolve(JS_DIR, "core/index.ts"))).toBe(false);
    // Subdomain barrels are load-bearing and must stay.
    for (const sub of ["geo", "geocode", "layer", "event"]) {
      expect(existsSync(resolve(JS_DIR, `core/${sub}/index.ts`))).toBe(true);
    }
  });
});
