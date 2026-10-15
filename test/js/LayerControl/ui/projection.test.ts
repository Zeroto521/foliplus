// Independent test for `inZoomRange` (projection.ts) — the policy half of
// the projection formula. `projectLayer` tests cover the composition with
// intent; those here pin the pure range-vs-map-zoom predicate on its own,
// including the clamp branches that a basemap switch exercises.
import { afterEach, describe, expect, it, vi } from "vitest";
import { LayerRuntimeStore } from "#core/layer/index.js";
import { LayerIntentStore } from "#foliplus/LayerControl/domain/index.js";
import type { LayerUI } from "#foliplus/LayerControl/ui/index.js";
import { clearIntent, setIntent } from "#foliplus/LayerControl/ui/intent.js";
import { inZoomRange, projectLayer } from "#foliplus/LayerControl/ui/projection.js";

const makeLayerInfo = (id: string) => ({ id, layer: null, canvas: null }) as any;

const makeUI = (
  opts: {
    minZoom?: number;
    maxZoom?: number;
    zoom?: number;
  } = {},
): LayerUI => {
  const { minZoom = 0, maxZoom = 18, zoom = 10 } = opts;
  const ui = {
    c: {
      map: {
        getMinZoom: () => minZoom,
        getMaxZoom: () => maxZoom,
        getZoom: () => zoom,
      },
    },
    intentStore: new LayerIntentStore(),
    runtimeStore: new LayerRuntimeStore(),
    focusController: { focusingLayerId: null },
  } as any;
  return ui as LayerUI;
};

describe("inZoomRange (policy predicate on its own)", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("returns true when no range is stored", () => {
    const ui = makeUI();
    expect(inZoomRange(ui, makeLayerInfo("l1"))).toBe(true);
  });

  it("returns true when zoom is strictly inside the stored range", () => {
    const ui = makeUI({ zoom: 8 });
    setIntent(ui, "l1", "zoomRange", [5, 12]);
    expect(inZoomRange(ui, makeLayerInfo("l1"))).toBe(true);
  });

  it("returns false when zoom is below the stored range", () => {
    const ui = makeUI({ zoom: 4 });
    setIntent(ui, "l1", "zoomRange", [5, 12]);
    expect(inZoomRange(ui, makeLayerInfo("l1"))).toBe(false);
  });

  it("returns false when zoom is above the stored range", () => {
    const ui = makeUI({ zoom: 15 });
    setIntent(ui, "l1", "zoomRange", [5, 12]);
    expect(inZoomRange(ui, makeLayerInfo("l1"))).toBe(false);
  });

  it("includes the range endpoints (closed interval)", () => {
    const uiLow = makeUI({ zoom: 5 });
    setIntent(uiLow, "l1", "zoomRange", [5, 12]);
    expect(inZoomRange(uiLow, makeLayerInfo("l1"))).toBe(true);

    const uiHigh = makeUI({ zoom: 12 });
    setIntent(uiHigh, "l1", "zoomRange", [5, 12]);
    expect(inZoomRange(uiHigh, makeLayerInfo("l1"))).toBe(true);
  });

  it("clamps endpoints outside the map bounds and keeps the range usable", () => {
    // Stored [-5, 25] against a map [0, 18]: clamp to [0, 18], zoom 10 in.
    const ui = makeUI({ minZoom: 0, maxZoom: 18, zoom: 10 });
    setIntent(ui, "l1", "zoomRange", [-5, 25]);
    expect(inZoomRange(ui, makeLayerInfo("l1"))).toBe(true);
  });

  it("clamps only the low end when the map's min exceeds the stored low", () => {
    // Stored [0, 12] against a map [3, 15]: clamp to [3, 12], zoom 2 below → false.
    const ui = makeUI({ minZoom: 3, maxZoom: 15, zoom: 2 });
    setIntent(ui, "l1", "zoomRange", [0, 12]);
    expect(inZoomRange(ui, makeLayerInfo("l1"))).toBe(false);
  });

  it("clamps only the high end when the map's max is below the stored high", () => {
    // Stored [8, 25] against a map [0, 15]: clamp to [8, 15], zoom 20 above → false.
    const ui = makeUI({ minZoom: 0, maxZoom: 15, zoom: 20 });
    setIntent(ui, "l1", "zoomRange", [8, 25]);
    expect(inZoomRange(ui, makeLayerInfo("l1"))).toBe(false);
  });

  it("returns false when the clamp collapses the range (min > max)", () => {
    // Stored [5, 3] — already inverted before clamp.
    const ui = makeUI({ zoom: 10 });
    setIntent(ui, "l1", "zoomRange", [5, 3]);
    expect(inZoomRange(ui, makeLayerInfo("l1"))).toBe(false);
  });

  it("returns false when a narrow map clamps both ends past each other", () => {
    // Stored [12, 14] against a map [0, 10]: clamp to [12, 10], min > max.
    const ui = makeUI({ minZoom: 0, maxZoom: 10, zoom: 5 });
    setIntent(ui, "l1", "zoomRange", [12, 14]);
    expect(inZoomRange(ui, makeLayerInfo("l1"))).toBe(false);
  });

  it("reads the stored range through the intent store, not the layer record", () => {
    const ui = makeUI({ zoom: 10 });
    // No intent entry on the layer; the store is the source of truth.
    setIntent(ui, "l1", "zoomRange", [8, 12]);
    expect(inZoomRange(ui, makeLayerInfo("l1"))).toBe(true);

    clearIntent(ui, "l1", "zoomRange");
    expect(inZoomRange(ui, makeLayerInfo("l1"))).toBe(true);
  });
});

