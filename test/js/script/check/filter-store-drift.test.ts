import { readFileSync, readdirSync, statSync } from "fs";
import { join, relative, resolve } from "path";
import { describe, expect, it } from "vitest";

// Filter-store drift guard: a surface's source name in the shared filterStore
// is a persistence key — the value is stored in the record and must never be
// spelled at the call site in a way that can drift from the constant. The
// well-known names live in FILTER_SOURCE (core/layer/filterStore.ts); a control
// with a fixed single surface (MeasureControl's type filter) references the
// constant, and a typo at a call site would silently create a second record
// entry or read an empty slot.
//
// Scope: MeasureControl (production + test) — the only control with a fixed
// single filter surface. HeatmapControl keys by a dynamic selected-layer id, so
// it has no fixed literal to pin. A control whose source name is a layer id in
// an event payload (LayerControl's mock `id: "measure"`) is NOT a filterStore
// source key and is outside this scope.
//
// The guard also pins the constant's value: FILTER_SOURCE.MEASURE must stay
// "measure" because that is the persisted record key — changing it would orphan
// every existing user's stored filter.
const REPO_ROOT = resolve(".");
const SOURCE_EXT = new Set([".ts", ".tsx"]);
const SKIP_DIR = new Set([
  "node_modules",
  "dist",
  ".venv",
  ".git",
  "coverage",
  ".agents",
]);
const VALUE = "measure";

function walk(dir: string, out: string[]): string[] {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIR.has(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      walk(p, out);
    } else {
      const dot = name.lastIndexOf(".");
      if (dot >= 0 && SOURCE_EXT.has(name.slice(dot))) out.push(p);
    }
  }
  return out;
}

describe("filter source keys use the FILTER_SOURCE constant", () => {
  it("keeps FILTER_SOURCE.MEASURE pinned to the persisted value", () => {
    const store = readFileSync(
      resolve(REPO_ROOT, "foliplus", "js", "core", "layer", "filterStore.ts"),
      "utf-8",
    );
    expect(store).toMatch(/MEASURE: "measure"/);
  });

  it("finds no bare source-key string in the MeasureControl surface", () => {
    const files = [
      ...walk(resolve(REPO_ROOT, "foliplus", "js", "control", "MeasureControl"), []),
      ...walk(resolve(REPO_ROOT, "test", "js", "control", "MeasureControl"), []),
    ];
    const hits: string[] = [];
    const needle = `"${VALUE}"`;
    for (const file of files) {
      const rel = relative(REPO_ROOT, file).replace(/\\/g, "/");
      const lines = readFileSync(file, "utf-8").split(/\r?\n/);
      lines.forEach((line, i) => {
        if (line.includes(needle)) {
          hits.push(
            `${rel}:${i + 1}: bare "${VALUE}" literal — use FILTER_SOURCE.MEASURE`,
          );
        }
      });
    }
    expect(hits).toEqual([]);
  });
});
