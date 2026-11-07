// Unit tests for the shared by-value style arm — valueArm.
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
import { METHOD } from "#core/classify.js";
import type { FillValueConfig } from "#core/layer/intent.js";
import { DEFAULT_SCHEMES } from "#core/palette.js";
import { pinStyleOnHighlight } from "#control/LayerControl/ui/style/pin.js";
import { FACE, walkStyleLeaves } from "#control/LayerControl/ui/style/styleBag.js";
import {
  type ValueFaceDecl,
  applyValueArm,
} from "#control/LayerControl/ui/style/valueArm.js";

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

const makeRamp = (overrides: Partial<FillValueConfig> = {}): FillValueConfig => ({
  field: "value",
  method: METHOD.EQUAL,
  classes: 3,
  scheme: DEFAULT_SCHEMES[0],
  ...overrides,
});

// A stroke-flavoured demo face: a different color slot, opacity slot, face
// and leaf walker than the fill face. If valueArm had a fill branch, this
// declaration would still paint fillColor/fill and the tests below would
// fail — passing proves the arm consumes the declaration's slots.
const demoDecl: ValueFaceDecl = {
  dim: "demoDim",
  face: FACE.STROKE,
  colorKey: "color",
  opacity: { key: "opacity", read: () => 0.5 },
  walkLeaves: walkStyleLeaves,
  isValueActive: () => true,
  readValueConfig: () => makeRamp(),
  logLabel: "value-based demo:",
};

describe("applyValueArm", () => {
  it("paints the declared face, not a hardcoded fill face", () => {
    installChroma(["#ff0000", "#00ff00", "#0000ff"]);
    const layer = makeFeatureLayer([
      { properties: { value: 1 } },
      { properties: { value: 9 } },
    ]);

    applyValueArm(makeUI(layer), "demo1", makeRamp(), demoDecl);

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

    applyValueArm(makeUI(layer), "demo1", ramp, demoDecl);

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

describe("valueArm carries no face literal", () => {
  it("never references the FACE / DIM vocabularies or a fill/stroke style key", () => {
    const source = readFileSync(
      `${process.cwd()}/foliplus/js/control/LayerControl/ui/style/valueArm.ts`,
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
