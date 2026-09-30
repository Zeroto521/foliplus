// Unit tests for fillRamp — value-based fill rendering.
//
// The mutual exclusion logic (Solid↔ramp) is tested through the FILL_DIMENSION
// descriptor's write function. The applyRampToLayer function is tested directly
// with mock layers.
import { afterEach, describe, expect, it, vi } from "vitest";
import { METHOD } from "#core/classify.js";
import { DEFAULT_SCHEMES } from "#core/palette.js";
import type { FillRampConfig } from "#foliplus/LayerControl/type.js";

// Mock pinStyleOnHighlight and getIntent so we can capture and invoke the
// pin getter callback in isolation.
const mockGetIntent = vi.fn();
vi.mock("#foliplus/LayerControl/ui/intent.js", () => ({
  INTENT: { FILL_RAMP: "fillRamp" },
  getIntent: (...args: unknown[]) => mockGetIntent(...args),
}));
vi.mock("#foliplus/LayerControl/ui/style/pin.js", () => ({
  pinStyleOnHighlight: vi.fn(),
}));

import { applyRampToLayer } from "#foliplus/LayerControl/ui/style/fillRamp.js";
import { pinStyleOnHighlight } from "#foliplus/LayerControl/ui/style/pin.js";

afterEach(() => {
  delete globalThis.chroma;
  delete globalThis.ss;
  vi.clearAllMocks();
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

  it("pin getter returns null when ramp intent is cleared", () => {
    globalThis.chroma = {
      scale: vi.fn(() => ({
        mode: vi.fn(() => ({
          colors: vi.fn(() => ["#ff0000", "#00ff00", "#0000ff"]),
        })),
      })),
    } as any;

    const features = [{ properties: { value: 5 } }];
    const layer = makeFeatureLayer(features);
    const ui = makeUI(layer);

    const ramp: FillRampConfig = {
      field: "value",
      method: METHOD.EQUAL,
      classes: 3,
      scheme: DEFAULT_SCHEMES[0],
    };

    applyRampToLayer(ui, "overlay1", ramp);

    // The pin getter was registered — call it with no ramp intent
    mockGetIntent.mockReturnValue(null);
    const getterCallback = (pinStyleOnHighlight as any).mock.calls[0][2];
    expect(getterCallback()).toBeNull();
  });

  it("pin getter returns null when config changed since cache build", () => {
    globalThis.chroma = {
      scale: vi.fn(() => ({
        mode: vi.fn(() => ({
          colors: vi.fn(() => ["#ff0000", "#00ff00", "#0000ff"]),
        })),
      })),
    } as any;

    const features = [{ properties: { value: 5 } }];
    const layer = makeFeatureLayer(features);
    const ui = makeUI(layer);

    const ramp: FillRampConfig = {
      field: "value",
      method: METHOD.EQUAL,
      classes: 3,
      scheme: DEFAULT_SCHEMES[0],
    };

    applyRampToLayer(ui, "overlay1", ramp);

    // Getter sees a DIFFERENT ramp (field changed) — should return null
    mockGetIntent.mockReturnValue({ ...ramp, field: "otherField" });
    const getterCallback = (pinStyleOnHighlight as any).mock.calls[0][2];
    expect(getterCallback()).toBeNull();
  });

  it("pin getter returns colour when config matches and value is finite", () => {
    globalThis.chroma = {
      scale: vi.fn(() => ({
        mode: vi.fn(() => ({
          colors: vi.fn(() => ["#ff0000", "#00ff00", "#0000ff"]),
        })),
      })),
    } as any;

    const features = [{ properties: { value: 5 } }];
    const layer = makeFeatureLayer(features);
    const ui = makeUI(layer);

    const ramp: FillRampConfig = {
      field: "value",
      method: METHOD.EQUAL,
      classes: 3,
      scheme: DEFAULT_SCHEMES[0],
    };

    applyRampToLayer(ui, "overlay1", ramp);

    // Getter sees the SAME ramp — should return a colour payload
    mockGetIntent.mockReturnValue(ramp);
    const getterCallback = (pinStyleOnHighlight as any).mock.calls[0][2];
    const result = getterCallback();
    expect(result).not.toBeNull();
    expect(result.fillColor).toBeDefined();
  });

  it("pin getter returns null when live value is non-finite", () => {
    globalThis.chroma = {
      scale: vi.fn(() => ({
        mode: vi.fn(() => ({
          colors: vi.fn(() => ["#ff0000", "#00ff00", "#0000ff"]),
        })),
      })),
    } as any;

    // Feature starts with a valid value (so applyRampToLayer collects it),
    // but we'll mutate it to NaN before invoking the getter.
    const features = [{ properties: { value: 5 } }];
    const layer = makeFeatureLayer(features);
    const ui = makeUI(layer);

    const ramp: FillRampConfig = {
      field: "value",
      method: METHOD.EQUAL,
      classes: 3,
      scheme: DEFAULT_SCHEMES[0],
    };

    applyRampToLayer(ui, "overlay1", ramp);

    // Mutate the property to NaN — getter should return null
    features[0].properties.value = NaN;
    mockGetIntent.mockReturnValue(ramp);
    const getterCallback = (pinStyleOnHighlight as any).mock.calls[0][2];
    expect(getterCallback()).toBeNull();
  });

  it("falls back to last colour when class index is out of bounds", () => {
    // Chroma returns only 1 colour for 3 classes — classIdx 1 and 2 will be
    // out of bounds, triggering the fallback to the last available colour.
    globalThis.chroma = {
      scale: vi.fn(() => ({
        mode: vi.fn(() => ({
          colors: vi.fn(() => ["#ff0000"]), // only 1 colour for 3 classes
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

    // All leaves should still get a colour (the fallback #ff0000)
    for (const leaf of layer.leaves) {
      expect(leaf.setStyle).toHaveBeenCalled();
      const call = (leaf.setStyle as any).mock.calls[0][0];
      expect(call.fillColor).toBe("#ff0000");
    }
  });

  it("handles single-value layer (breaks.length === 2, all in one class)", () => {
    globalThis.chroma = {
      scale: vi.fn(() => ({
        mode: vi.fn(() => ({
          colors: vi.fn(() => ["#ff0000"]),
        })),
      })),
    } as any;

    const features = [{ properties: { value: 42 } }];
    const layer = makeFeatureLayer(features);
    const ui = makeUI(layer);

    const ramp: FillRampConfig = {
      field: "value",
      method: METHOD.EQUAL,
      classes: 5, // More classes than values — capped to 1
      scheme: DEFAULT_SCHEMES[0],
    };

    applyRampToLayer(ui, "overlay1", ramp);

    // The single leaf should get a colour
    expect(layer.leaves[0].setStyle).toHaveBeenCalled();
  });
});
