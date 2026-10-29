// Independent test for `inZoomRange` (projection.ts) — the policy half of
// the projection formula. `projectLayer` tests cover the composition with
// intent; those here pin the pure range-vs-map-zoom predicate on its own,
// including the clamp branches that a basemap switch exercises.
import { afterEach, describe, expect, it, vi } from "vitest";
import { LayerRuntimeStore } from "#core/layer/index.js";
import { LayerIntentStore } from "#foliplus/LayerControl/domain/index.js";
import type { LayerUI } from "#foliplus/LayerControl/ui/index.js";
import { clearIntent, setIntent } from "#foliplus/LayerControl/ui/intent.js";
import {
  currentOpacity,
  inZoomRange,
  projectLayer,
} from "#foliplus/LayerControl/ui/projection.js";

const makeLayerInfo = (id: string, opts: { opacity?: number } = {}) =>
  ({ id, layer: null, canvas: null, opacity: opts.opacity }) as any;

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

describe("currentOpacity (resolved opacity read)", () => {
  it("returns the stored intent when set", () => {
    const ui = makeUI();
    setIntent(ui, "l1", "opacity", 0.4);
    expect(currentOpacity(ui, makeLayerInfo("l1"))).toBe(0.4);
  });

  it("falls back to layerInfo.opacity when no intent is stored", () => {
    const ui = makeUI();
    expect(currentOpacity(ui, makeLayerInfo("l1", { opacity: 0.7 }))).toBe(0.7);
  });

  it("falls back to 1 when neither intent nor layerInfo.opacity exists", () => {
    const ui = makeUI();
    expect(currentOpacity(ui, makeLayerInfo("l1"))).toBe(1);
  });

  it("forces 1 for the focused layer regardless of stored values", () => {
    const ui = makeUI();
    setIntent(ui, "l1", "opacity", 0.4);
    ui.focusController.focusingLayerId = "l1";
    expect(currentOpacity(ui, makeLayerInfo("l1", { opacity: 0.2 }))).toBe(1);
  });
});

// The author-declared range (`foliplus={"zoom": {...}}` → CONF `data[].zoom`)
// is the policy fallback when the user never set a range — the same role
// `data[].show` plays for visibility. These cases pin that fallback, the
// precedence of a stored choice over it, and the two defensive edges: the
// clamp to the map bounds and a payload CONF should never contain.
describe("inZoomRange (author-declared range)", () => {
  const makeUIWith = (opts: { minZoom?: number; maxZoom?: number; zoom?: number }) =>
    makeUI(opts);

  const layerWithZoom = (id: string, zoom: { min: number; max: number }) =>
    ({ id, layer: null, canvas: null, zoom }) as any;

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("falls back to the author range when no intent is stored", () => {
    const ui = makeUIWith({ zoom: 10 });
    expect(inZoomRange(ui, layerWithZoom("author-in", { min: 8, max: 12 }))).toBe(true);
    expect(inZoomRange(ui, layerWithZoom("author-out", { min: 11, max: 14 }))).toBe(
      false,
    );
  });

  it("a stored range wins over the author range", () => {
    const ui = makeUIWith({ zoom: 10 });
    setIntent(ui, "precedence", "zoomRange", [0, 5]);
    expect(inZoomRange(ui, layerWithZoom("precedence", { min: 8, max: 12 }))).toBe(
      false,
    );
  });

  it("clamps the author range to the map bounds", () => {
    // Author [3, 5] on a map [4, 18]: clamp to [4, 5]; zoom 4 is inside.
    const ui = makeUIWith({ minZoom: 4, maxZoom: 18, zoom: 4 });
    expect(inZoomRange(ui, layerWithZoom("clamped", { min: 3, max: 5 }))).toBe(true);
  });

  it("judges the declaration when the clamp would degenerate", () => {
    // Author [20, 30] on a map capped at 18: the clamp would leave min > max.
    // The verdict comes from the declared interval, not from the clamp
    // artefact, so a zoom outside the map bounds still answers honestly
    // instead of being forced to "hidden".
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const ui = makeUIWith({ minZoom: 0, maxZoom: 18, zoom: 25 });
    expect(inZoomRange(ui, layerWithZoom("degenerate", { min: 20, max: 30 }))).toBe(
      true,
    );
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("treats an inverted declaration as undeclared", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const ui = makeUIWith({ zoom: 10 });
    expect(inZoomRange(ui, layerWithZoom("inverted", { min: 12, max: 8 }))).toBe(true);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("treats a non-finite declaration as undeclared", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const ui = makeUIWith({ zoom: 10 });
    expect(
      inZoomRange(ui, layerWithZoom("non-finite", { min: Number.NaN, max: 12 })),
    ).toBe(true);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("warns once per layer about a malformed declaration", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const ui = makeUIWith({ zoom: 10 });
    const layer = layerWithZoom("warn-once", { min: 12, max: 8 });
    inZoomRange(ui, layer);
    inZoomRange(ui, layer);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("honours the author range even when the surface cannot show a row", () => {
    // The capability gate decides whether the panel renders a zoom-range
    // row, not whether a declaration is honoured. A surface that cannot
    // carry a row (MarkerCluster / ImageOverlay declare "none") must still
    // be filtered by the declaration, or the declaration is silently dropped
    // for exactly the layers the panel cannot explain it for.
    const ui = makeUIWith({ zoom: 5 });
    (ui.c as any).surfaceFor = () => ({ capabilities: { zoomRange: "none" } });
    const layer = layerWithZoom("cap-none", { min: 8, max: 12 });
    expect(projectLayer(ui, layer).effectiveShown).toBe(false);
  });
});
