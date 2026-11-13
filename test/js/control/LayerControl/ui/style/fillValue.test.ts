// Unit tests for fillValue — value-based fill rendering.
//
// The mutual exclusion logic (Solid ↔ value) is covered in fill.test.ts
// through the FILL_DIMENSION descriptor; applyValueFill is tested here
// directly with mock layers.
import { repoPath } from "#test/path.js";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type StyleMode, type ValueConfig } from "#core/layer/index.js";
import { DEFAULT_SCHEMES, METHOD } from "#core/value/index.js";
import {
  applyValueFill,
  resolveFillMode,
  resolveModeByValue,
  valueSchemeForUi,
} from "#control/LayerControl/ui/style/fillValue.js";
import { pinStyleOnHighlight } from "#control/LayerControl/ui/style/pin.js";
import { resolveStrokeMode } from "#control/LayerControl/ui/style/strokeValue.js";

// A live intent table keyed by the intent-key string, so a test can set the
// value config and the opacity independently — the pin reads both live.
let intentValues: Record<string, unknown> = {};
const mockGetIntent = vi.fn(
  (_ui: unknown, _id: unknown, key: string) => intentValues[key],
);

vi.mock("#control/LayerControl/ui/intent.js", () => ({
  INTENT: {
    FILL_VALUE: "fillValue",
    FILL_OPACITY: "fillOpacity",
    FILL_MODE: "fillStyleMode",
  },
  getIntent: (ui: unknown, id: unknown, key: string) => mockGetIntent(ui, id, key),
}));
vi.mock("#control/LayerControl/ui/style/pin.js", () => ({
  pinStyleOnHighlight: vi.fn(),
}));

/** Install a chroma stub that hands back a fixed color list, whatever
 *  count was requested — used to force the out-of-bounds fallback. The
 *  stub answers both palette shapes: the numeric path calls
 *  `scale().mode().colors(count)`, the categorical path calls
 *  `scale().colors(count)` directly. */
