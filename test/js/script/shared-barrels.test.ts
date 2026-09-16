/**
 * Shared-library barrels: a dead-code guard.
 *
 * `core/index.ts` was a 63-line re-export barrel that no source imported, and the
 * shared-registry scan (`script/scan-registry.mjs`) never registers it either —
 * `coreSubs` and `coreSingleFiles` both exclude `index.ts`, so the registry can
 * only ever expose `core/<sub>` or `core/<file>`. An export added to that barrel
 * had no runtime effect. It is deleted; this test makes the deletion checkable
 * rather than remembered.
 *
 * Two questions, both re-derived from the source tree:
 *   - is any `#core` / `#common` barrel imported anywhere in production sources?
 *     (a directory barrel is only an entry point when the bundler points at it)
 *   - does every shared-library barrel that is imported still exist, and is
 *     `core/index.ts` gone?
 */
import { readFileSync } from "fs";
import { dirname, resolve } from "path";
import { globSync } from "tinyglobby";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const JS_DIR = resolve(ROOT, "foliplus", "js");

// Specifier → path, for the two shared-library aliases only.
const ALIASES = new Map([
  ["#core/", resolve(JS_DIR, "core")],
  ["#common/", resolve(JS_DIR, "common")],
]);

const tsSources = () => globSync({ cwd: ROOT, patterns: ["foliplus/js/**/*.ts"] });

const aliasedSpecifiers = (files: string[]): Map<string, string[]> => {
  const seen = new Map<string, string[]>();
  for (const file of files) {
    const text = readFileSync(resolve(ROOT, file), "utf8");
    for (const match of text.matchAll(/from\s+["']([^"']+)["']/g)) {
      const spec = match[1];
      for (const [alias, root] of ALIASES) {
        if (spec.startsWith(alias)) {
          seen.set(spec, [...(seen.get(spec) ?? []), file]);
          break;
        }
      }
    }
  }
  return seen;
};

describe("shared-library barrel imports", () => {
  it("no production source imports a core or common directory barrel", () => {
    const specifiers = aliasedSpecifiers(tsSources());
    const barrels = [...specifiers.entries()]
      .filter(([, files]) => files.length > 0)
      .filter(([spec]) => /\/index\.js$/.test(spec));

    // The four subdomain barrels (geo, geocode, layer, event) are the
    // intended shape: the registry generates an import for each of them from
    // `#core/<sub>/index.js`. A *domain* barrel (`#core/index.js`,
    // `#common/index.js`) is what the deletion removed, and neither is bundled.
    const barrelSpecifiers = barrels.filter(([spec]) =>
      /#(core|common)\/index\.js$/.test(spec),
    );
    expect(barrelSpecifiers).toEqual([]);
  });

  it("every imported shared-library specifier resolves to an existing file", () => {
    const missing: Array<[string, string[]]> = [];
    for (const [spec, files] of aliasedSpecifiers(tsSources()).entries()) {
      const [, root] = [...ALIASES].find(([alias]) => spec.startsWith(alias))!;
      const rel = spec.slice(spec.indexOf("/") + 1, -".js".length) + ".ts";
      if (!globSync({ cwd: root, patterns: [rel] }).length) {
        missing.push([spec, files]);
      }
    }
    // This is the class of bug the deleted barrel had: an import — or a
    // re-export out of one — pointing at a module that is already gone.
    expect(missing).toEqual([]);
  });

  it("core/index.ts is not part of the shared-library surface", () => {
    expect(globSync({ cwd: JS_DIR, patterns: ["core/index.ts"] })).toEqual([]);
    // Subdomain barrels are load-bearing and must stay.
    for (const sub of ["geo", "geocode", "layer", "event"]) {
      expect(globSync({ cwd: JS_DIR, patterns: [`core/${sub}/index.ts`] })).toEqual([
        `core/${sub}/index.ts`,
      ]);
    }
  });
});
