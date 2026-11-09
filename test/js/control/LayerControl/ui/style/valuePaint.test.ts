// Unit tests for the shared by-value style arm — valuePaint.
//
// The arm is face-independent: it paints whatever face a \`ValueFaceDecl\`
// declares, and its body carries no FILL/STROKE literal. These tests drive it
// with a STROKE-flavoured demo declaration (a different face, color slot,
// leaf walker and opacity slot than the fill face) and assert the arm writes
// exactly that face — if the arm had a fill branch it would paint
// \`fillColor\`/\`fill\` instead of the demo's \`color\`/\`stroke\`.
//
// The reverse assertion reads the arm's source and requires no FACE / DIM
// vocabulary reference and no fill/stroke style-key literal, so a future
// edit that hardcodes a face cannot pass.
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ValueConfig } from "#core/layer/intent.js";
import { METHOD } from "#core/value/classify.js";
import { DEFAULT_SCHEMES } from "#core/value/palette.js";
import { pinStyleOnHighlight } from "#control/LayerControl/ui/style/pin.js";
import { FACE, walkStyleLeaves } from "#control/LayerControl/ui/style/styleBag.js";
import {
  type ValueFaceDecl,
  paintByValue,
} from "#control/LayerControl/ui/style/valuePaint.js";

vi.mock("#control/LayerControl/ui/style/pin.js", () => ({
  pinStyleOnHighlight: vi.fn(),
}));

/** Install a chroma stub that hands back a fixed color list — the same shape
 *  the numeric ramp path asks for. */
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