const installChroma = (colors: string[]): void => {
  globalThis.chroma = {
    scale: () => ({
      mode: () => ({ colors: (count: number) => colors.slice(0, count) }),
      colors: (count: number) => colors.slice(0, count),
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

/** Create a minimal mock LayerUI for applyValueFill. */
const makeUI = (layer: unknown) =>
  ({
    c: {
      layerRegistry: new Map([["overlay1", { id: "overlay1", layer }] as any]),
      findLayer: () => layer,
    },
  }) as any;

const makeRamp = (overrides: Partial<ValueConfig> = {}): ValueConfig => ({
  field: "value",
  method: METHOD.EQUAL,
  classes: 3,
  scheme: DEFAULT_SCHEMES[0],
  ...overrides,
});

describe("applyValueFill", () => {
  it("classifies values and writes per-leaf fillColor via commitStyleDim", () => {
    installChroma(["#ff0000", "#00ff00", "#0000ff"]);

    const layer = makeFeatureLayer([
      { properties: { value: 1 } },
      { properties: { value: 5 } },
      { properties: { value: 9 } },
    ]);
    applyValueFill(makeUI(layer), "overlay1", makeRamp());

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

    applyValueFill(makeUI(layer), "overlay1", makeRamp());

    const call = (layer.leaves[0].setStyle as any).mock.calls[0][0];
    expect(call.fillOpacity).toBeUndefined();
  });

  it("carries the solid-mode fillOpacity onto every value leaf", () => {
    installChroma(["#ff0000", "#00ff00", "#0000ff"]);
    intentValues = { fillOpacity: 0.25 };
    const layer = makeFeatureLayer([
      { properties: { value: 1 } },
      { properties: { value: 9 } },
    ]);

    applyValueFill(makeUI(layer), "overlay1", makeRamp());

    for (const leaf of layer.leaves) {
      const call = (leaf.setStyle as any).mock.calls[0][0];
      expect(call.fillOpacity).toBe(0.25);
      expect(call.fillColor).toBeDefined();
    }
  });

  it("restores the author's face for a leaf whose value is non-finite", () => {
    // A leaf outside the value fill's reach is not left holding a color the current
    // config cannot justify: it gets the author's face back, which is also how
    // the next apply undoes this one's output.
    installChroma(["#ff0000", "#00ff00", "#0000ff"]);
    const layer = makeFeatureLayer([
      { properties: { value: 1 } },
      { properties: { value: NaN } },
      { properties: { value: Infinity } },
      { properties: { value: "string" } },
    ]);

    applyValueFill(makeUI(layer), "overlay1", makeRamp());

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
    // leave the map at the author's color while the panel still says
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
      applyValueFill(makeUI(layer), "overlay1", makeRamp({ method: METHOD.QUANTILE })),
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

  it("carries the layer-level opacity onto a leaf the value fill cannot classify", () => {
    // fillOpacity is chosen once for the layer, not per class, so a leaf
    // outside the value fill's reach gets it too: the author's color and
    // visibility come back and the whole layer shares one transparency.
    installChroma(["#ff0000"]);
    intentValues = { fillOpacity: 0.4 };
    const layer = makeFeatureLayer([{ properties: { value: NaN } }]);

    applyValueFill(makeUI(layer), "overlay1", makeRamp());

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

    applyValueFill(makeUI(layer), "overlay1", makeRamp({ classes: 3 }));

    expect(line.setStyle).not.toHaveBeenCalled();
    expect(pinStyleOnHighlight).toHaveBeenCalledTimes(1);
    // Had 1 reached the classifier the two values would have split into two
    // classes and the top value would have drawn the second color; it drew
    // the first, so it classified alone.
    expect((area.setStyle as any).mock.calls[0][0].fillColor).toBe("#ff0000");
  });

  it("survives a re-entrant apply from another layer", () => {
    // A layer's setStyle can synchronously trigger another layer's value fill
    // apply - a custom Path, a third-party plugin, or an observer hook.
    // Both applies must paint their own values: a shared collection
    // would be cleared by the inner call and the outer one would repaint
    // its surviving leaves with the author's color.
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
      applyValueFill(makeUI(inner), "overlay1", ramp);
    });
    applyValueFill(makeUI(outer), "overlay1", ramp);
    for (const layer of [outer, inner]) {
      for (const leaf of layer.leaves) {
        expect((leaf.setStyle as any).mock.calls[0][0].fillColor).toBeDefined();
      }
      // Two distinct values, two distinct classes - a cleared collection
      // would have restored the author's color to the second leaf.
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
      if (depth++ === 0) applyValueFill(ui, "overlay1", ramp);
    });
    applyValueFill(ui, "overlay1", ramp);
    for (const leaf of layer.leaves) {
      expect(leaf.setStyle).toHaveBeenCalledTimes(2);
      // Both the outer write and the re-entrant one painted a value color
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
    expect(() => applyValueFill(ui, "overlay1", ramp)).toThrow("boom");
    throws = false;
    applyValueFill(ui, "overlay1", ramp);
    for (const leaf of layer.leaves) {
      expect((leaf.setStyle as any).mock.calls.at(-1)![0].fillColor).toBeDefined();
    }
  });

  it("restores the author's face for a layer with no finite values", () => {
    // Nothing to classify is not "leave everything as it is": if a previous
    // value fill already painted the leaves, that output must be undone, or the map
    // would keep a color the current config cannot justify.
    installChroma(["#ff0000", "#00ff00", "#0000ff"]);
    const layer = makeFeatureLayer([
      { properties: { value: 1 } },
      { properties: { value: 9 } },
    ]);

    applyValueFill(makeUI(layer), "overlay1", makeRamp());
    applyValueFill(makeUI(layer), "overlay1", makeRamp({ field: "missing" }));

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
    // a value get the new color, the ones that do not go back to the
    // author's face instead of keeping the previous value fill's output.
    installChroma(["#111111", "#222222", "#333333"]);
    const layer = makeFeatureLayer([
      { properties: { value: 1, alt: 1 } },
      { properties: { value: 5, alt: null } },
      { properties: { value: 9, alt: 9 } },
      { properties: { value: 17, alt: 17 } },
    ]);

    applyValueFill(makeUI(layer), "overlay1", makeRamp());
    applyValueFill(makeUI(layer), "overlay1", makeRamp({ field: "alt" }));

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

    expect(() => applyValueFill(ui, "missing", makeRamp())).not.toThrow();
  });

  it("caps classes at the number of available values", () => {
    installChroma(["#ff0000", "#00ff00"]);
    const layer = makeFeatureLayer([
      { properties: { value: 1 } },
      { properties: { value: 2 } },
    ]);

    applyValueFill(makeUI(layer), "overlay1", makeRamp({ classes: 9 }));

    expect(layer.leaves[0].setStyle).toHaveBeenCalled();
    expect(layer.leaves[1].setStyle).toHaveBeenCalled();
  });

  it("does not throw on a scheme chroma cannot parse", () => {
    // chroma throws on an unknown scheme name instead of returning the shared
    // grey. That throw must not escape the apply walk, which also runs from
    // the replay that fires while the control attaches: one bad record in
    // storage would otherwise leave the whole panel unmounted. The layer gets
    // the author's face back, and no pin is attached for a value fill that could
    // not be built.
    installChroma(["#111111"]);
    const layer = makeFeatureLayer([{ properties: { value: 5 } }]);
    applyValueFill(makeUI(layer), "overlay1", makeRamp());

    globalThis.chroma = {
      scale: () => {
        throw new Error("unknown format");
      },
    } as never;

    expect(() =>
      applyValueFill(makeUI(layer), "overlay1", makeRamp({ scheme: "bogus-scheme" })),
    ).not.toThrow();
    expect((layer.leaves[0].setStyle as any).mock.calls.at(-1)![0]).toEqual({
      fillColor: "#3388ff",
      fillOpacity: 0.2,
      fill: true,
    });
    // The failed value fill attaches an invalidating pin rather than a repainting
    // one — the previous getter would replay a color this value fill cannot
    // justify.
    const pinCalls = (pinStyleOnHighlight as ReturnType<typeof vi.fn>).mock.calls;
    expect(pinGetterOf(pinCalls.length - 1)()).toBeNull();
  });

  it("replays the resolved value fill on mouseout when the stored field went stale", () => {
    // Production resolves a stored value field the data no longer offers to the
    // first offered field before painting. The pin guard must resolve the live
    // record the same way: comparing the stale stored name against the resolved
    // config used to fail, so the first mouseout dropped the value color and
    // the leaf fell back to the author's face until the next apply.
    installChroma(["#111111"]);
    const layer = makeFeatureLayer([{ properties: { count: 5 } }]);
    intentValues = { fillValue: makeRamp({ field: "gone" }) };
    const resolveStored = (stored: ValueConfig): ValueConfig => ({
      ...stored,
      field: "count",
    });

    applyValueFill(
      makeUI(layer),
      "overlay1",
      resolveStored(makeRamp({ field: "count" })),
      resolveStored,
    );

    expect((layer.leaves[0].setStyle as any).mock.calls[0][0].fillColor).toBe(
      "#111111",
    );
    // The mouseout replay still owns the leaf: the value color comes back
    // instead of null (which would let folium's resetStyle win).
    expect(pinGetterOf(0)()).toMatchObject({ fillColor: "#111111", fill: true });
  });

  it("falls back to the live intent for the pin when no reader is passed", () => {
    // The 5th argument is the pin's live reader; a caller that omits it gets the
    // intent store itself. Assert the fallback replays — and that it re-reads
    // the store on every fire rather than replaying the value frozen at build
    // time, which is what makes a caller dropping the argument a degradation
    // instead of a silent stale-color bug.
    installChroma(["#111111"]);
    const ramp = makeRamp();
    intentValues = { fillValue: ramp };
    const layer = makeFeatureLayer([{ properties: { value: 5 } }]);

    applyValueFill(makeUI(layer), "overlay1", ramp);

    expect(pinGetterOf(0)()).toMatchObject({ fillColor: "#111111", fill: true });

    // The user picks another class count: the live config no longer matches the
    // breaks this apply cached, so the pin yields to folium's restore until the
    // next scheduler tick repaints.
    intentValues = { fillValue: makeRamp({ classes: 5 }) };
    expect(pinGetterOf(0)()).toBeNull();
  });

  it("reports an unknown method and restores the author's face", () => {
    // isValueConfig rejects an unknown method on read, so this is the
    // defence-in-depth path: a caller that wrote the record directly still
    // gets a report and the author's fill rather than an equal-split guess.
    installChroma(["#ff0000", "#00ff00"]);
    const layer = makeFeatureLayer([
      { properties: { value: 5 } },
      { properties: { value: 10 } },
    ]);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    expect(() =>
      applyValueFill(makeUI(layer), "overlay1", makeRamp({ method: "bogus" as never })),
    ).not.toThrow();

    expect(warn.mock.calls[0][0]).toBe("[foliplus] value-based fill:");
    expect((warn.mock.calls[0][1] as Error).message).toContain(
      "unknown classification method",
    );
    // Nothing was classified, so the author's face comes back.
    expect((layer.leaves[0].setStyle as any).mock.calls.at(-1)![0]).toEqual({
      fillColor: "#3388ff",
      fillOpacity: 0.2,
      fill: true,
    });
    warn.mockRestore();
  });

  describe("the drive property is read through its own boundary", () => {
    // The capability probe admits the leaf; reading its data is the value fill's
    // own job, so a hostile property bag must read as "no value" instead of
    // aborting the layer - and the same read runs again on every highlight
    // replay, where a throw would escape into Leaflet's event dispatch.
    const makeRampLeaf = (areal: "feature" | "radius" = "feature") => {
      const leaf: any = {
        feature: { properties: { value: 5 }, geometry: { type: "Polygon" } },
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
      };
      if (areal === "radius") leaf.getRadius = () => 5;
      return leaf;
    };

    const makeLayer = (...leaves: any[]) => ({
      options: {},
      eachLayer: (fn: (l: unknown) => void) => leaves.forEach(l => fn(l)),
      leaves,
    });

    const authorFace = { fillColor: "#3388ff", fillOpacity: 0.2, fill: true };

    it("treats a throwing feature getter as no value", () => {
      installChroma(["#ff0000", "#00ff00"]);
      const leaf = makeRampLeaf("radius");
      Object.defineProperty(leaf, "feature", {
        get() {
          throw new Error("feature boom");
        },
      });

      expect(() =>
        applyValueFill(makeUI(makeLayer(leaf)), "overlay1", makeRamp()),
      ).not.toThrow();
      expect((leaf.setStyle as any).mock.calls.at(-1)![0]).toEqual(authorFace);
    });

    it("treats a throwing properties getter as no value", () => {
      installChroma(["#ff0000", "#00ff00"]);
      const leaf = makeRampLeaf();
      leaf.feature = Object.defineProperty({}, "properties", {
        get() {
          throw new Error("properties boom");
        },
      });
      leaf.feature.geometry = { type: "Polygon" };

      expect(() =>
        applyValueFill(makeUI(makeLayer(leaf)), "overlay1", makeRamp()),
      ).not.toThrow();
      expect((leaf.setStyle as any).mock.calls.at(-1)![0]).toEqual(authorFace);
    });

    it("treats a throwing field getter as no value", () => {
      installChroma(["#ff0000", "#00ff00"]);
      const leaf = makeRampLeaf();
      const properties = Object.defineProperty({}, "value", {
        get() {
          throw new Error("value boom");
        },
      });
      leaf.feature = { properties, geometry: { type: "Polygon" } };

      expect(() =>
        applyValueFill(makeUI(makeLayer(leaf)), "overlay1", makeRamp()),
      ).not.toThrow();
      expect((leaf.setStyle as any).mock.calls.at(-1)![0]).toEqual(authorFace);
    });

    it("keeps classifying the healthy siblings of a hostile leaf", () => {
      // The whole point of the narrow boundary: one unreadable leaf must not
      // strand the rest of the layer uncoloured.
      installChroma(["#ff0000", "#00ff00"]);
      const hostile = makeRampLeaf();
      hostile.feature = Object.defineProperty({}, "properties", {
        get() {
          throw new Error("properties boom");
        },
      });
      hostile.feature.geometry = { type: "Polygon" };
      const healthy = makeRampLeaf();
      healthy.feature = { properties: { value: 9 }, geometry: { type: "Polygon" } };

      expect(() =>
        applyValueFill(makeUI(makeLayer(hostile, healthy)), "overlay1", makeRamp()),
      ).not.toThrow();

      expect(healthy.setStyle).toHaveBeenCalled();
      expect((healthy.setStyle as any).mock.calls[0][0].fillColor).toBeDefined();
      expect((hostile.setStyle as any).mock.calls.at(-1)![0]).toEqual(authorFace);
    });

    it("does not throw from a highlight replay once the field turns hostile", () => {
      installChroma(["#ff0000", "#00ff00"]);
      let explode = false;
      const properties = Object.defineProperty({}, "value", {
        get() {
          if (explode) throw new Error("value boom");
          return 5;
        },
      });
      const leaf = makeRampLeaf();
      leaf.feature = { properties, geometry: { type: "Polygon" } };
      applyValueFill(makeUI(makeLayer(leaf)), "overlay1", makeRamp());
      const replay = pinGetterOf();

      explode = true;
      expect(() => replay()).not.toThrow();
      // No user opacity was chosen, so the author's restored face stands.
      expect(replay()).toBeNull();
    });
  });

  it("pin stops replaying the value fill once the mode is solid", () => {
    // A mode switch back to solid keeps the value config stored — the config is
    // the mode's next-time state, not evidence that the mode is active. The pin
    // must not repaint the value fill on the next mouseout, and it must still
    // replay while the value mode is active.
    installChroma(["#ff0000", "#00ff00", "#0000ff"]);
    const ramp = makeRamp();
    const layer = makeFeatureLayer([{ properties: { value: 5 } }]);
    applyValueFill(makeUI(layer), "overlay1", ramp);

    intentValues = { fillValue: ramp, fillStyleMode: "solid" };
    expect(pinGetterOf()()).toBeNull();

    intentValues = { fillValue: ramp };
    expect(pinGetterOf()()!.fillColor).toBe("#ff0000");
  });

  it("pin getter returns null when the value intent is cleared", () => {
    installChroma(["#ff0000", "#00ff00", "#0000ff"]);
    const layer = makeFeatureLayer([{ properties: { value: 5 } }]);
    applyValueFill(makeUI(layer), "overlay1", makeRamp());

    expect(pinGetterOf()()).toBeNull();
  });

  it("pin getter returns null when the config changed since the cache build", () => {
    installChroma(["#ff0000", "#00ff00", "#0000ff"]);
    const ramp = makeRamp();
    const layer = makeFeatureLayer([{ properties: { value: 5 } }]);
    applyValueFill(makeUI(layer), "overlay1", ramp);

    // Getter sees a different value config under each key — the cached breaks no
    // longer describe the live config, so the author's face stays in force.
    for (const [key, value] of [
      ["field", "otherField"],
      ["method", METHOD.QUANTILE],
      ["classes", 5],
      ["scheme", DEFAULT_SCHEMES[1]],
    ]) {
      intentValues = { fillValue: { ...ramp, [key]: value } };
      expect(pinGetterOf()()).toBeNull();
    }
  });

  it("pin getter returns a color payload when the config matches", () => {
    installChroma(["#ff0000", "#00ff00", "#0000ff"]);
    const ramp = makeRamp();
    const layer = makeFeatureLayer([{ properties: { value: 5 } }]);
    applyValueFill(makeUI(layer), "overlay1", ramp);

    intentValues = { fillValue: ramp };
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
    applyValueFill(makeUI(layer), "overlay1", ramp);

    const colorOf = (n: number) =>
      (layer.leaves[n].setStyle as any).mock.calls[0][0].fillColor as string;
    expect(colorOf(0)).toBe("#ff0000");
    expect(colorOf(1)).toBe("#00ff00");
    expect(colorOf(2)).toBe("#0000ff");
    intentValues = { fillValue: makeRamp() };
    expect(pinGetterOf()()).not.toBeNull();
  });

  it("invalidates the pin when the kind points at the categorical mode", () => {
    // The categorical mode is a later batch and builds its breaks differently,
    // so a same-named config typed for it must not repaint off a numeric
    // cache — the pin-side twin of the persistence reader dropping such a
    // record whole. The type cannot spell the value yet, hence the cast.
    installChroma(["#ff0000", "#00ff00", "#0000ff"]);
    const ramp = makeRamp();
    const layer = makeFeatureLayer([{ properties: { value: 5 } }]);
    applyValueFill(makeUI(layer), "overlay1", ramp);

    intentValues = {
      fillValue: { ...ramp, kind: "categorical" } as unknown as ValueConfig,
    };
    expect(pinGetterOf()()).toBeNull();
  });

  it("pin replays the live fillOpacity, not the value frozen at build time", () => {
    installChroma(["#ff0000", "#00ff00", "#0000ff"]);
    const ramp = makeRamp();
    const layer = makeFeatureLayer([{ properties: { value: 5 } }]);

    // Build with no opacity, then choose one afterwards.
    applyValueFill(makeUI(layer), "overlay1", ramp);

    intentValues = { fillValue: ramp, fillOpacity: 0.4 };
    expect(pinGetterOf()()!.fillOpacity).toBe(0.4);
  });

  it("pin getter returns null when the live value is non-finite", () => {
    installChroma(["#ff0000", "#00ff00", "#0000ff"]);
    const ramp = makeRamp();
    // Feature starts with a valid value so applyValueFill collects it,
    // but it is mutated before the getter is invoked.
    const features = [{ properties: { value: 5 } }];
    const layer = makeFeatureLayer(features);
    applyValueFill(makeUI(layer), "overlay1", ramp);

    features[0].properties.value = NaN;
    intentValues = { fillValue: ramp };
    expect(pinGetterOf()()).toBeNull();
  });

  it("replays the live opacity over the author's face for a leaf the value fill cannot classify", () => {
    // The out-of-reach twin of the value fill's own opacity replay: the author's
    // color and fill flag ride folium's restore untouched, and only the
    // user's opacity is added on top. With none chosen the getter above
    // returns null and the restore stands.
    installChroma(["#ff0000", "#00ff00", "#0000ff"]);
    const ramp = makeRamp();
    const features = [{ properties: { value: 5 } }];
    const layer = makeFeatureLayer(features);
    applyValueFill(makeUI(layer), "overlay1", ramp);

    features[0].properties.value = NaN;
    intentValues = { fillValue: ramp, fillOpacity: 0.3 };
    const out = pinGetterOf()();
    expect(out).not.toBeNull();
    expect(out!.fillColor).toBe("#3388ff");
    expect(out!.fill).toBe(true);
    expect(out!.fillOpacity).toBe(0.3);
  });

  it("falls back to the last color when the class index is out of bounds", () => {
    // Chroma returns one color for three classes, so classes 1 and 2 take
    // the last available color.
    installChroma(["#ff0000"]);
    const layer = makeFeatureLayer([
      { properties: { value: 1 } },
      { properties: { value: 5 } },
      { properties: { value: 9 } },
    ]);

    applyValueFill(makeUI(layer), "overlay1", makeRamp());

    for (const leaf of layer.leaves) {
      expect(leaf.setStyle).toHaveBeenCalled();
      const call = (leaf.setStyle as any).mock.calls[0][0];
      expect(call.fillColor).toBe("#ff0000");
    }
  });

  it("handles a single-value layer (one class, one color)", () => {
    installChroma(["#ff0000"]);
    const layer = makeFeatureLayer([{ properties: { value: 42 } }]);

    applyValueFill(makeUI(layer), "overlay1", makeRamp({ classes: 5 }));

    expect(layer.leaves[0].setStyle).toHaveBeenCalled();
    expect((layer.leaves[0].setStyle as any).mock.calls[0][0].fillColor).toBe(
      "#ff0000",
    );
  });

  it("paints categorical values by their label under a qualitative scheme", () => {
    // The category mode: a string column is classified by distinct label, not
    // by numeric breaks. First-seen order maps each label to the scheme's
    // next discrete color (Set3 here, via the chroma stub's fixed list).
    installChroma(["#e41a1c", "#377eb8", "#4daf4a"]);
    const layer = makeFeatureLayer([
      { properties: { kind: "forest" } },
      { properties: { kind: "water" } },
      { properties: { kind: "forest" } },
      { properties: { kind: "urban" } },
    ]);
    const ramp = makeRamp({ kind: "category", field: "kind" });

    applyValueFill(makeUI(layer), "overlay1", ramp);

    const colors = layer.leaves.map(
      leaf => (leaf.setStyle as any).mock.calls[0][0].fillColor as string,
    );
    // forest is first-seen, water second, urban third — the duplicate
    // forest leaf shares its label's color.
    expect(colors[0]).toBe("#e41a1c");
    expect(colors[1]).toBe("#377eb8");
    expect(colors[2]).toBe("#e41a1c");
    expect(colors[3]).toBe("#4daf4a");
  });

  it("falls back to the shared other color for a category outside the domain", () => {
    // buildCategoryRamp's `other` is the fallback grey; a label never seen
    // during the collect walk (e.g. added after the first apply) paints it.
    installChroma(["#e41a1c", "#377eb8"]);
    const layer = makeFeatureLayer([{ properties: { kind: "forest" } }]);
    applyValueFill(
      makeUI(layer),
      "overlay1",
      makeRamp({ kind: "category", field: "kind" }),
    );

    layer.leaves[0].feature.properties.kind = "mystery";
    intentValues = { fillValue: makeRamp({ kind: "category", field: "kind" }) };
    const out = pinGetterOf()();
    expect(out).not.toBeNull();
    expect(out!.fillColor).toBe("#999");
  });

  it("leaves a category leaf with a non-string value out of the value fill's reach", () => {
    // isCategoryValue accepts only a non-empty string, so a numeric or null
    // property is not painted: the author's face comes back, the same rule
    // the numeric mode applies to a non-finite value.
    installChroma(["#e41a1c"]);
    const layer = makeFeatureLayer([
      { properties: { kind: "forest" } },
      { properties: { kind: 42 } },
      { properties: { kind: null } },
    ]);
    applyValueFill(
      makeUI(layer),
      "overlay1",
      makeRamp({ kind: "category", field: "kind" }),
    );

    const last = (leaf: (typeof layer.leaves)[number]) =>
      (leaf.setStyle as any).mock.calls.at(-1)![0];
    expect(last(layer.leaves[0]).fillColor).toBe("#e41a1c");
    for (const leaf of layer.leaves.slice(1)) {
      expect(last(leaf).fillColor).toBe("#3388ff");
    }
  });

  it("replays a categorical color from the pin for a label in the domain", () => {
    installChroma(["#e41a1c", "#377eb8"]);
    const layer = makeFeatureLayer([{ properties: { kind: "water" } }]);
    const ramp = makeRamp({ kind: "category", field: "kind" });
    applyValueFill(makeUI(layer), "overlay1", ramp);

    intentValues = { fillValue: ramp };
    const out = pinGetterOf()();
    expect(out).not.toBeNull();
    // One distinct label takes palette[0] (first-seen order).
    expect(out!.fillColor).toBe("#e41a1c");
    expect(out!.fill).toBe(true);
  });
  it("restores the author's face when a category value fill has no valid labels", () => {
    // The paint ternary's `: undefined` mode for the category branch when the
    // scale itself is null: no leaf offers a valid categorical label (numbers,
    // null, an empty string), so buildCategoryRamp yields no colors, catScale
    // stays null, and every leaf's paint is undefined — the author's face
    // comes back, the same rule the numeric mode applies to an all-invalid
    // field.
    installChroma(["#e41a1c"]);
    const layer = makeFeatureLayer([
      { properties: { kind: 42 } },
      { properties: { kind: null } },
      { properties: { kind: "" } },
    ]);
    applyValueFill(
      makeUI(layer),
      "overlay1",
      makeRamp({ kind: "category", field: "kind" }),
    );

    for (const leaf of layer.leaves) {
      const last = (leaf.setStyle as any).mock.calls.at(-1)![0];
      expect(last.fillColor).toBe("#3388ff");
    }
  });

  it("paints boolean values as categorical labels", () => {
    // The collection predicate was widened to booleans: a boolean column is
    // a categorical field, so each distinct value stringifies to its label
    // ("true" / "false") and paints by first-seen order like any string
    // label — the boolean is a label, not a number.
    installChroma(["#e41a1c", "#377eb8"]);
    const layer = makeFeatureLayer([
      { properties: { ok: true } },
      { properties: { ok: false } },
      { properties: { ok: true } },
    ]);
    applyValueFill(
      makeUI(layer),
      "overlay1",
      makeRamp({ kind: "category", field: "ok" }),
    );

    const colors = layer.leaves.map(
      leaf => (leaf.setStyle as any).mock.calls[0][0].fillColor as string,
    );
    expect(colors[0]).toBe("#e41a1c");
    expect(colors[1]).toBe("#377eb8");
    expect(colors[2]).toBe("#e41a1c");
  });

  it("replays nothing for a category leaf whose value is not a string label", () => {
    // The pin reads the live leaf value: a category leaf carrying a number
    // (or null / empty string) has no label, so the getter yields null and
    // the author's face stays — the same rule the paint pass applies, so a
    // mouseout cannot invent a color for a valueless sibling of an otherwise
    // valid category column.
    installChroma(["#e41a1c", "#377eb8"]);
    const layer = makeFeatureLayer([
      { properties: { kind: "forest" } },
      { properties: { kind: 42 } },
    ]);
    const ramp = makeRamp({ kind: "category", field: "kind" });
    applyValueFill(makeUI(layer), "overlay1", ramp);

    intentValues = { fillValue: ramp };
    // Leaf 0 is an in-domain label; leaf 1 is a number — categoryLabel reads
    // "no label", so its pin getter yields null rather than a fallback color.
    expect(pinGetterOf(1)()).toBeNull();
  });
});

describe("resolveFillMode", () => {
  it("returns SOLID when no value config and no stored mode", () => {
    // No fillMode intent, value undefined → the solid mode owns the fill.
    intentValues = {};
    expect(resolveFillMode(makeUI({}), "overlay1", undefined)).toBe("solid");
  });

  it("returns VALUE when a value config is present and no stored mode", () => {
    intentValues = {};
    expect(resolveFillMode(makeUI({}), "overlay1", makeRamp())).toBe("value");
  });

  it("prefers a stored fillMode over the value-based inference", () => {
    intentValues = { fillStyleMode: "original" };
    expect(resolveFillMode(makeUI({}), "overlay1", makeRamp())).toBe("original");
  });
});

describe("valueSchemeForUi", () => {
  it("keeps a stored scheme the vocabulary offers (P2-1)", () => {
    expect(
      valueSchemeForUi({
        kind: "numeric",
        field: "x",
        method: "equal",
        classes: 3,
        scheme: "Viridis",
      }),
    ).toBe("Viridis");
    expect(
      valueSchemeForUi({
        kind: "category",
        field: "x",
        method: "equal",
        classes: 3,
        scheme: "Set3",
      }),
    ).toBe("Set3");
  });

  it("falls a sequential name back to the sequential default on a numeric record (P2-1)", () => {
    expect(
      valueSchemeForUi({
        kind: "numeric",
        field: "x",
        method: "equal",
        classes: 3,
        scheme: "Set3",
      }),
    ).toBe("Viridis");
  });

  it("falls a qualitative name back to the qualitative default on a category record (P2-1)", () => {
    expect(
      valueSchemeForUi({
        kind: "category",
        field: "x",
        method: "equal",
        classes: 3,
        scheme: "Viridis",
      }),
    ).toBe("Set3");
  });
});
// ─────────────────────────────────────────────────────────────────────────────
// mode resolution migration contract — shared mode resolver (S1) and convergence
// symbols. The original concept-name contract file was split by module (per
// user rule: name tests after the logic under test): fillValue.test.ts owns
// the fill side + the shared resolveModeByValue; strokeValue.test.ts owns the
// stroke side; styleBag.test.ts owns solidColorOf.
// ─────────────────────────────────────────────────────────────────────────────

/** Read a tracked source file with normalized line endings. */
const sourceOf = (rel: string): string =>
  readFileSync(resolve(repoPath(), rel), "utf-8").replace(/\r\n/g, "\n");

/** Whether a module exports a name (inline or trailing export block). */
const isExported = (source: string, name: string): boolean => {
  if (new RegExp(`export\\s+(?:function|const|class)\\s+${name}\\b`).test(source)) {
    return true;
  }
  const block = source.match(/export\s*\{([^}]*)\}/);
  if (block) {
    return new RegExp(`\\b${name}\\b`).test(block[1]);
  }
  return false;
};

// The 6 (mode, value) combinations the shared resolver must answer identically
// for the fill face and the stroke face.
const PARITY: Array<{
  mode: StyleMode | undefined;
  hasValue: boolean;
  expect: StyleMode;
}> = [
  { mode: undefined, hasValue: false, expect: "solid" },
  { mode: undefined, hasValue: true, expect: "value" },
  { mode: "solid", hasValue: false, expect: "solid" },
  { mode: "solid", hasValue: true, expect: "solid" },
  { mode: "value", hasValue: false, expect: "value" },
  { mode: "original", hasValue: true, expect: "original" },
];

// The convergence symbol not exported until S4 is imported lazily so this file
// compiles before the migration lands; the B0 source guard is the real
// criterion (a missing export is RED, not skipped).
let effectiveFaceValue:
  | ((
      ui: unknown,
      layerId: string,
      face: "fill" | "stroke",
      opts?: { allowDeclared?: boolean },
    ) => ValueConfig | undefined)
  | undefined;
try {
  const mod = (await import("#control/LayerControl/ui/style/fillValue.js")) as Record<
    string,
    unknown
  >;
  if (typeof mod.effectiveFaceValue === "function") {
    effectiveFaceValue = mod.effectiveFaceValue as never;
  }
} catch {
  /* not exported yet — B0 catches a missing export without depending on this */
}

describe("mode resolution contract — fill side (Section A: must stay green)", () => {
  it("fill and stroke agree on every shared (mode, value) pair", () => {
    for (const { mode, hasValue, expect: expected } of PARITY) {
      intentValues = {};
      const value = hasValue ? makeRamp() : undefined;
      if (mode !== undefined) intentValues = { fillStyleMode: mode };
      expect(resolveFillMode(makeUI({}), "overlay1", value)).toBe(expected);
      expect(resolveStrokeMode(mode, value)).toBe(expected);
    }
  });

  it("a stored fill mode always wins over the value inference (fill side)", () => {
    intentValues = { fillStyleMode: "original" };
    expect(resolveFillMode(makeUI({}), "overlay1", makeRamp())).toBe("original");
  });

  it("no stored mode + no value config resolves to solid on both faces", () => {
    intentValues = {};
    expect(resolveFillMode(makeUI({}), "overlay1", undefined)).toBe("solid");
    expect(resolveStrokeMode(undefined, undefined)).toBe("solid");
  });
});

describe("mode resolution contract — fill side (Section B: migration criteria)", () => {
  it("source files export the convergence symbols (unskippable)", () => {
    const fillValue = sourceOf(
      "foliplus/js/control/LayerControl/ui/style/fillValue.ts",
    );
    expect(isExported(fillValue, "resolveModeByValue"), "resolveModeByValue").toBe(
      true,
    );
  });

  it("resolveModeByValue reproduces every parity row (S1)", () => {
    for (const { mode, hasValue, expect: expected } of PARITY) {
      expect(resolveModeByValue(mode, hasValue ? makeRamp() : undefined)).toBe(
        expected,
      );
    }
  });

  it("resolveModeByValue matches the live fill resolver on every row (S1)", () => {
    for (const { mode, hasValue } of PARITY) {
      intentValues = {};
      if (mode !== undefined) intentValues = { fillStyleMode: mode };
      const value = hasValue ? makeRamp() : undefined;
      expect(resolveModeByValue(mode, value)).toBe(
        resolveFillMode(makeUI({}), "overlay1", value),
      );
    }
  });

  it.skipIf(!effectiveFaceValue)(
    "effectiveFaceValue keeps fill's declared fallback and stroke's stored-only semantics",
    () => {
      // Four-cell truth table: (stored, declared) × allowDeclared.
      const stored = makeRamp({ field: "storedCol" });
      const layer = { options: { foliplus: { fill: { field: "declaredCol" } } } };
      const ui = () =>
        ({ c: { layerRegistry: new Map(), findLayer: () => layer } }) as any;

      // Cell 1 + 2: stored present, declared present.
      intentValues = { fillValue: stored };
      expect(
        effectiveFaceValue!(ui(), "overlay1", "fill", { allowDeclared: true }),
      ).toEqual(stored);
      expect(
        effectiveFaceValue!(ui(), "overlay1", "stroke", { allowDeclared: false }),
      ).toEqual(stored);
      // Cell 3 + 4: no stored, declared present.
      intentValues = {};
      const fill = effectiveFaceValue!(ui(), "overlay1", "fill", {
        allowDeclared: true,
      });
      expect(fill).toEqual(expect.objectContaining({ field: "declaredCol" }));
      expect(
        effectiveFaceValue!(ui(), "overlay1", "stroke", { allowDeclared: false }),
      ).toBeUndefined();
      // Cell 5: stored present, no declared.
      intentValues = { fillValue: stored };
      const noDeclared = {
        c: { layerRegistry: new Map(), findLayer: () => ({ options: {} }) },
      } as any;
      expect(
        effectiveFaceValue!(noDeclared, "overlay1", "fill", {
          allowDeclared: true,
        }),
      ).toEqual(stored);
      expect(
        effectiveFaceValue!(noDeclared, "overlay1", "stroke", {
          allowDeclared: false,
        }),
      ).toEqual(stored);
    },
  );
});
