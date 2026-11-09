import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { findBareFilterSourceKeys } from "#script/check/filter-source-key.mjs";

// FILTER_SOURCE key drift guard: a surface's source name in the shared
// filterStore is a persistence key — the value is stored in the record and
// must never be spelled at the call site in a way that can drift from the
// constant. The well-known names live in FILTER_SOURCE (core/layer/filterStore.ts);
// a control with a fixed single surface (MeasureControl's type filter)
// references the constant, and a typo at a call site would silently create a
// second record entry or read an empty slot.
//
// Scope: MeasureControl (production + test) — the only control with a fixed
// single filter surface. HeatmapControl keys by a dynamic selected-layer id,
// so it has no fixed literal to pin. A control whose source name is a layer id
// in an event payload (LayerControl's mock `id: "measure"`) is NOT a
// filterStore source key and is outside this scope.
//
// The guard also pins the constant's value: FILTER_SOURCE.MEASURE must stay
// "measure" because that is the persisted record key — changing it would orphan
// every existing user's stored filter.

const REPO_ROOT = process.cwd();

describe("filter source keys use the FILTER_SOURCE constant", () => {
  it("keeps FILTER_SOURCE.MEASURE pinned to the persisted value", () => {
    const store = readFileSync(
      resolve(REPO_ROOT, "foliplus", "js", "core", "layer", "filterStore.ts"),
      "utf-8",
    );
    expect(store).toMatch(/MEASURE: "measure"/);
  });

  it("finds no bare source-key string in the MeasureControl surface", () => {
    const hits = findBareFilterSourceKeys(REPO_ROOT);
    expect(hits).toEqual([]);
  });

  it("flags a synthetic bare literal", () => {
    // A synthetic root with a bare literal must be flagged.
    const dir = mkdtempSync(join(tmpdir(), "filter-source-key-"));
    mkdirSync(join(dir, "foliplus", "js", "control", "MeasureControl"), {
      recursive: true,
    });
    writeFileSync(
      join(dir, "foliplus", "js", "control", "MeasureControl", "bad.ts"),
      'const x = "measure";\n',
    );
    const hits = findBareFilterSourceKeys(dir);
    rmSync(dir, { recursive: true, force: true });
    expect(hits.length).toBe(1);
    expect(hits[0].line).toBe(1);
    expect(hits[0].text).toContain("measure");
  });
});
