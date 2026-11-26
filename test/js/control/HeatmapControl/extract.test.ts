// Unit tests for HeatmapControl/extract — the extract mixin methods.
import {
  loadGeometry,
  makeManager,
} from "./fixture.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as CONST from "#control/HeatmapControl/const.js";

afterEach(() => {
  delete globalThis.h3;
  delete globalThis.chroma;
});

describe("getPointValue", () => {
  let m: any;

  beforeEach(() => {
    m = makeManager();
  });

  it("returns 1 when agg is COUNT", () => {
    m.agg = CONST.AGG.COUNT;
    expect(m.getPointValue({})).toBe(1);
  });

  it("returns 1 as fallback for missing field", () => {
    m.agg = CONST.AGG.SUM;
    m.field = "nonexistent";
    expect(m.getPointValue({})).toBe(1);
  });
});

describe("getPointValue — additional gaps", () => {
  it("falls back to 1 when field is empty", () => {
    const m = makeManager();
    m.agg = CONST.AGG.SUM;
    m.field = "";
    expect(m.getPointValue({ value: 42 })).toBe(1);
  });

  it("uses field when it is set", () => {
    const m = makeManager();
    m.agg = CONST.AGG.SUM;
    m.field = "options.value";
    expect(m.getPointValue({ options: { value: 99 } })).toBe(99);
  });

  it("warns on value fallback (once per render)", () => {
    const m = makeManager();
    m.agg = CONST.AGG.SUM;
    m.field = "bad_field";
    m.valueFallbackWarned = false;
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(m.getPointValue({})).toBe(1);
    expect(m.valueFallbackWarned).toBe(true);
    expect(m.getPointValue({})).toBe(1); // no additional warn
    warnSpy.mockRestore();
  });
});

describe("scanMapLayers", () => {
  it("extracts point layers from LayerAPI", () => {
    const m = makeManager();
    const info = { id: "layer1", name: "Points", layer: {} };
    window.map.foliplus.LayerAPI.getLayersByType = vi.fn(() => [info]);
    window.map.foliplus.LayerAPI.extractPoints = vi.fn(() => [
      { id: "p1", marker: { feature: { properties: { price: 1 } } } },
    ]);
    m.scanMapLayers();
    expect(m.pointLayers).toHaveLength(1);
    expect(m.pointLayers[0].id).toBe("layer1");
  });

  it("deduplicates point layers by id", () => {
    const m = makeManager();
    window.map.foliplus.LayerAPI.getLayersByType = vi.fn(() => [
      { id: "dup", name: "A", layer: {} },
      { id: "dup", name: "B", layer: {} },
    ]);
    window.map.foliplus.LayerAPI.extractPoints = vi.fn(() => [{ marker: {} }]);
    m.scanMapLayers();
    expect(m.pointLayers).toHaveLength(1);
  });

  it("skips layers with no extractable points", () => {
    const m = makeManager();
    window.map.foliplus.LayerAPI.getLayersByType = vi.fn(() => [
      { id: "empty", name: "Empty", layer: {} },
    ]);
    window.map.foliplus.LayerAPI.extractPoints = vi.fn(() => []);
    m.scanMapLayers();
    expect(m.pointLayers).toHaveLength(0);
  });
});

describe("getSelectedPoints", () => {
  it("returns cached points when key matches", () => {
    const m = makeManager();
    m.selectedLayerId = "layer1";
    m.cachedPoints = { key: "layer1|count|", pts: [{ lat: 1 }] } as any;
    const pts = m.getSelectedPoints();
    expect(pts).toHaveLength(1);
  });

  it("returns empty when no layer selected", () => {
    const m = makeManager();
    m.selectedLayerId = null;
    expect(m.getSelectedPoints()).toEqual([]);
  });

  it("returns empty when layer not found in pointLayers", () => {
    const m = makeManager();
    m.selectedLayerId = "missing";
    m.pointLayers = [{ id: "other", name: "O", layer: {}, count: 1 }];
    expect(m.getSelectedPoints()).toEqual([]);
  });

  it("extracts points from LayerAPI and caches them", () => {
    const m = makeManager();
    m.selectedLayerId = "layer1";
    m.pointLayers = [{ id: "layer1", name: "P", layer: {}, count: 2 }];
    m.agg = CONST.AGG.COUNT;
    window.map.foliplus.LayerAPI.extractPoints = vi.fn(() => [
      { lat: 1, lng: 2, marker: {} },
      { lat: 3, lng: 4, marker: {} },
    ]);
    const pts = m.getSelectedPoints();
    expect(pts).toHaveLength(2);
    expect(m.cachedPoints).toBeDefined();
    expect(m.cachedPoints!.key).toContain("layer1");
  });
});

