import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// Guard G1 / G3b of the filter-unify design (step 5).
//
// G1 - the LayerControl controller has a single source for the generic filter.
// The layerFilters mirror map is gone: every read goes to the shared per-map
// filter store, and the only per-layer read alias is the registry slot that the
// panel consumes. Grep the source for the mirror; a re-introduction trips the
// guard.
//
// G3b - a filter persistence goes through the shared filter store, never a
// direct storage call from a control. The controls that own filter surfaces
// (LayerControl generic, Measure, Heatmap) must not reach #platform/storage
// with a filter key. Heatmap own CONFIG persistence (CONST.STORAGE.KEY) is
// exempt - it is not filter data, it is the control own saved config.

const REPO_ROOT = resolve(".");
const read = (rel: string) => readFileSync(resolve(REPO_ROOT, rel), "utf8");

const CONTROLLER = "foliplus/js/control/LayerControl/controller.ts";
const MEASURE_MGR = "foliplus/js/control/MeasureControl/manager.ts";
const HEATMAP_MGR = "foliplus/js/control/HeatmapControl/manager.ts";

describe("generic filter single-source guard (G1)", () => {
  it("the controller no longer keeps a layerFilters mirror map", () => {
    const src = read(CONTROLLER);
    expect(src).not.toMatch(/layerFilters\b/);
    // The store is the read source; the registry slot is the only alias.
    expect(src).toMatch(/filterStore\.getFilter\(id, FILTER_SOURCE\.GENERIC\)/);
    expect(src).toMatch(/filterStore\.drop\(id, FILTER_SOURCE\.GENERIC\)/);
  });

  it("reintroducing the mirror trips the guard (counterexample)", () => {
    const src = read(CONTROLLER);
    expect(src).not.toMatch(/layerFilters\s*=\s*new Map/);
  });
});

describe("filter persistence only through the shared store (G3b)", () => {
  const filterFiles = [CONTROLLER, MEASURE_MGR, HEATMAP_MGR];

  it.each(filterFiles)("no direct storage write of a filter key in %s", (file) => {
    const src = read(file);
    const filterKeyCall = /(saveRecord|loadRecord|removeRecord)\s*\([^)]*filter/i;
    expect(src).not.toMatch(filterKeyCall);
  });

  it("Heatmap own config persistence stays allowed (exempt, not a filter key)", () => {
    const src = read(HEATMAP_MGR);
    expect(src).toMatch(/createPersisted|saveRecord/);
  });
});
