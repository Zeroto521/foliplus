// Unit tests for fillRamp — value-based fill rendering.
//
// The mutual exclusion logic (Solid ↔ ramp) is covered in fill.test.ts
// through the FILL_DIMENSION descriptor; applyRampToLayer is tested here
// directly with mock layers.
import { afterEach, describe, expect, it, vi } from "vitest";
import { METHOD } from "#core/classify.js";
import type { FillRampConfig } from "#core/layer/intent.js";
import { DEFAULT_SCHEMES } from "#core/palette.js";
import { applyRampToLayer } from "#foliplus/LayerControl/ui/style/fillRamp.js";
import { pinStyleOnHighlight } from "#foliplus/LayerControl/ui/style/pin.js";

// A live intent table keyed by the intent-key string, so a test can set the
// ramp config and the opacity independently — the pin reads both live.
let intentValues: Record<string, unknown> = {};
const mockGetIntent = vi.fn(
  (_ui: unknown, _id: unknown, key: string) => intentValues[key],
);

vi.mock("#foliplus/LayerControl/ui/intent.js", () => ({
  INTENT: {
    FILL_RAMP: "fillRamp",
    FILL_OPACITY: "fillOpacity",
  },
  getIntent: (ui: unknown, id: unknown, key: string) => mockGetIntent(ui, id, key),
}));
vi.mock("#foliplus/LayerControl/ui/style/pin.js", () => ({
  pinStyleOnHighlight: vi.fn(),
}));

/** Install a chroma stub that hands back a fixed colour list, whatever
 *  count was requested — used to force the out-of-bounds fallback. */
const installChroma = (colors: string[]): void => {
  globalThis.chroma = {
    scale: () => ({
      mode: () => ({
        colors: () => colors,
      }),
    }),
  } as never;
};

/** The pin getter registered for the n-th leaf (0-based). */
const pinGetterOf = (n = 0): (() => Record<string, unknown> | null) =>
  (pinStyleOnHighlight as ReturnType<typeof vi.fn>).mock.calls[n][2];

