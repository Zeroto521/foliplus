import { readFileSync } from "fs";
import { resolve } from "path";
import { globSync } from "tinyglobby";
import { describe, expect, it } from "vitest";

// Every alias foliplus sources may import from, mapped to the directory it
// resolves into. `#foliplus/` sits at the JS root, so it is included for the
// resolution guard even though it has no shared-library counterpart.
const ALIASES = new Map([
  ["#core/", resolve(process.cwd(), "foliplus/js/core")],
  ["#common/", resolve(process.cwd(), "foliplus/js/common")],
  ["#foliplus/", resolve(process.cwd(), "foliplus/js")],
]);

// All `.ts` sources under foliplus/js, flat.
const tsSources = () =>
  globSync({ cwd: resolve(process.cwd()), patterns: ["foliplus/js/**/*.ts"] });

// `from "…"` specifiers across the sources, keyed by specifier. A directory
// barrel (`#core/index.js`, `#common/index.js`) is only an entry point when
// the bundler points at it, and nothing bundles them.
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

describe("shared-library imports", () => {
  it("every imported specifier resolves to an existing source file", () => {
    // A specifier pointing at a module that is already gone is the class of
    // bug the deleted `core/index.ts` barrel had: it re-exported names through
    // a path nothing followed, so the break was invisible until something
    // finally did.
    const missing: Array<[string, string[]]> = [];
    for (const [spec, files] of aliasedSpecifiers().entries()) {
      const root = ALIASES.get(spec.slice(0, spec.indexOf("/") + 2))!;
      const rel = spec.slice(spec.indexOf("/") + 1, -".js".length) + ".ts";
      if (!globSync({ cwd: root, patterns: [rel] }).length) {
        missing.push([spec, files]);
      }
    }
    expect(missing).toEqual([]);
  });

  it("no source imports a core or common directory barrel", () => {
    const domainBarrels = [...aliasedSpecifiers().entries()].filter(([spec]) =>
      /#(core|common)\/index\.js$/.test(spec),
    );
    expect(domainBarrels).toEqual([]);
  });

  it("core has no domain barrel", () => {
    const jsDir = resolve(process.cwd(), "foliplus/js");
    // `script/build.mjs` skips `entry.name === "core"` when discovering
    // components, so `core/index.ts` was never an entry point; a file added
    // here would be an import nobody resolves.
    expect(globSync({ cwd: jsDir, patterns: ["core/index.ts"] })).toEqual([]);
    // Subdomain barrels are load-bearing and must stay.
    for (const sub of ["geo", "geocode", "layer", "event"]) {
      expect(globSync({ cwd: jsDir, patterns: [`core/${sub}/index.ts`] })).toEqual([
        `core/${sub}/index.ts`,
      ]);
    }
  });
});