// projectLayer composes the projection formula with the user's intent.
// These cases pin the focus-driven opacity override: the user's stored value
// stays in the intent store untouched, but the projection reports 1 for the
// focused layer only. The zoom-range policy half is already covered above and
// separately in apply.test.ts; those branches share one gate (`focusingLayerId
// != null`) and are not re-tested here.
describe("projectLayer (focus-driven opacity override)", () => {
  it("returns the stored opacity when nothing is focused", () => {
    const ui = makeUI();
    setIntent(ui, "l1", "opacity", 0.4);
    expect(projectLayer(ui, makeLayerInfo("l1")).opacity).toBe(0.4);
  });

  it("returns undefined for opacity when no intent is stored (author's default)", () => {
    const ui = makeUI();
    expect(projectLayer(ui, makeLayerInfo("l1")).opacity).toBeUndefined();
  });

  it("forces opacity to 1 for the focused layer, leaving the intent untouched", () => {
    const ui = makeUI();
    setIntent(ui, "l1", "opacity", 0.4);
    ui.focusController.focusingLayerId = "l1";
    expect(projectLayer(ui, makeLayerInfo("l1")).opacity).toBe(1);
    // The intent store is not written by the projection — dismissFocus's
    // replay lands the author's value back on the next sweep.
    expect(ui.intentStore.get("l1", "opacity")).toBe(0.4);
  });

  it("does not override opacity on a non-focused layer during another focus", () => {
    const ui = makeUI();
    setIntent(ui, "l1", "opacity", 0.4);
    setIntent(ui, "l2", "opacity", 0.7);
    ui.focusController.focusingLayerId = "l1";
    // The focused layer is forced to 1.
    expect(projectLayer(ui, makeLayerInfo("l1")).opacity).toBe(1);
    // The other layer keeps its own intent — the override is single-layer,
    // unlike the zoom-range policy which is a blanket `!= null` gate.
    expect(projectLayer(ui, makeLayerInfo("l2")).opacity).toBe(0.7);
  });

  it("covers an undefined-opacity focused layer to 1 (fully opaque)", () => {
    const ui = makeUI();
    // No intent stored — the focused layer's projection reads 1, matching
    // the author's default, so the executor's diff is a no-op there.
    ui.focusController.focusingLayerId = "l1";
    expect(projectLayer(ui, makeLayerInfo("l1")).opacity).toBe(1);
  });
});