afterEach(() => {
  delete globalThis.chroma;
  intentValues = {};
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
const makeUI = (layer: unknown) =>
  ({
    c: {
      layerRegistry: new Map([["overlay1", { id: "overlay1", layer }] as any]),
      findLayer: () => layer,
    },
  }) as any;

const makeRamp = (overrides: Partial<FillRampConfig> = {}): FillRampConfig => ({
  field: "value",
  method: METHOD.EQUAL,
  classes: 3,
  scheme: DEFAULT_SCHEMES[0],
  ...overrides,
});

describe("applyRampToLayer", () => {
  it("classifies values and writes per-leaf fillColor via commitStyleDim", () => {
    installChroma(["#ff0000", "#00ff00", "#0000ff"]);

    const layer = makeFeatureLayer([
      { properties: { value: 1 } },
      { properties: { value: 5 } },
      { properties: { value: 9 } },
    ]);
    applyRampToLayer(makeUI(layer), "overlay1", makeRamp());

    // Each leaf's setStyle should be called with a fillColor and the fill
    // visibility bit (commitStyleDim's write contract).
    for (const leaf of layer.leaves) {
      expect(leaf.setStyle).toHaveBeenCalled();
      const call = (leaf.setStyle as any).mock.calls[0][0];
      expect(call.fillColor).toBeDefined();
      expect(call.fill).toBe(true);
    }
    // Distinct values land in distinct classes when the scale has room.
    const colors = layer.leaves.map(
      leaf => (leaf.setStyle as any).mock.calls[0][0].fillColor as string,
    );
    expect(new Set(colors).size).toBe(3);
  });

  it("omits fillOpacity from the write when the user never set one", () => {
    installChroma(["#ff0000", "#00ff00", "#0000ff"]);
    const layer = makeFeatureLayer([{ properties: { value: 5 } }]);

    applyRampToLayer(makeUI(layer), "overlay1", makeRamp());

    const call = (layer.leaves[0].setStyle as any).mock.calls[0][0];
    expect(call.fillOpacity).toBeUndefined();
  });

  it("carries the solid-mode fillOpacity onto every ramp leaf", () => {
    installChroma(["#ff0000", "#00ff00", "#0000ff"]);
    intentValues = { fillOpacity: 0.25 };
    const layer = makeFeatureLayer([
      { properties: { value: 1 } },
      { properties: { value: 9 } },
    ]);

    applyRampToLayer(makeUI(layer), "overlay1", makeRamp());

    for (const leaf of layer.leaves) {
      const call = (leaf.setStyle as any).mock.calls[0][0];
      expect(call.fillOpacity).toBe(0.25);
      expect(call.fillColor).toBeDefined();
    }
  });

  it("skips leaves with non-finite values", () => {
    installChroma(["#ff0000", "#00ff00", "#0000ff"]);
    const layer = makeFeatureLayer([
      { properties: { value: 1 } },
      { properties: { value: NaN } },
      { properties: { value: Infinity } },
      { properties: { value: "string" } },
    ]);

    applyRampToLayer(makeUI(layer), "overlay1", makeRamp());

    expect(layer.leaves[0].setStyle).toHaveBeenCalled();
    expect(layer.leaves[1].setStyle).not.toHaveBeenCalled();
    expect(layer.leaves[2].setStyle).not.toHaveBeenCalled();
    expect(layer.leaves[3].setStyle).not.toHaveBeenCalled();
  });

  it("returns early for a layer with no finite values", () => {
    installChroma(["#ff0000", "#00ff00", "#0000ff"]);
    const layer = makeFeatureLayer([{ properties: { value: NaN } }]);

    applyRampToLayer(makeUI(layer), "overlay1", makeRamp());

    expect(layer.leaves[0].setStyle).not.toHaveBeenCalled();
  });

  it("returns early for a layer not in the registry", () => {
    const ui = { c: { layerRegistry: new Map(), findLayer: () => null } } as any;

    expect(() => applyRampToLayer(ui, "missing", makeRamp())).not.toThrow();
  });

  it("caps classes at the number of available values", () => {
    installChroma(["#ff0000", "#00ff00"]);
    const layer = makeFeatureLayer([
      { properties: { value: 1 } },
      { properties: { value: 2 } },
    ]);

    applyRampToLayer(makeUI(layer), "overlay1", makeRamp({ classes: 9 }));

    expect(layer.leaves[0].setStyle).toHaveBeenCalled();
    expect(layer.leaves[1].setStyle).toHaveBeenCalled();
  });

  it("pin getter returns null when the ramp intent is cleared", () => {
    installChroma(["#ff0000", "#00ff00", "#0000ff"]);
    const layer = makeFeatureLayer([{ properties: { value: 5 } }]);
    applyRampToLayer(makeUI(layer), "overlay1", makeRamp());

    expect(pinGetterOf()()).toBeNull();
  });

  it("pin getter returns null when the config changed since the cache build", () => {
    installChroma(["#ff0000", "#00ff00", "#0000ff"]);
    const ramp = makeRamp();
    const layer = makeFeatureLayer([{ properties: { value: 5 } }]);
    applyRampToLayer(makeUI(layer), "overlay1", ramp);

    // Getter sees a different ramp under each key — the cached breaks no
    // longer describe the live config, so the author's face stays in force.
    for (const [key, value] of [
      ["field", "otherField"],
      ["method", METHOD.QUANTILE],
      ["classes", 5],
      ["scheme", DEFAULT_SCHEMES[1]],
    ]) {
      intentValues = { fillRamp: { ...ramp, [key]: value } };
      expect(pinGetterOf()()).toBeNull();
    }
  });

  it("pin getter returns a colour payload when the config matches", () => {
    installChroma(["#ff0000", "#00ff00", "#0000ff"]);
    const ramp = makeRamp();
    const layer = makeFeatureLayer([{ properties: { value: 5 } }]);
    applyRampToLayer(makeUI(layer), "overlay1", ramp);

    intentValues = { fillRamp: ramp };
    const result = pinGetterOf()();
    expect(result).not.toBeNull();
    expect(result!.fillColor).toBeDefined();
    expect(result!.fill).toBe(true);
  });

  it("applies an explicit numeric kind and reads it back as the same config", () => {
    // `kind` is the field's typing; "numeric" is the default, so spelling it
    // out must not change the paint, and the cached breaks must still be
    // valid when the live config omits it.
    installChroma(["#ff0000", "#00ff00", "#0000ff"]);
    const ramp = makeRamp({ kind: "numeric" });
    const layer = makeFeatureLayer([
      { properties: { value: 1 } },
      { properties: { value: 5 } },
      { properties: { value: 9 } },
    ]);
    applyRampToLayer(makeUI(layer), "overlay1", ramp);

    const colorOf = (n: number) =>
      (layer.leaves[n].setStyle as any).mock.calls[0][0].fillColor as string;
    expect(colorOf(0)).toBe("#ff0000");
    expect(colorOf(1)).toBe("#00ff00");
    expect(colorOf(2)).toBe("#0000ff");
    intentValues = { fillRamp: makeRamp() };
    expect(pinGetterOf()()).not.toBeNull();
  });

  it("invalidates the pin when the kind points at the categorical arm", () => {
    // The categorical arm is a later batch and builds its breaks differently,
    // so a same-named config typed for it must not repaint off a numeric
    // cache — the pin-side twin of the persistence reader dropping such a
    // record whole. The type cannot spell the value yet, hence the cast.
    installChroma(["#ff0000", "#00ff00", "#0000ff"]);
    const ramp = makeRamp();
    const layer = makeFeatureLayer([{ properties: { value: 5 } }]);
    applyRampToLayer(makeUI(layer), "overlay1", ramp);

    intentValues = {
      fillRamp: { ...ramp, kind: "categorical" } as unknown as FillRampConfig,
    };
    expect(pinGetterOf()()).toBeNull();
  });

  it("pin replays the live fillOpacity, not the value frozen at build time", () => {
    installChroma(["#ff0000", "#00ff00", "#0000ff"]);
    const ramp = makeRamp();
    const layer = makeFeatureLayer([{ properties: { value: 5 } }]);

    // Build with no opacity, then choose one afterwards.
    applyRampToLayer(makeUI(layer), "overlay1", ramp);

    intentValues = { fillRamp: ramp, fillOpacity: 0.4 };
    expect(pinGetterOf()()!.fillOpacity).toBe(0.4);
  });

  it("pin getter returns null when the live value is non-finite", () => {
    installChroma(["#ff0000", "#00ff00", "#0000ff"]);
    const ramp = makeRamp();
    // Feature starts with a valid value so applyRampToLayer collects it,
    // but it is mutated before the getter is invoked.
    const features = [{ properties: { value: 5 } }];
    const layer = makeFeatureLayer(features);
    applyRampToLayer(makeUI(layer), "overlay1", ramp);

    features[0].properties.value = NaN;
    intentValues = { fillRamp: ramp };
    expect(pinGetterOf()()).toBeNull();
  });

  it("falls back to the last colour when the class index is out of bounds", () => {
    // Chroma returns one colour for three classes, so classes 1 and 2 take
    // the last available colour.
    installChroma(["#ff0000"]);
    const layer = makeFeatureLayer([
      { properties: { value: 1 } },
      { properties: { value: 5 } },
      { properties: { value: 9 } },
    ]);

    applyRampToLayer(makeUI(layer), "overlay1", makeRamp());

    for (const leaf of layer.leaves) {
      expect(leaf.setStyle).toHaveBeenCalled();
      const call = (leaf.setStyle as any).mock.calls[0][0];
      expect(call.fillColor).toBe("#ff0000");
    }
  });

  it("handles a single-value layer (one class, one colour)", () => {
    installChroma(["#ff0000"]);
    const layer = makeFeatureLayer([{ properties: { value: 42 } }]);

    applyRampToLayer(makeUI(layer), "overlay1", makeRamp({ classes: 5 }));

    expect(layer.leaves[0].setStyle).toHaveBeenCalled();
    expect((layer.leaves[0].setStyle as any).mock.calls[0][0].fillColor).toBe(
      "#ff0000",
    );
  });
});
