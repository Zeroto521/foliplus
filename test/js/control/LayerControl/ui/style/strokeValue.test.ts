// Unit tests for strokeValue — value-based stroke rendering.
//
// The dimension wiring (solid ↔ value on the border row) is covered in the
// border-dimension tests through the descriptor; applyValueStroke is tested
// here directly with mock layers. The engine is deliberately decoupled from
// the intent store: the caller supplies the live ramp / mode readers, so
// this slice adds no persistence or intent-key edits.
import { afterEach, describe, expect, it, vi } from "vitest";
import { METHOD } from "#core/value/classify.js";
import type { FillMode, FillValueConfig } from "#core/layer/intent.js";
import { DEFAULT_SCHEMES } from "#core/value/palette.js";
import { pinStyleOnHighlight } from "#control/LayerControl/ui/style/pin.js";
import {
  applyValueStroke,
  resolveStrokeMode,
} from "#control/LayerControl/ui/style/strokeValue.js";
import { paintByValue } from "#control/LayerControl/ui/style/valuePaint.js";

vi.mock("#control/LayerControl/ui/style/pin.js", () => ({
  pinStyleOnHighlight: vi.fn(),
}));
vi.mock("#control/LayerControl/ui/style/valuePaint.js", async importOriginal => {
  const actual =
    await importOriginal<
      typeof import("#control/LayerControl/ui/style/valuePaint.js")
    >();
  return {
    ...actual,
    paintByValue: vi.fn(actual.paintByValue),
  };
});

/** Install a chroma stub that hands back a fixed color list, whatever
 *  count was requested — used to force the out-of-bounds fallback. */
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
  vi.clearAllMocks();
});

/** Create a mock leaf with a vector style bag — the stroke face the engine
 *  writes (color / weight / stroke), plus the author's fill face to assert
 *  it is never touched. Geometry defaults to Polygon; a caller overrides it
 *  for the mixed-geometry case. */
const makeLeaf = (
  feature: { properties: Record<string, unknown>; geometry?: { type: string } },
  style: { color?: string; weight?: number; stroke?: boolean } = {},
) => ({
  feature: {
    properties: feature.properties,
    geometry: feature.geometry ?? { type: "Polygon" },
  },
  options: {
    color: style.color ?? "#ff0000",
    weight: style.weight ?? 2,
    stroke: style.stroke ?? true,
    fillColor: "#3388ff",
    fillOpacity: 0.2,
    fill: true,
  },
  getLatLngs: () => [
    [
      { lat: 0, lng: 0 },
      { lat: 1, lng: 0 },
      { lat: 0, lng: 1 },
    ],
  ],
  setStyle: vi.fn(),
  on: vi.fn(),
});

/** A layer wrapper: group-like (eachLayer) so walkLeaf recurses into it. */
const makeLayer = (...leaves: ReturnType<typeof makeLeaf>[]) => ({
  eachLayer: (fn: (l: unknown) => void) => leaves.forEach(l => fn(l)),
  leaves,
});

/** Create a minimal mock LayerUI for applyValueStroke. */
const makeUI = (layer: unknown) =>
  ({
    c: {
      layerRegistry: new Map([["overlay1", { id: "overlay1", layer }] as any]),
      findLayer: () => layer,
    },
  }) as any;

const makeRamp = (overrides: Partial<FillValueConfig> = {}): FillValueConfig => ({
  field: "value",
  method: METHOD.EQUAL,
  classes: 3,
  scheme: DEFAULT_SCHEMES[0],
  ...overrides,
});

const liveValueOf = (ramp: FillValueConfig | undefined) => () => ramp;
const liveModeOf = (mode: FillMode | undefined) => () => mode;

describe("resolveStrokeMode", () => {
  it("prefers an explicit mode over a stored ramp", () => {
    expect(resolveStrokeMode("solid", makeRamp())).toBe("solid");
    expect(resolveStrokeMode("value", makeRamp())).toBe("value");
  });

  it("infers value from a stored ramp when no mode is stored", () => {
    expect(resolveStrokeMode(undefined, makeRamp())).toBe("value");
  });

  it("defaults to solid when neither is stored", () => {
    expect(resolveStrokeMode(undefined, undefined)).toBe("solid");
  });
});

