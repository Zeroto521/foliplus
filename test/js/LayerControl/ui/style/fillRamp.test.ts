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
    FILL_MODE: "fillMode",
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
    feature: { properties: f.properties, geometry: { type: "Polygon" } },
    options: { fillColor: "#3388ff", fillOpacity: 0.2, fill: true },
    getLatLngs: () => [
      [
        { lat: 0, lng: 0 },
        { lat: 1, lng: 0 },
        { lat: 0, lng: 1 },
      ],
    ],
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

  it("restores the author's face for a leaf whose value is non-finite", () => {
    // A leaf outside the ramp's reach is not left holding a colour the current
    // config cannot justify: it gets the author's face back, which is also how
    // the next apply undoes this one's output.
    installChroma(["#ff0000", "#00ff00", "#0000ff"]);
    const layer = makeFeatureLayer([
      { properties: { value: 1 } },
      { properties: { value: NaN } },
      { properties: { value: Infinity } },
      { properties: { value: "string" } },
    ]);

    applyRampToLayer(makeUI(layer), "overlay1", makeRamp());

    const last = (leaf: (typeof layer.leaves)[number]) =>
      (leaf.setStyle as any).mock.calls.at(-1)![0];
    expect(last(layer.leaves[0]).fillColor).toBe("#ff0000");
    for (const leaf of layer.leaves.slice(1)) {
      expect(last(leaf)).toEqual({
        fillColor: "#3388ff",
        fillOpacity: 0.2,
        fill: true,
      });
    }
  });

  it("warns instead of degrading silently when simple-statistics is absent", () => {
    // The classifier reads one global the whole page shares, so a missing
    // `ss` cannot be fixed by editing the config. A quiet fallback would
    // leave the map at the author's colour while the panel still says
    // "quantile".
    installChroma(["#ff0000", "#00ff00"]);
    delete globalThis.ss;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    // Two values: a single one short-circuits the classifier before the
    // dependency check runs, so no warning would be raised at all.
    const layer = makeFeatureLayer([
      { properties: { value: 5 } },
      { properties: { value: 10 } },
    ]);

    expect(() =>
      applyRampToLayer(
        makeUI(layer),
        "overlay1",
        makeRamp({ method: METHOD.QUANTILE }),
      ),
    ).not.toThrow();

    // The project logger namespaces the message and takes the error as its
    // detail - the same shape every other foliplus warning uses.
    expect(warn.mock.calls[0][0]).toBe("[foliplus] value-based fill:");
    expect((warn.mock.calls[0][1] as Error).message).toContain("simple-statistics");
    // Nothing was classified, so the author's face comes back.
    expect((layer.leaves[0].setStyle as any).mock.calls.at(-1)![0]).toEqual({
      fillColor: "#3388ff",
      fillOpacity: 0.2,
      fill: true,
    });
    warn.mockRestore();
  });

  it("carries the layer-level opacity onto a leaf the ramp cannot classify", () => {
    // fillOpacity is chosen once for the layer, not per class, so a leaf
    // outside the ramp's reach gets it too: the author's colour and
    // visibility come back and the whole layer shares one transparency.
    installChroma(["#ff0000"]);
    intentValues = { fillOpacity: 0.4 };
    const layer = makeFeatureLayer([{ properties: { value: NaN } }]);

    applyRampToLayer(makeUI(layer), "overlay1", makeRamp());

    expect((layer.leaves[0].setStyle as any).mock.calls.at(-1)![0]).toEqual({
      fillColor: "#3388ff",
      fillOpacity: 0.4,
      fill: true,
    });
  });

  it("keeps a line leaf out of the breaks and out of the write walk", () => {
    // A line leaf is not fillable, so its value must not widen the classes
    // and it must receive neither a fill nor a replay pin.
    installChroma(["#ff0000", "#00ff00", "#0000ff"]);
    const line = {
      feature: { properties: { value: 1 }, geometry: { type: "LineString" } },
      options: {},
      setStyle: vi.fn(),
      on: vi.fn(),
      getLatLngs: () => [
        { lat: 0, lng: 0 },
        { lat: 1, lng: 1 },
      ],
    } as any;
    const area = {
      feature: { properties: { value: 1000 }, geometry: { type: "Polygon" } },
      options: { fillColor: "#3388ff", fillOpacity: 0.2, fill: true },
      setStyle: vi.fn(),
      on: vi.fn(),
      getLatLngs: () => [
        [
          { lat: 0, lng: 0 },
          { lat: 1, lng: 0 },
          { lat: 0, lng: 1 },
        ],
      ],
    } as any;
    const layer = {
      eachLayer: (fn: (leaf: unknown) => void) => [line, area].forEach(fn),
      leaves: [line, area],
    } as any;

    applyRampToLayer(makeUI(layer), "overlay1", makeRamp({ classes: 3 }));

    expect(line.setStyle).not.toHaveBeenCalled();
    expect(pinStyleOnHighlight).toHaveBeenCalledTimes(1);
    // Had 1 reached the classifier the two values would have split into two
    // classes and the top value would have drawn the second colour; it drew
    // the first, so it classified alone.
    expect((area.setStyle as any).mock.calls[0][0].fillColor).toBe("#ff0000");
  });

  it("survives a re-entrant apply from another layer", () => {
    // A layer's setStyle can synchronously trigger another layer's ramp
    // apply - a custom Path, a third-party plugin, or an observer hook.
    // Both applies must paint their own values: a shared collection
    // would be cleared by the inner call and the outer one would repaint
    // its surviving leaves with the author's colour.
    installChroma(["#ff0000", "#00ff00", "#0000ff"]);
    const outer = makeFeatureLayer([
      { properties: { value: 1 } },
      { properties: { value: 5 } },
    ]);
    const inner = makeFeatureLayer([
      { properties: { value: 1 } },
      { properties: { value: 9 } },
    ]);
    const ramp = makeRamp({ classes: 2 });
    (outer.leaves[0].setStyle as any).mockImplementation(() => {
      applyRampToLayer(makeUI(inner), "overlay1", ramp);
    });
    applyRampToLayer(makeUI(outer), "overlay1", ramp);
    for (const layer of [outer, inner]) {
      for (const leaf of layer.leaves) {
        expect((leaf.setStyle as any).mock.calls[0][0].fillColor).toBeDefined();
      }
      // Two distinct values, two distinct classes - a cleared collection
      // would have restored the author's colour to the second leaf.
      expect(
        new Set(layer.leaves.map(l => (l.setStyle as any).mock.calls[0][0].fillColor)),
      ).toHaveLength(2);
    }
  });

  it("survives a one-level same-layer recursive apply", () => {
    installChroma(["#ff0000", "#00ff00", "#0000ff"]);
    const layer = makeFeatureLayer([
      { properties: { value: 1 } },
      { properties: { value: 9 } },
    ]);
    const ui = makeUI(layer);
    const ramp = makeRamp({ classes: 2 });
    // One level only - an unbounded same-layer trigger would never return,
    // which is a property of the trigger, not of the apply.
    let depth = 0;
    (layer.leaves[0].setStyle as any).mockImplementation(() => {
      if (depth++ === 0) applyRampToLayer(ui, "overlay1", ramp);
    });
    applyRampToLayer(ui, "overlay1", ramp);
    for (const leaf of layer.leaves) {
      expect(leaf.setStyle).toHaveBeenCalledTimes(2);
      // Both the outer write and the re-entrant one painted a ramp colour
      // for this leaf; a collection cleared by the inner pass would have
      // restored the author's face instead.
      expect((leaf.setStyle as any).mock.calls.at(-1)![0].fillColor).toBeDefined();
    }
  });

  it("leaves no state behind when a write throws", () => {
    // A throw mid-pass must not leave the next apply reading entries from
    // the failed one.
    installChroma(["#ff0000", "#00ff00", "#0000ff"]);
    const layer = makeFeatureLayer([
      { properties: { value: 1 } },
      { properties: { value: 9 } },
    ]);
    const ui = makeUI(layer);
    const ramp = makeRamp({ classes: 2 });
    let throws = true;
    (layer.leaves[1].setStyle as any).mockImplementation(() => {
      if (throws) throw new Error("boom");
    });
    expect(() => applyRampToLayer(ui, "overlay1", ramp)).toThrow("boom");
    throws = false;
    applyRampToLayer(ui, "overlay1", ramp);
    for (const leaf of layer.leaves) {
      expect((leaf.setStyle as any).mock.calls.at(-1)![0].fillColor).toBeDefined();
    }
  });

  it("restores the author's face for a layer with no finite values", () => {
    // Nothing to classify is not "leave everything as it is": if a previous
    // ramp already painted the leaves, that output must be undone, or the map
    // would keep a colour the current config cannot justify.
    installChroma(["#ff0000", "#00ff00", "#0000ff"]);
    const layer = makeFeatureLayer([
      { properties: { value: 1 } },
      { properties: { value: 9 } },
    ]);

    applyRampToLayer(makeUI(layer), "overlay1", makeRamp());
    applyRampToLayer(makeUI(layer), "overlay1", makeRamp({ field: "missing" }));

    // Every painted leaf is back at what the author drew.
    for (const leaf of layer.leaves) {
      expect((leaf.setStyle as any).mock.calls.at(-1)![0]).toEqual({
        fillColor: "#3388ff",
        fillOpacity: 0.2,
        fill: true,
      });
    }
  });

  it("restores a leaf the new field leaves behind", () => {
    // Switching the drive property can orphan leaves: the ones that still have
    // a value get the new colour, the ones that do not go back to the
    // author's face instead of keeping the previous ramp's output.
    installChroma(["#111111", "#222222", "#333333"]);
    const layer = makeFeatureLayer([
      { properties: { value: 1, alt: 1 } },
      { properties: { value: 5, alt: null } },
      { properties: { value: 9, alt: 9 } },
      { properties: { value: 17, alt: 17 } },
    ]);

    applyRampToLayer(makeUI(layer), "overlay1", makeRamp());
    applyRampToLayer(makeUI(layer), "overlay1", makeRamp({ field: "alt" }));

    const last = (leaf: (typeof layer.leaves)[number]) =>
      (leaf.setStyle as any).mock.calls.at(-1)![0];
    expect(last(layer.leaves[0]).fillColor).toBe("#111111");
    expect(last(layer.leaves[2]).fillColor).toBe("#222222");
    expect(last(layer.leaves[3]).fillColor).toBe("#333333");
    expect(last(layer.leaves[1])).toEqual({
      fillColor: "#3388ff",
      fillOpacity: 0.2,
      fill: true,
    });
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

  it("does not throw on a scheme chroma cannot parse", () => {
    // chroma throws on an unknown scheme name instead of returning the shared
    // grey. That throw must not escape the apply walk, which also runs from
    // the replay that fires while the control attaches: one bad record in
    // storage would otherwise leave the whole panel unmounted. The layer gets
    // the author's face back, and no pin is attached for a ramp that could
    // not be built.
    installChroma(["#111111"]);
    const layer = makeFeatureLayer([{ properties: { value: 5 } }]);
    applyRampToLayer(makeUI(layer), "overlay1", makeRamp());

    globalThis.chroma = {
      scale: () => {
        throw new Error("unknown format");
      },
    } as never;

    expect(() =>
      applyRampToLayer(makeUI(layer), "overlay1", makeRamp({ scheme: "bogus-scheme" })),
    ).not.toThrow();
    expect((layer.leaves[0].setStyle as any).mock.calls.at(-1)![0]).toEqual({
      fillColor: "#3388ff",
      fillOpacity: 0.2,
      fill: true,
    });
    // The failed ramp attaches an invalidating pin rather than a repainting
    // one — the previous getter would replay a colour this ramp cannot
    // justify.
    const pinCalls = (pinStyleOnHighlight as ReturnType<typeof vi.fn>).mock.calls;
    expect(pinGetterOf(pinCalls.length - 1)()).toBeNull();
  });

  it("pin stops replaying the ramp once the mode is solid", () => {
    // A mode switch back to solid keeps the ramp config stored — the config is
    // the arm's next-time state, not evidence that the arm is active. The pin
    // must not repaint the ramp on the next mouseout, and it must still
    // replay while the ramp arm is active.
    installChroma(["#ff0000", "#00ff00", "#0000ff"]);
    const ramp = makeRamp();
    const layer = makeFeatureLayer([{ properties: { value: 5 } }]);
    applyRampToLayer(makeUI(layer), "overlay1", ramp);

    intentValues = { fillRamp: ramp, fillMode: "solid" };
    expect(pinGetterOf()()).toBeNull();

    intentValues = { fillRamp: ramp };
    expect(pinGetterOf()()!.fillColor).toBe("#ff0000");
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

  it("replays the live opacity over the author's face for a leaf the ramp cannot classify", () => {
    // The out-of-reach twin of the ramp's own opacity replay: the author's
    // colour and fill flag ride folium's restore untouched, and only the
    // user's opacity is added on top. With none chosen the getter above
    // returns null and the restore stands.
    installChroma(["#ff0000", "#00ff00", "#0000ff"]);
    const ramp = makeRamp();
    const features = [{ properties: { value: 5 } }];
    const layer = makeFeatureLayer(features);
    applyRampToLayer(makeUI(layer), "overlay1", ramp);

    features[0].properties.value = NaN;
    intentValues = { fillRamp: ramp, fillOpacity: 0.3 };
    const out = pinGetterOf()();
    expect(out).not.toBeNull();
    expect(out!.fillColor).toBe("#3388ff");
    expect(out!.fill).toBe(true);
    expect(out!.fillOpacity).toBe(0.3);
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