const makeFeatureLayer = (features: Array<{ properties: Record<string, unknown> }>) => {
  const leaves = features.map(f => ({
    feature: { properties: f.properties, geometry: { type: "Polygon" } },
    options: {
      color: "#000000",
      weight: 1,
      stroke: true,
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
  }));
  return {
    eachLayer: (fn: (layer: unknown) => void) => leaves.forEach(l => fn(l)),
    leaves,
  };
};

const makeUI = (layer: unknown) =>
  ({
    c: {
      layerRegistry: new Map([["demo1", { id: "demo1", layer }] as any]),
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

// A stroke-flavoured demo face: a different color slot, opacity slot, face
// and leaf walker than the fill face. If valuePaint had a fill branch, this
// declaration would still paint fillColor/fill and the tests below would
// fail — passing proves the arm consumes the declaration's slots.
const demoDecl: ValueFaceDecl = {
  dim: "demoDim",
  face: FACE.STROKE,
  colorKey: "color",
  flatScalar: { key: "opacity", read: () => 0.5 },
  walkLeaves: walkStyleLeaves,
  isValueActive: () => true,
  readValueConfig: () => makeRamp(),
  logLabel: "value-based demo:",
};

describe("paintByValue", () => {
  it("paints the declared face, not a hardcoded fill face", () => {
    installChroma(["#ff0000", "#00ff00", "#0000ff"]);
    const layer = makeFeatureLayer([
      { properties: { value: 1 } },
      { properties: { value: 9 } },
    ]);

    paintByValue(makeUI(layer), "demo1", makeRamp(), demoDecl);

    for (const leaf of layer.leaves) {
      const call = (leaf.setStyle as any).mock.calls[0][0];
      // The declared face's own slot and visibility bit, not fill's.
      expect(call.color).toBeDefined();
      expect(call.stroke).toBe(true);
      expect(call.fillColor).toBeUndefined();
      expect(call.fill).toBeUndefined();
      // The declared opacity slot rides along, not fillOpacity.
      expect(call.opacity).toBe(0.5);
      expect(call.fillOpacity).toBeUndefined();
    }
  });

  it("registers the pin on the declared dimension and replays the declared face", () => {
    installChroma(["#ff0000", "#00ff00", "#0000ff"]);
    const ramp = makeRamp();
    const layer = makeFeatureLayer([{ properties: { value: 5 } }]);

    paintByValue(makeUI(layer), "demo1", ramp, demoDecl);

    expect(pinStyleOnHighlight).toHaveBeenCalledTimes(1);
    expect((pinStyleOnHighlight as ReturnType<typeof vi.fn>).mock.calls[0][1]).toBe(
      "demoDim",
    );
    const out = pinGetterOf(0)();
    expect(out).not.toBeNull();
    expect(out!.color).toBeDefined();
    expect(out!.stroke).toBe(true);
  });
});

it("paints category leaves via buildCategoryRamp, not the numeric ramp", () => {
  // A category config drives the arm down the buildCategoryRamp arm; the
  // leaf's label must end up in the write's declared color slot.
  installChroma(["#aa0000", "#00aa00", "#0000aa"]);
  const catRamp: ValueConfig = {
    field: "cat",
    kind: "category",
    scheme: DEFAULT_SCHEMES[0],
  } as ValueConfig;
  const catDecl: ValueFaceDecl = {
    ...demoDecl,
    readValueConfig: () => catRamp,
  };
  const layer = makeFeatureLayer([
    { properties: { cat: "alpha" } },
    { properties: { cat: "beta" } },
    { properties: { cat: "alpha" } }, // duplicate label — first-seen wins
  ]);
  paintByValue(makeUI(layer), "demo1", catRamp, catDecl);
  // Both distinct labels got painted (the walk visited them)
  const painted = layer.leaves.map(l => (l.setStyle as any).mock.calls[0]?.[0]);
  expect(painted[0].color).toBeDefined();
  expect(painted[1].color).toBeDefined();
});

it("warns and skips the write when chroma throws on the scheme", () => {
  // chroma.scale() throws — the arm must log.warn and return without
  // calling setStyle or pinning, not propagate the error.
  const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  globalThis.chroma = {
    scale: () => {
      throw new Error("unknown scheme");
    },
  } as never;
  const layer = makeFeatureLayer([{ properties: { value: 1 } }]);
  paintByValue(makeUI(layer), "demo1", makeRamp(), demoDecl);
  expect(warnSpy).toHaveBeenCalled();
  // The arm skipped the paint (color key absent from the write) and ran
  // the restore path — the leaf's author color is what setStyle received.
  for (const leaf of layer.leaves) {
    const call = (leaf.setStyle as any).mock.calls[0]?.[0];
    expect(call?.color).toBe("#000000"); // the author's original, not a ramp color
  }
  warnSpy.mockRestore();
});

it("restores the author's face when the ramp classifies no leaf", () => {
  // installChroma returning empty → both scale and catScale are null →
  // the arm takes the restore (commitStyleDimMerged) branch, not paint.
  globalThis.chroma = {
    scale: () => ({ mode: () => ({ colors: () => [] }), colors: () => [] }),
  } as never;
  const layer = makeFeatureLayer([
    { properties: { value: 1 } },
    { properties: { value: 99 } },
  ]);
  paintByValue(makeUI(layer), "demo1", makeRamp(), demoDecl);
  // The restore path ran — the author's color (unchanged) is what setStyle
  // received, not a ramp color. The arm skipped the paint.
  for (const leaf of layer.leaves) {
    const call = (leaf.setStyle as any).mock.calls[0]?.[0];
    expect(call?.color).toBe("#000000"); // author's original preserved
  }
});

it("replays the category color on mouseout via the pin getter", () => {
  installChroma(["#aa0000", "#00aa00"]);
  const catRamp: ValueConfig = {
    field: "cat",
    kind: "category",
    scheme: DEFAULT_SCHEMES[0],
  } as ValueConfig;
  const catDecl: ValueFaceDecl = {
    ...demoDecl,
    readValueConfig: () => catRamp,
  };
  const layer = makeFeatureLayer([{ properties: { cat: "alpha" } }]);
  paintByValue(makeUI(layer), "demo1", catRamp, catDecl);
  const out = pinGetterOf(0)();
  expect(out).not.toBeNull();
  expect(out!.color).toBeDefined();
});

describe("a face without a user flatScalar", () => {
  // The flatScalar arm must be optional per face: a dimension with no user flatScalar
  // (e.g. a stroke that has no width-as-flatScalar slot) passes null and the paint
  // writes/replays only the color. A no-flatScalar face is the only way to reach
  // the paint's flatScalar-skipping branches.
  const noflatScalarDecl: ValueFaceDecl = {
    dim: "demoDim",
    face: FACE.STROKE,
    colorKey: "color",
    flatScalar: null,
    walkLeaves: walkStyleLeaves,
    isValueActive: () => true,
    readValueConfig: () => makeRamp(),
    logLabel: "value-based demo:",
  };

  it("writes the ramp color without a flatScalar slot", () => {
    installChroma(["#ff0000", "#00ff00", "#0000ff"]);
    const layer = makeFeatureLayer([
      { properties: { value: 1 } },
      { properties: { value: 9 } },
    ]);

    paintByValue(makeUI(layer), "demo1", makeRamp(), noflatScalarDecl);

    for (const leaf of layer.leaves) {
      const call = (leaf.setStyle as any).mock.calls[0][0];
      expect(call.color).toBeDefined();
      expect(call.opacity).toBeUndefined();
      expect(call.stroke).toBe(true);
    }
  });

  it("replays the declared color without a flatScalar slot for an in-domain numeric leaf", () => {
    installChroma(["#ff0000", "#00ff00", "#0000ff"]);
    const layer = makeFeatureLayer([{ properties: { value: 5 } }]);

    paintByValue(makeUI(layer), "demo1", makeRamp(), noflatScalarDecl);

    const out = pinGetterOf(0)();
    expect(out).not.toBeNull();
    expect(out!.color).toBeDefined();
    expect(out!.opacity).toBeUndefined();
  });

  it("returns null for an out-of-reach leaf when the face has no flatScalar", () => {
    installChroma(["#ff0000", "#00ff00", "#0000ff"]);
    const features = [{ properties: { value: 5 } }];
    const layer = makeFeatureLayer(features);
    paintByValue(makeUI(layer), "demo1", makeRamp(), noflatScalarDecl);

    // The live value turns non-finite after the cache was built: the pin has
    // nothing to replay and, with no user flatScalar, nothing to add on top.
    features[0].properties.value = NaN;
    expect(pinGetterOf(0)()).toBeNull();
  });

  it("replays a categorical color without a flatScalar slot", () => {
    installChroma(["#e41a1c", "#377eb8"]);
    const layer = makeFeatureLayer([{ properties: { kind: "forest" } }]);
    const ramp = makeRamp({ kind: "category", field: "kind" });
    const catDecl: ValueFaceDecl = {
      ...noflatScalarDecl,
      readValueConfig: () => ramp,
    };

    paintByValue(makeUI(layer), "demo1", ramp, catDecl);

    const out = pinGetterOf(0)();
    expect(out).not.toBeNull();
    expect(out!.color).toBeDefined();
    expect(out!.opacity).toBeUndefined();
  });
});

describe("valuePaint carries no face literal", () => {
  it("never references the FACE / DIM vocabularies or a fill/stroke style key", () => {
    const source = readFileSync(
      `${process.cwd()}/foliplus/js/control/LayerControl/ui/style/valuePaint.ts`,
      "utf8",
    );
    // Strip comments so prose ("fill carriers", "stroke face") cannot mask a
    // real branch — the assertion targets code only.
    const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect(code).not.toMatch(/\bFACE\./);
    expect(code).not.toMatch(/\bDIM\./);
    expect(code).not.toMatch(/["'](fillColor|fillOpacity|fill|stroke)["']/);
  });
});