describe("computeBounds", () => {
  beforeEach(() => {
    window.L.latLngBounds = vi.fn(() => ({
      getNorth: () => 0,
      getSouth: () => 0,
      getEast: () => 0,
      getWest: () => 0,
      isValid: () => true,
      contains: () => true,
      getCenter: () => ({ lat: 0, lng: 0 }),
      extend: vi.fn(),
    }));
  });
  it("uses the pointLayers bounds when cachedFeatures is null", () => {
    const m = makeManager();
    m.cachedFeatures = null;
    m.pointLayers = [
      {
        id: "p1",
        name: "P1",
        layer: {
          getBounds: vi.fn(() => ({
            isValid: () => true,
            extend: vi.fn(),
          })),
        } as never,
        count: 1,
      },
    ];
    const bounds = m.computeBounds();
    expect(bounds).not.toBeNull();
  });

  it("uses the ring coordinates when a feature has a ring", () => {
    const m = makeManager();
    m.cachedFeatures = [
      {
        properties: { centroid: [0, 0] },
        geometry: loadGeometry("common", "polygon_unit_square_1"),
      },
    ] as never;
    const bounds = m.computeBounds();
    expect(bounds).not.toBeNull();
  });

  it("falls back to centroid when a feature has no ring", () => {
    const m = makeManager();
    m.cachedFeatures = [
      {
        properties: { centroid: [0, 0] },
        geometry: { coordinates: [] },
      },
    ] as never;
    const bounds = m.computeBounds();
    expect(bounds).not.toBeNull();
  });

  it("skips a feature with no centroid and no ring", () => {
    const m = makeManager();
    m.cachedFeatures = [
      {
        properties: { centroid: null },
        geometry: { coordinates: [] },
      },
    ] as never;
    m.computeBounds();
  });

  it("skips a pointLayer without getBounds", () => {
    const m = makeManager();
    m.cachedFeatures = null;
    m.pointLayers = [
      {
        id: "p1",
        name: "P1",
        layer: {} as never,
        count: 1,
      },
    ];
    m.computeBounds();
  });

  it("skips a pointLayer whose bounds are invalid", () => {
    const m = makeManager();
    m.cachedFeatures = null;
    m.pointLayers = [
      {
        id: "p1",
        name: "P1",
        layer: {
          getBounds: vi.fn(() => ({
            isValid: () => false,
            extend: vi.fn(),
          })),
        } as never,
        count: 1,
      },
    ];
    m.computeBounds();
  });

  it("returns null when the accumulated bounds are invalid", () => {
    const m = makeManager();
    window.L.latLngBounds = vi.fn(() => ({
      getNorth: () => 0,
      getSouth: () => 0,
      getEast: () => 0,
      getWest: () => 0,
      isValid: () => false,
      contains: () => true,
      getCenter: () => ({ lat: 0, lng: 0 }),
      extend: vi.fn(),
    }));
    m.cachedFeatures = null;
    m.pointLayers = [];
    expect(m.computeBounds()).toBeNull();
  });
});

describe("getBounds callback", () => {
  it("returns computeBounds result via createCanvas options", () => {
    makeManager();
    const opts = window.map.foliplus.LayerAPI.createCanvas.mock.calls[0][0] as {
      getBounds: () => unknown;
    };
    const result = opts.getBounds();
    expect(result).toBeNull();
  });
});

describe("declared starting layer/field (Python layer=/field=)", () => {
  type WarnSpyable = { log: { warn: (...args: unknown[]) => void } };
  const spyWarn = (m: unknown) =>
    vi.spyOn((m as WarnSpyable).log, "warn").mockImplementation(() => {});

  it("resolves the declared layer name against the scanned point layers", () => {
    const m = makeManager({ layer: "Facility Points" });
    m.pointLayers = [{ id: "p1", name: "Facility Points", layer: null, count: 1 }];
    expect(m.resolveDeclaredLayer()).toBe("p1");
  });

  it("ignores the declaration once a persisted record consumed the guard", () => {
    const m = makeManager({ layer: "Facility Points" });
    m.pointLayers = [{ id: "p1", name: "Facility Points", layer: null, count: 1 }];
    // applySavedConfig sets this for ANY stored record — including one where
    // the user explicitly cleared the selection.
    m.hasScanned = true;
    expect(m.resolveDeclaredLayer()).toBeNull();
  });

  it("warns once when the declared layer is not a point layer", () => {
    const m = makeManager({ layer: "Missing" });
    const warn = spyWarn(m);
    m.pointLayers = [{ id: "p1", name: "Other", layer: null, count: 1 }];
    expect(m.resolveDeclaredLayer()).toBeNull();
    expect(m.resolveDeclaredLayer()).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain("declared layer not found");
  });

  it("resolves the declared field only when the layer offers it", () => {
    const m = makeManager({ field: "score" });
    expect(m.setAvailableFields(["count", "score"])).toBe("score");
    // Not offered: the declaration is not re-pointed at another column - the
    // first numeric field is only the display fallback, and the declaration
    // never lands in the user's field.
    expect(m.setAvailableFields(["count"])).toBe("count");
    expect(m.field).toBe("");
  });

  it("warns once when the declared field is not offered", () => {
    const m = makeManager({ field: "score" });
    const warn = spyWarn(m);
    expect(m.setAvailableFields(["count"])).toBe("count");
    expect(m.setAvailableFields(["count"])).toBe("count");
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain("declared field not found");
  });

  it("re-opens the guard on Reset so the declaration applies again", () => {
    const m = makeManager({ layer: "Facility Points" });
    m.pointLayers = [{ id: "p1", name: "Facility Points", layer: null, count: 1 }];
    // A record consumed the guard...
    m.hasScanned = true;
    expect(m.resolveDeclaredLayer()).toBeNull();
    // ...and Reset (the Clear path) deletes that record, so the declaration is
    // the starting state again: the next rebuild may apply it.
    m.resetState({} as never);
    expect(m.hasScanned).toBe(false);
    expect(m.resolveDeclaredLayer()).toBe("p1");
  });

  it("treats a non-string declaration as absent instead of matching it", () => {
    // CONFIG is a JSON bridge, but a hand-written CONFIG (or an older bundle)
    // must not make the scan compare against a non-string name.
    const m = makeManager({ layer: 3, field: {} });
    m.pointLayers = [{ id: "p1", name: "3", layer: null, count: 1 }];
    expect(m.resolveDeclaredLayer()).toBeNull();
    // No declaration to match: the resolver answers with the offered field.
    expect(m.setAvailableFields(["3"])).toBe("3");
  });
});

