// Unit tests for fillRamp — value-based fill rendering.
//
// The mutual exclusion logic (Solid↔ramp) is tested through the FILL_DIMENSION
// descriptor's write function. The applyRampToLayer function is tested directly
// with mock layers.
import { afterEach, describe, expect, it, vi } from "vitest";
import { METHOD } from "#core/classify.js";
import { DEFAULT_SCHEMES } from "#core/palette.js";
import type { FillRampConfig } from "#foliplus/LayerControl/type.js";
import { applyRampToLayer } from "#foliplus/LayerControl/ui/style/fillRamp.js";

afterEach(() => {
  delete globalThis.chroma;
  delete globalThis.ss;
});

/** Create a mock Leaflet layer with features for value-based fill testing. */
const makeFeatureLayer = (features: Array<{ properties: Record<string, unknown> }>) => {
  const leaves = features.map(f => ({
    feature: { properties: f.properties },
    options: { fillColor: "#3388ff", fillOpacity: 0.2, fill: true },
    setStyle: vi.fn(),
    on: vi.fn(),
  }));
  return {
    eachLayer: (fn: (layer: unknown) => void) => leaves.forEach(l => fn(l)),
    leaves,
  };
};

/** Create a minimal mock LayerUI for applyRampToLayer. */
const makeUI = (layer: unknown) => {
  return {
    m: {
      layerRegistry: new Map([["overlay1", { id: "overlay1", layer }] as any]),
      findLayer: () => layer,
    },
  } as any;
};

describe("applyRampToLayer", () => {
  it("classifies values and writes per-leaf fillColor via commitStyleDim", () => {
    globalThis.chroma = {
      scale: vi.fn(() => ({
        mode: vi.fn(() => ({
          colors: vi.fn(() => ["#ff0000", "#00ff00", "#0000ff"]),
        })),
      })),
    } as any;

    const features = [
      { properties: { value: 1 } },
      { properties: { value: 5 } },
      { properties: { value: 9 } },
    ];
    const layer = makeFeatureLayer(features);
    const ui = makeUI(layer);

    const ramp: FillRampConfig = {
      field: "value",
      method: METHOD.EQUAL,
      classes: 3,
      scheme: DEFAULT_SCHEMES[0],
    };

    applyRampToLayer(ui, "overlay1", ramp);

    // Each leaf's setStyle should be called with a fillColor
    for (const leaf of layer.leaves) {
      expect(leaf.setStyle).toHaveBeenCalled();
      const call = (leaf.setStyle as any).mock.calls[0][0];
      expect(call.fillColor).toBeDefined();
      expect(call.fill).toBe(true);
    }
  });

  it("skips leaves with non-finite values", () => {
    const features = [
      { properties: { value: 1 } },
      { properties: { value: NaN } },
      { properties: { value: Infinity } },
      { properties: { value: "string" } },
    ];
    const layer = makeFeatureLayer(features);
    const ui = makeUI(layer);

    const ramp: FillRampConfig = {
      field: "value",
      method: METHOD.EQUAL,
      classes: 3,
      scheme: DEFAULT_SCHEMES[0],
    };

    applyRampToLayer(ui, "overlay1", ramp);

    // Only the first leaf (value: 1) should have setStyle called
    expect(layer.leaves[0].setStyle).toHaveBeenCalled();
    expect(layer.leaves[1].setStyle).not.toHaveBeenCalled();
    expect(layer.leaves[2].setStyle).not.toHaveBeenCalled();
    expect(layer.leaves[3].setStyle).not.toHaveBeenCalled();
  });

  it("returns early for a layer with no finite values", () => {
    const features = [{ properties: { value: NaN } }];
    const layer = makeFeatureLayer(features);
    const ui = makeUI(layer);

    const ramp: FillRampConfig = {
      field: "value",
      method: METHOD.EQUAL,
      classes: 3,
      scheme: DEFAULT_SCHEMES[0],
    };

    applyRampToLayer(ui, "overlay1", ramp);

    expect(layer.leaves[0].setStyle).not.toHaveBeenCalled();
  });

  it("returns early for a layer not in the registry", () => {
    const ui = { m: { layerRegistry: new Map(), findLayer: () => null } } as any;
    const ramp: FillRampConfig = {
      field: "value",
      method: METHOD.EQUAL,
      classes: 3,
      scheme: DEFAULT_SCHEMES[0],
    };

    expect(() => applyRampToLayer(ui, "missing", ramp)).not.toThrow();
  });

  it("caps classes at the number of available values", () => {
    globalThis.chroma = {
      scale: vi.fn(() => ({
        mode: vi.fn(() => ({
          colors: vi.fn(() => ["#ff0000", "#00ff00"]),
        })),
      })),
    } as any;

    const features = [{ properties: { value: 1 } }, { properties: { value: 2 } }];
    const layer = makeFeatureLayer(features);
    const ui = makeUI(layer);

    const ramp: FillRampConfig = {
      field: "value",
      method: METHOD.EQUAL,
      classes: 9, // More classes than values
      scheme: DEFAULT_SCHEMES[0],
    };

    applyRampToLayer(ui, "overlay1", ramp);

    // Both leaves should get a color
    expect(layer.leaves[0].setStyle).toHaveBeenCalled();
    expect(layer.leaves[1].setStyle).toHaveBeenCalled();
  });
});
