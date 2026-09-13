import { readFileSync, readdirSync } from "fs";
import { resolve } from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";

// Repo-wide regression guard: production sources carry no type-system bypasses.
//
// No single file owns this property — it is measured over all of foliplus/js
// — so unlike the rest of the suite this test is not named after a script it
// tests. `type-safety` is the property and `guard` is its kind. The repo-wide
// convention is test/js/<name>.test.ts testing foliplus/js/<name>.ts, which this
// file deliberately breaks.
//
// These are not lint duplicates — eslint's ban-ts-comment only flags the
// // @ts-*** lines (and only ones it can classify), and no rule checks for
// `as any`. Without this the audit finding "24 bypasses" could come back
// silently.
//
// Three `as unknown as` sites are intentionally allowed and pinned by name so
// the number stays meaningful rather than trending toward zero.

const ROOT = resolve(fileURLToPath(import.meta.url), "../../..");
const SRC = resolve(ROOT, "foliplus/js");

const walk = (dir: string): string[] => {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = resolve(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walk(full));
    } else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".d.ts")) {
      out.push(full);
    }
  }
  return out;
};

const files = walk(SRC);
const read = (p: string) => readFileSync(p, "utf-8");
const rel = (p: string) => p.slice(ROOT.length + 1).replace(/\\/g, "/");

const BANNED: Array<{ name: string; re: RegExp }> = [
  { name: "`as any`", re: /\bas\s+any\b/g },
  { name: "`@ts-ignore`", re: /@ts-ignore/g },
  { name: "`@ts-expect-error`", re: /@ts-expect-error/g },
  { name: "`@ts-nocheck`", re: /@ts-nocheck/g },
];

describe("production type-system bypasses", () => {
  it("scans a non-trivial production tree", () => {
    expect(files.length).toBeGreaterThanOrEqual(80);
  });

  for (const { name, re } of BANNED) {
    it(`contains no ${name}`, () => {
      const hits = files
        .map(f => ({ f, n: (read(f).match(re) || []).length }))
        .filter(x => x.n > 0);
      expect(hits, hits.map(h => `${rel(h.f)}: ${h.n}`).join("\n")).toEqual([]);
    });
  }

  it("pins the three deliberate `as unknown as` sites", () => {
    const sites = files
      .filter(f => read(f).includes("as unknown as"))
      .map(rel)
      .sort();
    expect(sites).toEqual([
      "foliplus/js/core/layer/api.ts",
      "foliplus/js/core/layer/util.ts",
      "foliplus/js/core/mapApi.ts",
    ]);
  });

  it("mapApi.ts is the only place a map.foliplus seed is written", () => {
    const writers = files
      .map(f => ({ f: rel(f), n: (read(f).match(/map\.foliplus\s*=/g) || []).length }))
      .filter(x => x.n > 0);
    expect(writers).toEqual([{ f: "foliplus/js/core/mapApi.ts", n: 1 }]);
  });
});