describe("effective aggregation field - the auto default never becomes a record", () => {
  it("prefers the user's pick, then the declaration, then the first field", () => {
    const declared = makeManager({ field: "score" });
    declared.field = "count";
    expect(declared.setAvailableFields(["count", "score"])).toBe("count");

    declared.field = "";
    expect(declared.setAvailableFields(["count", "score"])).toBe("score");

    const guessed = makeManager();
    expect(guessed.setAvailableFields(["temp", "rain"])).toBe("temp");
  });

  it("keeps a stored pick the data no longer offers, and restores it with the data", () => {
    const m = makeManager();
    m.field = "rain";
    // The pick was written in an earlier session: that record is the intent.
    m.saveConfig();
    m.flush();
    expect(m.loadSavedConfig()?.field).toBe("rain");

    // The new data has no rain column: the display falls back, the pick stays.
    expect(m.setAvailableFields(["temp", "wind"])).toBe("temp");
    expect(m.field).toBe("rain");
    // A later write must not replace the intent with the displayed fallback.
    m.saveConfig();
    m.flush();
    expect(m.loadSavedConfig()?.field).toBe("rain");

    // The column comes back: the user's pick is in force again, untouched.
    expect(m.setAvailableFields(["temp", "rain"])).toBe("rain");
  });

  it("never persists the guess: a scan-only manager saves no field", () => {
    const m = makeManager();
    expect(m.setAvailableFields(["temp", "rain"])).toBe("temp");
    m.saveConfig();
    m.flush();
    expect(m.loadSavedConfig()?.field).toBeUndefined();
  });

  it("resolves once per field list, not once per feature", () => {
    const m = makeManager();
    const resolve = vi.spyOn(m, "resolveEffectiveField");
    m.setAvailableFields(["count", "score"]);
    const afterScan = resolve.mock.calls.length;
    m.agg = CONST.AGG.SUM;

    // 100 per-feature reads (the real path is 20k) must all hit the cache.
    for (let i = 0; i < 100; i++) m.getPointValue({ count: 7 });
    expect(resolve.mock.calls.length).toBe(afterScan);
  });

  it("invalidates on a persistence write so the user's new pick takes effect", () => {
    const m = makeManager();
    m.agg = CONST.AGG.SUM;
    m.setAvailableFields(["count", "options.value"]);
    expect(m.effectiveField()).toBe("count");
    expect(m.getPointValue({ options: { value: 3 } })).toBe(1);

    m.field = "options.value";
    m.saveConfig();
    expect(m.effectiveField()).toBe("options.value");
    expect(m.getPointValue({ options: { value: 3 } })).toBe(3);
  });

  it("Reset returns the field to the declaration (or empty)", () => {
    const m = makeManager({ field: "score" });
    m.field = "count";
    expect(m.setAvailableFields(["count", "score"])).toBe("count");

    m.resetState({} as never);

    // The pick is gone and the scan belongs to the departed selection, so the
    // declaration is the starting state again - no record, no stale guess.
    expect(m.field).toBe("");
    expect(m.effectiveField()).toBe("score");
  });
});

// ── Declared filter guards (HeatmapManager) ───────────────────────────
//
// The matrix below pins the cross-branch rows; these are the Heatmap-only
// guards the range branch needs: clamping to the snapshot extent, timing versus
// data defects, and the field/aggregation coupling.