describe("applyValueStroke", () => {
  it("delegates the whole paint to the shared paintByValue skeleton", () => {
    // The single-source convergence contract (P1): the stroke arm must not
    // rebuild the collect/ramp/write/pin machinery — it assembles a
    // ValueFaceDecl and calls paintByValue, so a change to the shared
    // mode lands on both the fill and the stroke arm from one place.
    installChroma(["#ff0000", "#00ff00", "#0000ff"]);
    const layer = makeLayer(makeLeaf({ properties: { value: 5 } }));
    const ramp = makeRamp();
    applyValueStroke(
      makeUI(layer),
      "overlay1",
      ramp,
      undefined,
      liveValueOf(ramp),
      liveModeOf("value"),
    );
    expect(paintByValue).toHaveBeenCalledTimes(1);
    // The declaration tells the shared mode the stroke face: DIM.BORDER + the
    // stroke face + the color slot + the style-leaf walker.
    const [ui, layerId, value, decl] = (paintByValue as ReturnType<typeof vi.fn>).mock
      .calls[0];
    expect(ui).toBeDefined();
    expect(layerId).toBe("overlay1");
    expect(value).toEqual(ramp);
    expect(decl.colorKey).toBe("color");
    expect(decl.walkLeaves).toBeDefined();
    // The shared mode wrote through commitStyleDim (the paint path ran).
    expect(layer.leaves[0].setStyle).toHaveBeenCalled();
  });

  it("reaches line leaves as well as area leaves (walkStyleLeaves, not walkFillLeaves)", () => {
    // The semantic difference between the stroke walker and the fill walker:
    // a Polyline owns a setStyle but is not areal, so walkFillLeaves would
    // skip it and the border would never paint a line's stroke. The value
    // stroke must reach both geometries — one walk, no geometry filter.
    installChroma(["#ff0000", "#00ff00"]);
    const line = makeLeaf(
      { properties: { value: 1 }, geometry: { type: "LineString" } },
      { color: "#111111" },
    );
    const area = makeLeaf({ properties: { value: 9 } });
    const layer = makeLayer(line, area);
    applyValueStroke(
      makeUI(layer),
      "overlay1",
      makeRamp({ classes: 2 }),
      undefined,
      liveValueOf(makeRamp({ classes: 2 })),
      liveModeOf("value"),
    );
    // Both leaves painted — the line leaf's color is the ramp's first class.
    expect((line.setStyle as any).mock.calls[0][0].color).toBe("#ff0000");
    expect((area.setStyle as any).mock.calls[0][0].color).toBe("#00ff00");
  });

  it("classifies values and writes per-leaf color via commitStyleDim", () => {
    installChroma(["#ff0000", "#00ff00", "#0000ff"]);
    const layer = makeLayer(
      makeLeaf({ properties: { value: 1 } }),
      makeLeaf({ properties: { value: 5 } }),
      makeLeaf({ properties: { value: 9 } }),
    );
    applyValueStroke(
      makeUI(layer),
      "overlay1",
      makeRamp(),
      undefined,
      liveValueOf(makeRamp()),
      liveModeOf("value"),
    );

    for (const leaf of layer.leaves) {
      expect(leaf.setStyle).toHaveBeenCalled();
      const call = (leaf.setStyle as any).mock.calls[0][0];
      expect(call.color).toBeDefined();
      expect(call.stroke).toBe(true);
    }
    const colors = layer.leaves.map(
      leaf => (leaf.setStyle as any).mock.calls[0][0].color as string,
    );
    expect(new Set(colors).size).toBe(3);
  });

  it("reaches line leaves too (no geometry filter)", () => {
    // walkStyleLeaves carries no geometry predicate: a Polyline leaf owns a
    // setStyle but is not areal, so the stroke arm must still paint it.
    installChroma(["#ff0000", "#00ff00", "#0000ff"]);
    const line = makeLeaf(
      { properties: { value: 1 }, geometry: { type: "LineString" } },
      { color: "#111111" },
    );
    const layer = makeLayer(line);
    applyValueStroke(
      makeUI(layer),
      "overlay1",
      makeRamp(),
      undefined,
      liveValueOf(makeRamp()),
      liveModeOf("value"),
    );

    expect(line.setStyle).toHaveBeenCalled();
    expect((line.setStyle as any).mock.calls[0][0].color).toBe("#ff0000");
  });

  it("paints both leaves of a mixed-geometry layer and touches neither fillColor", () => {
    // 建议4: an L.GeoJSON with BOTH a Polyline and a Polygon — the value
    // stroke writes color on both, and never touches fillColor on either
    // (face scoping: the stroke face owns color/weight/stroke only).
    installChroma(["#ff0000", "#00ff00"]);
    const line = makeLeaf(
      { properties: { value: 1 }, geometry: { type: "LineString" } },
      { color: "#111111", stroke: true },
    );
    const area = makeLeaf({ properties: { value: 9 } });
    const layer = makeLayer(line, area);
    applyValueStroke(
      makeUI(layer),
      "overlay1",
      makeRamp({ classes: 2 }),
      undefined,
      liveValueOf(makeRamp({ classes: 2 })),
      liveModeOf("value"),
    );

    for (const leaf of layer.leaves) {
      expect((leaf.setStyle as any).mock.calls[0][0].color).toBeDefined();
      expect((leaf.setStyle as any).mock.calls[0][0].fillColor).toBeUndefined();
    }
    expect((line.setStyle as any).mock.calls[0][0].color).toBe("#ff0000");
    expect((area.setStyle as any).mock.calls[0][0].color).toBe("#00ff00");
  });

  it("lights the stroke visibility bit on a paintable leaf (write contract)", () => {
    // An author who declared stroke:false must not swallow the user's value
    // stroke: commitStyleDim always lights the face bit.
    installChroma(["#ff0000"]);
    const leaf = makeLeaf({ properties: { value: 5 } }, { stroke: false });
    const layer = makeLayer(leaf);
    applyValueStroke(
      makeUI(layer),
      "overlay1",
      makeRamp(),
      undefined,
      liveValueOf(makeRamp()),
      liveModeOf("value"),
    );

    const call = (leaf.setStyle as any).mock.calls[0][0];
    expect(call.color).toBe("#ff0000");
    expect(call.stroke).toBe(true);
  });

  it("keeps the author's stroke flag for a leaf outside the value reach", () => {
    // commitStyleDimMerged with lightFace=false re-derives the author's
    // face: the stroke flag comes back, not a forced-on bit.
    installChroma(["#ff0000"]);
    const leaf = makeLeaf(
      { properties: { value: NaN } },
      { color: "#111111", weight: 3, stroke: false },
    );
    const layer = makeLayer(leaf);
    applyValueStroke(
      makeUI(layer),
      "overlay1",
      makeRamp(),
      undefined,
      liveValueOf(makeRamp()),
      liveModeOf("value"),
    );

    expect((leaf.setStyle as any).mock.calls[0][0]).toEqual({
      color: "#111111",
      weight: 3,
      stroke: false,
    });
  });

  it("restores the author's face for a leaf whose value is non-finite", () => {
    installChroma(["#ff0000", "#00ff00", "#0000ff"]);
    const layer = makeLayer(
      makeLeaf({ properties: { value: 1 } }),
      makeLeaf({ properties: { value: NaN } }),
      makeLeaf({ properties: { value: Infinity } }),
      makeLeaf({ properties: { value: "string" } }),
    );
    applyValueStroke(
      makeUI(layer),
      "overlay1",
      makeRamp(),
      undefined,
      liveValueOf(makeRamp()),
      liveModeOf("value"),
    );

    const last = (leaf: (typeof layer.leaves)[number]) =>
      (leaf.setStyle as any).mock.calls.at(-1)![0];
    expect(last(layer.leaves[0]).color).toBe("#ff0000");
    for (const leaf of layer.leaves.slice(1)) {
      expect(last(leaf)).toEqual({
        color: "#ff0000",
        weight: 2,
        stroke: true,
      });
    }
  });

  it("restores the author's face for a layer with no finite values", () => {
    installChroma(["#ff0000", "#00ff00", "#0000ff"]);
    const layer = makeLayer(
      makeLeaf({ properties: { value: 1 } }),
      makeLeaf({ properties: { value: 9 } }),
    );
    applyValueStroke(
      makeUI(layer),
      "overlay1",
      makeRamp(),
      undefined,
      liveValueOf(makeRamp()),
      liveModeOf("value"),
    );
    applyValueStroke(
      makeUI(layer),
      "overlay1",
      makeRamp({ field: "missing" }),
      undefined,
      liveValueOf(makeRamp({ field: "missing" })),
      liveModeOf("value"),
    );

    for (const leaf of layer.leaves) {
      expect((leaf.setStyle as any).mock.calls.at(-1)![0]).toEqual({
        color: "#ff0000",
        weight: 2,
        stroke: true,
      });
    }
  });

  it("restores a leaf the new field leaves behind", () => {
    installChroma(["#111111", "#222222", "#333333"]);
    const layer = makeLayer(
      makeLeaf({ properties: { value: 1, alt: 1 } }),
      makeLeaf({ properties: { value: 5, alt: null } }),
      makeLeaf({ properties: { value: 9, alt: 9 } }),
      makeLeaf({ properties: { value: 17, alt: 17 } }),
    );
    applyValueStroke(
      makeUI(layer),
      "overlay1",
      makeRamp(),
      undefined,
      liveValueOf(makeRamp()),
      liveModeOf("value"),
    );
    applyValueStroke(
      makeUI(layer),
      "overlay1",
      makeRamp({ field: "alt" }),
      undefined,
      liveValueOf(makeRamp({ field: "alt" })),
      liveModeOf("value"),
    );

    const last = (leaf: (typeof layer.leaves)[number]) =>
      (leaf.setStyle as any).mock.calls.at(-1)![0];
    expect(last(layer.leaves[0]).color).toBe("#111111");
    expect(last(layer.leaves[2]).color).toBe("#222222");
    expect(last(layer.leaves[3]).color).toBe("#333333");
    expect(last(layer.leaves[1])).toEqual({
      color: "#ff0000",
      weight: 2,
      stroke: true,
    });
  });

  it("returns early for a layer not in the registry", () => {
    const ui = { c: { layerRegistry: new Map(), findLayer: () => null } } as any;
    expect(() =>
      applyValueStroke(
        ui,
        "missing",
        makeRamp(),
        undefined,
        liveValueOf(makeRamp()),
        liveModeOf("value"),
      ),
    ).not.toThrow();
  });

  it("survives a re-entrant apply from another layer", () => {
    installChroma(["#ff0000", "#00ff00", "#0000ff"]);
    const outer = makeLayer(
      makeLeaf({ properties: { value: 1 } }),
      makeLeaf({ properties: { value: 5 } }),
    );
    const inner = makeLayer(
      makeLeaf({ properties: { value: 1 } }),
      makeLeaf({ properties: { value: 9 } }),
    );
    const ramp = makeRamp({ classes: 2 });
    (outer.leaves[0].setStyle as any).mockImplementation(() => {
      applyValueStroke(
        makeUI(inner),
        "overlay1",
        ramp,
        undefined,
        liveValueOf(ramp),
        liveModeOf("value"),
      );
    });
    applyValueStroke(
      makeUI(outer),
      "overlay1",
      ramp,
      undefined,
      liveValueOf(ramp),
      liveModeOf("value"),
    );
    for (const layer of [outer, inner]) {
      for (const leaf of layer.leaves) {
        expect((leaf.setStyle as any).mock.calls[0][0].color).toBeDefined();
      }
    }
  });

  it("leaves no state behind when a write throws", () => {
    installChroma(["#ff0000", "#00ff00", "#0000ff"]);
    const layer = makeLayer(
      makeLeaf({ properties: { value: 1 } }),
      makeLeaf({ properties: { value: 9 } }),
    );
    const ui = makeUI(layer);
    const ramp = makeRamp({ classes: 2 });
    let throws = true;
    (layer.leaves[1].setStyle as any).mockImplementation(() => {
      if (throws) throw new Error("boom");
    });
    expect(() =>
      applyValueStroke(
        ui,
        "overlay1",
        ramp,
        undefined,
        liveValueOf(ramp),
        liveModeOf("value"),
      ),
    ).toThrow("boom");
    throws = false;
    applyValueStroke(
      ui,
      "overlay1",
      ramp,
      undefined,
      liveValueOf(ramp),
      liveModeOf("value"),
    );
    for (const leaf of layer.leaves) {
      expect((leaf.setStyle as any).mock.calls.at(-1)![0].color).toBeDefined();
    }
  });

  it("warns instead of degrading silently when simple-statistics is absent", () => {
    installChroma(["#ff0000", "#00ff00"]);
    delete globalThis.ss;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const layer = makeLayer(
      makeLeaf({ properties: { value: 5 } }),
      makeLeaf({ properties: { value: 10 } }),
    );

    expect(() =>
      applyValueStroke(
        makeUI(layer),
        "overlay1",
        makeRamp({ method: METHOD.QUANTILE }),
        undefined,
        liveValueOf(makeRamp({ method: METHOD.QUANTILE })),
        liveModeOf("value"),
      ),
    ).not.toThrow();

    expect(warn.mock.calls[0][0]).toBe("[foliplus] value-based stroke:");
    expect((warn.mock.calls[0][1] as Error).message).toContain("simple-statistics");
    expect((layer.leaves[0].setStyle as any).mock.calls.at(-1)![0]).toEqual({
      color: "#ff0000",
      weight: 2,
      stroke: true,
    });
    warn.mockRestore();
  });

  it("reports an unknown method and restores the author's face", () => {
    installChroma(["#ff0000", "#00ff00"]);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const layer = makeLayer(
      makeLeaf({ properties: { value: 5 } }),
      makeLeaf({ properties: { value: 10 } }),
    );

    expect(() =>
      applyValueStroke(
        makeUI(layer),
        "overlay1",
        makeRamp({ method: "bogus" as never }),
        undefined,
        liveValueOf(makeRamp({ method: "bogus" as never })),
        liveModeOf("value"),
      ),
    ).not.toThrow();

    expect(warn.mock.calls[0][0]).toBe("[foliplus] value-based stroke:");
    expect((warn.mock.calls[0][1] as Error).message).toContain(
      "unknown classification method",
    );
    expect((layer.leaves[0].setStyle as any).mock.calls.at(-1)![0]).toEqual({
      color: "#ff0000",
      weight: 2,
      stroke: true,
    });
    warn.mockRestore();
  });

  it("does not throw on a scheme chroma cannot parse", () => {
    installChroma(["#111111"]);
    const layer = makeLayer(makeLeaf({ properties: { value: 5 } }));
    applyValueStroke(
      makeUI(layer),
      "overlay1",
      makeRamp(),
      undefined,
      liveValueOf(makeRamp()),
      liveModeOf("value"),
    );

    globalThis.chroma = {
      scale: () => {
        throw new Error("unknown format");
      },
    } as never;

    expect(() =>
      applyValueStroke(
        makeUI(layer),
        "overlay1",
        makeRamp({ scheme: "bogus-scheme" }),
        undefined,
        liveValueOf(makeRamp({ scheme: "bogus-scheme" })),
        liveModeOf("value"),
      ),
    ).not.toThrow();
    expect((layer.leaves[0].setStyle as any).mock.calls.at(-1)![0]).toEqual({
      color: "#ff0000",
      weight: 2,
      stroke: true,
    });
    // The failed value stroke attaches an invalidating pin rather than a
    // repainting one — the previous getter would replay a color this value
    // stroke cannot justify. The failing apply is the second one, so its pin
    // is index 1.
    const pinCalls = (pinStyleOnHighlight as ReturnType<typeof vi.fn>).mock.calls;
    expect(pinGetterOf(pinCalls.length - 1)()).toBeNull();
  });

  it("treats a throwing feature getter as no value", () => {
    installChroma(["#ff0000", "#00ff00"]);
    const leaf = makeLeaf({ properties: { value: 5 } });
    Object.defineProperty(leaf, "feature", {
      get() {
        throw new Error("feature boom");
      },
    });
    expect(() =>
      applyValueStroke(
        makeUI(makeLayer(leaf)),
        "overlay1",
        makeRamp(),
        undefined,
        liveValueOf(makeRamp()),
        liveModeOf("value"),
      ),
    ).not.toThrow();
    expect((leaf.setStyle as any).mock.calls.at(-1)![0]).toEqual({
      color: "#ff0000",
      weight: 2,
      stroke: true,
    });
  });

  it("keeps classifying the healthy siblings of a hostile leaf", () => {
    installChroma(["#ff0000", "#00ff00"]);
    const hostile = makeLeaf({ properties: { value: 5 } });
    hostile.feature = Object.defineProperty({}, "properties", {
      get() {
        throw new Error("properties boom");
      },
    }) as any;
    hostile.feature.geometry = { type: "Polygon" };
    const healthy = makeLeaf({ properties: { value: 9 } });

    expect(() =>
      applyValueStroke(
        makeUI(makeLayer(hostile, healthy)),
        "overlay1",
        makeRamp(),
        undefined,
        liveValueOf(makeRamp()),
        liveModeOf("value"),
      ),
    ).not.toThrow();
    expect((healthy.setStyle as any).mock.calls[0][0].color).toBeDefined();
    expect((hostile.setStyle as any).mock.calls.at(-1)![0]).toEqual({
      color: "#ff0000",
      weight: 2,
      stroke: true,
    });
  });

  it("caps classes at the number of available values", () => {
    installChroma(["#ff0000", "#00ff00"]);
    const layer = makeLayer(
      makeLeaf({ properties: { value: 1 } }),
      makeLeaf({ properties: { value: 2 } }),
    );
    applyValueStroke(
      makeUI(layer),
      "overlay1",
      makeRamp({ classes: 9 }),
      undefined,
      liveValueOf(makeRamp({ classes: 9 })),
      liveModeOf("value"),
    );
    expect(layer.leaves[0].setStyle).toHaveBeenCalled();
    expect(layer.leaves[1].setStyle).toHaveBeenCalled();
  });

  it("falls back to the last color when the class index is out of bounds", () => {
    installChroma(["#ff0000"]);
    const layer = makeLayer(
      makeLeaf({ properties: { value: 1 } }),
      makeLeaf({ properties: { value: 5 } }),
      makeLeaf({ properties: { value: 9 } }),
    );
    applyValueStroke(
      makeUI(layer),
      "overlay1",
      makeRamp(),
      undefined,
      liveValueOf(makeRamp()),
      liveModeOf("value"),
    );
    for (const leaf of layer.leaves) {
      const call = (leaf.setStyle as any).mock.calls[0][0];
      expect(call.color).toBe("#ff0000");
    }
  });

  it("handles a single-value layer (one class, one color)", () => {
    installChroma(["#ff0000"]);
    const layer = makeLayer(makeLeaf({ properties: { value: 42 } }));
    applyValueStroke(
      makeUI(layer),
      "overlay1",
      makeRamp({ classes: 5 }),
      undefined,
      liveValueOf(makeRamp({ classes: 5 })),
      liveModeOf("value"),
    );
    expect((layer.leaves[0].setStyle as any).mock.calls[0][0].color).toBe("#ff0000");
  });

  it("paints categorical values by their label under a qualitative scheme", () => {
    installChroma(["#e41a1c", "#377eb8", "#4daf4a"]);
    const layer = makeLayer(
      makeLeaf({ properties: { kind: "forest" } }),
      makeLeaf({ properties: { kind: "water" } }),
      makeLeaf({ properties: { kind: "forest" } }),
      makeLeaf({ properties: { kind: "urban" } }),
    );
    const ramp = makeRamp({ kind: "category", field: "kind" });
    applyValueStroke(
      makeUI(layer),
      "overlay1",
      ramp,
      undefined,
      liveValueOf(ramp),
      liveModeOf("value"),
    );

    const colors = layer.leaves.map(
      leaf => (leaf.setStyle as any).mock.calls[0][0].color as string,
    );
    expect(colors[0]).toBe("#e41a1c");
    expect(colors[1]).toBe("#377eb8");
    expect(colors[2]).toBe("#e41a1c");
    expect(colors[3]).toBe("#4daf4a");
  });

  it("leaves a category leaf with a non-string value out of the value stroke's reach", () => {
    installChroma(["#e41a1c"]);
    const layer = makeLayer(
      makeLeaf({ properties: { kind: "forest" } }),
      makeLeaf({ properties: { kind: 42 } }),
      makeLeaf({ properties: { kind: null } }),
    );
    const ramp = makeRamp({ kind: "category", field: "kind" });
    applyValueStroke(
      makeUI(layer),
      "overlay1",
      ramp,
      undefined,
      liveValueOf(ramp),
      liveModeOf("value"),
    );

    const last = (leaf: (typeof layer.leaves)[number]) =>
      (leaf.setStyle as any).mock.calls.at(-1)![0];
    expect(last(layer.leaves[0]).color).toBe("#e41a1c");
    for (const leaf of layer.leaves.slice(1)) {
      expect(last(leaf).color).toBe("#ff0000");
    }
  });

  it("paints boolean values as categorical labels", () => {
    installChroma(["#e41a1c", "#377eb8"]);
    const layer = makeLayer(
      makeLeaf({ properties: { ok: true } }),
      makeLeaf({ properties: { ok: false } }),
      makeLeaf({ properties: { ok: true } }),
    );
    const ramp = makeRamp({ kind: "category", field: "ok" });
    applyValueStroke(
      makeUI(layer),
      "overlay1",
      ramp,
      undefined,
      liveValueOf(ramp),
      liveModeOf("value"),
    );

    const colors = layer.leaves.map(
      leaf => (leaf.setStyle as any).mock.calls[0][0].color as string,
    );
    expect(colors[0]).toBe("#e41a1c");
    expect(colors[1]).toBe("#377eb8");
    expect(colors[2]).toBe("#e41a1c");
  });

  it("restores the author's face when a category value stroke has no valid labels", () => {
    installChroma(["#e41a1c"]);
    const layer = makeLayer(
      makeLeaf({ properties: { kind: 42 } }),
      makeLeaf({ properties: { kind: null } }),
      makeLeaf({ properties: { kind: "" } }),
    );
    const ramp = makeRamp({ kind: "category", field: "kind" });
    applyValueStroke(
      makeUI(layer),
      "overlay1",
      ramp,
      undefined,
      liveValueOf(ramp),
      liveModeOf("value"),
    );

    for (const leaf of layer.leaves) {
      const last = (leaf.setStyle as any).mock.calls.at(-1)![0];
      expect(last.color).toBe("#ff0000");
    }
  });

  it("carries an explicit weight through the flatScalar slot", () => {
    // Line 82: weight !== undefined builds a flatScalar that rides every leaf
    // alongside the ramp color. The border dimension passes its live width;
    // without it the author's width stays in force (color-only write).
    installChroma(["#ff0000", "#00ff00", "#0000ff"]);
    const leaf = makeLeaf({ properties: { value: 5 } });
    const layer = makeLayer(leaf);
    applyValueStroke(
      makeUI(layer),
      "overlay1",
      makeRamp(),
      undefined,
      liveValueOf(makeRamp()),
      liveModeOf("value"),
      6,
    );

    // The leaf write carries the weight AND the value color.
    const call = (leaf.setStyle as any).mock.calls[0][0];
    expect(call.weight).toBe(6);
    expect(call.color).toBeDefined();
  });

  describe("pin replay", () => {
    it("replays the value stroke on mouseout when the config matches", () => {
      installChroma(["#ff0000", "#00ff00", "#0000ff"]);
      const ramp = makeRamp();
      const layer = makeLayer(makeLeaf({ properties: { value: 5 } }));
      applyValueStroke(
        makeUI(layer),
        "overlay1",
        ramp,
        undefined,
        liveValueOf(ramp),
        liveModeOf("value"),
      );

      const out = pinGetterOf()();
      expect(out).not.toBeNull();
      expect(out!.color).toBe("#ff0000");
      expect(out!.stroke).toBe(true);
    });

    it("returns null when the mode is not value", () => {
      installChroma(["#ff0000", "#00ff00", "#0000ff"]);
      const ramp = makeRamp();
      const layer = makeLayer(makeLeaf({ properties: { value: 5 } }));
      applyValueStroke(
        makeUI(layer),
        "overlay1",
        ramp,
        undefined,
        liveValueOf(ramp),
        liveModeOf("solid"),
      );

      expect(pinGetterOf()()).toBeNull();
    });

    it("returns null when no live ramp is stored", () => {
      installChroma(["#ff0000", "#00ff00", "#0000ff"]);
      const layer = makeLayer(makeLeaf({ properties: { value: 5 } }));
      applyValueStroke(
        makeUI(layer),
        "overlay1",
        makeRamp(),
        undefined,
        liveValueOf(undefined),
        liveModeOf("value"),
      );

      expect(pinGetterOf()()).toBeNull();
    });

    it("returns null when the config changed since the cache build", () => {
      installChroma(["#ff0000", "#00ff00", "#0000ff"]);
      const ramp = makeRamp();
      // A mutable live reader: the pin reads the live record on every fire,
      // so reassigning the box must change what the getter compares against.
      let liveValueVal = ramp;
      const liveValue = () => liveValueVal;
      const layer = makeLayer(makeLeaf({ properties: { value: 5 } }));
      applyValueStroke(
        makeUI(layer),
        "overlay1",
        ramp,
        undefined,
        liveValue,
        liveModeOf("value"),
      );

      for (const [key, value] of [
        ["field", "otherField"],
        ["method", METHOD.QUANTILE],
        ["classes", 5],
        ["scheme", DEFAULT_SCHEMES[1]],
      ] as const) {
        liveValueVal = { ...ramp, [key]: value } as FillValueConfig;
        expect(pinGetterOf()()).toBeNull();
      }
    });

    it("resolves the stored field the same way before comparing", () => {
      installChroma(["#111111"]);
      const layer = makeLayer(makeLeaf({ properties: { count: 5 } }));
      const resolveStored = (stored: FillValueConfig): FillValueConfig => ({
        ...stored,
        field: "count",
      });
      const ramp = resolveStored(makeRamp({ field: "count" }));
      applyValueStroke(
        makeUI(layer),
        "overlay1",
        ramp,
        resolveStored,
        liveValueOf(makeRamp({ field: "gone" })),
        liveModeOf("value"),
      );

      expect((layer.leaves[0].setStyle as any).mock.calls[0][0].color).toBe("#111111");
      expect(pinGetterOf()()).toMatchObject({ color: "#111111", stroke: true });
    });

    it("returns null when the live value is non-finite", () => {
      installChroma(["#ff0000", "#00ff00", "#0000ff"]);
      const ramp = makeRamp();
      const features = [{ properties: { value: 5 } }];
      const layer = makeLayer(makeLeaf(features[0]));
      applyValueStroke(
        makeUI(layer),
        "overlay1",
        ramp,
        undefined,
        liveValueOf(ramp),
        liveModeOf("value"),
      );

      features[0].properties.value = NaN;
      expect(pinGetterOf()()).toBeNull();
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
      const leaf = makeLeaf({ properties: {} });
      leaf.feature = { properties, geometry: { type: "Polygon" } };
      const ramp = makeRamp();
      applyValueStroke(
        makeUI(makeLayer(leaf)),
        "overlay1",
        ramp,
        undefined,
        liveValueOf(ramp),
        liveModeOf("value"),
      );
      const replay = pinGetterOf();

      explode = true;
      expect(() => replay()).not.toThrow();
      expect(replay()).toBeNull();
    });

    it("replays a categorical color for a label in the domain", () => {
      installChroma(["#e41a1c", "#377eb8"]);
      const ramp = makeRamp({ kind: "category", field: "kind" });
      const layer = makeLayer(makeLeaf({ properties: { kind: "water" } }));
      applyValueStroke(
        makeUI(layer),
        "overlay1",
        ramp,
        undefined,
        liveValueOf(ramp),
        liveModeOf("value"),
      );

      const out = pinGetterOf()();
      expect(out).not.toBeNull();
      expect(out!.color).toBe("#e41a1c");
      expect(out!.stroke).toBe(true);
    });

    it("replays nothing for a category leaf whose value is not a string label", () => {
      installChroma(["#e41a1c", "#377eb8"]);
      const ramp = makeRamp({ kind: "category", field: "kind" });
      const layer = makeLayer(
        makeLeaf({ properties: { kind: "forest" } }),
        makeLeaf({ properties: { kind: 42 } }),
      );
      applyValueStroke(
        makeUI(layer),
        "overlay1",
        ramp,
        undefined,
        liveValueOf(ramp),
        liveModeOf("value"),
      );

      expect(pinGetterOf(0)()).not.toBeNull();
      expect(pinGetterOf(1)()).toBeNull();
    });

    it("falls back to the shared other color for a category outside the domain", () => {
      installChroma(["#e41a1c", "#377eb8"]);
      const ramp = makeRamp({ kind: "category", field: "kind" });
      const layer = makeLayer(makeLeaf({ properties: { kind: "forest" } }));
      applyValueStroke(
        makeUI(layer),
        "overlay1",
        ramp,
        undefined,
        liveValueOf(ramp),
        liveModeOf("value"),
      );

      layer.leaves[0].feature.properties.kind = "mystery";
      const out = pinGetterOf()();
      expect(out).not.toBeNull();
      expect(out!.color).toBe("#999");
    });
  });
});
