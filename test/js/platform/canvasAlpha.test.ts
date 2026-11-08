// canvasAlpha — shared layer-alpha bake helpers (R11).
import { describe, expect, it } from "vitest";
import {
  drawAlpha,
  getLayerAlpha,
  setLayerAlpha,
  withCanvasLayerAlpha,
  withLayerAlpha,
} from "#core/layer/canvasAlpha.js";

const makeCanvas = (): HTMLCanvasElement => document.createElement("canvas");

describe("setLayerAlpha / getLayerAlpha", () => {
  it("defaults to 1 when nothing was stored", () => {
    expect(getLayerAlpha(makeCanvas())).toBe(1);
  });

  it("defaults to 1 for null/undefined canvas", () => {
    expect(getLayerAlpha(null)).toBe(1);
    expect(getLayerAlpha(undefined)).toBe(1);
  });

  it("stores and reads back a clamped value", () => {
    const c = makeCanvas();
    setLayerAlpha(c, 0.4);
    expect(getLayerAlpha(c)).toBe(0.4);
    setLayerAlpha(c, 1.5);
    expect(getLayerAlpha(c)).toBe(1);
    setLayerAlpha(c, -0.2);
    expect(getLayerAlpha(c)).toBe(0);
  });

  it("treats non-finite input as 1", () => {
    const c = makeCanvas();
    setLayerAlpha(c, Number.NaN);
    expect(getLayerAlpha(c)).toBe(1);
  });
});

describe("drawAlpha", () => {
  it("multiplies declared × layer alpha", () => {
    expect(drawAlpha(0.5, 0.5)).toBeCloseTo(0.25);
    expect(drawAlpha(1, 0.3)).toBeCloseTo(0.3);
    expect(drawAlpha(0.8, 1)).toBeCloseTo(0.8);
  });

  it("clamps both inputs and the product into [0, 1]", () => {
    expect(drawAlpha(2, 1)).toBe(1);
    expect(drawAlpha(1, 2)).toBe(1);
    expect(drawAlpha(-1, 1)).toBe(0);
    expect(drawAlpha(Number.NaN, 0.5)).toBeCloseTo(0.5);
    expect(drawAlpha(0.5, Number.NaN)).toBeCloseTo(0.5);
    expect(drawAlpha(Number.NaN, Number.NaN)).toBe(1);
    expect(drawAlpha(0.4, 0.4)).toBeCloseTo(0.16);
  });

  it("keeps declared fill/border semantics when layerAlpha is 1", () => {
    // Existing HeatmapControl fill_opacity / border_opacity tests pin the
    // declared path; drawAlpha must be a no-op multiplier at layerAlpha=1.
    expect(drawAlpha(0.25, 1)).toBeCloseTo(0.25);
    expect(drawAlpha(0, 1)).toBe(0);
  });
});

describe("withLayerAlpha", () => {
  it("runs draw under multiplied globalAlpha and restores the previous value", () => {
    const ctx = {
      globalAlpha: 0.8,
      // minimal stub — only globalAlpha is touched
    } as CanvasRenderingContext2D;
    const seen: number[] = [];
    withLayerAlpha(ctx, 0.5, () => {
      seen.push(ctx.globalAlpha);
    });
    expect(seen).toEqual([0.4]);
    expect(ctx.globalAlpha).toBe(0.8);
  });

  it("restores globalAlpha even when draw throws", () => {
    const ctx = { globalAlpha: 1 } as CanvasRenderingContext2D;
    expect(() =>
      withLayerAlpha(ctx, 0.5, () => {
        throw new Error("boom");
      }),
    ).toThrow("boom");
    expect(ctx.globalAlpha).toBe(1);
  });
});

describe("withCanvasLayerAlpha", () => {
  it("reads the alpha stored on ctx.canvas", () => {
    const canvas = makeCanvas();
    setLayerAlpha(canvas, 0.25);
    const ctx = {
      canvas,
      globalAlpha: 1,
    } as unknown as CanvasRenderingContext2D;
    const seen: number[] = [];
    withCanvasLayerAlpha(ctx, () => {
      seen.push(ctx.globalAlpha);
    });
    expect(seen).toEqual([0.25]);
    expect(ctx.globalAlpha).toBe(1);
  });

  it("treats a canvas with no stored alpha as 1 (branch cover)", () => {
    const canvas = makeCanvas();
    const ctx = {
      canvas,
      globalAlpha: 1,
    } as unknown as CanvasRenderingContext2D;
    const seen: number[] = [];
    withCanvasLayerAlpha(ctx, () => {
      seen.push(ctx.globalAlpha);
    });
    expect(seen).toEqual([1]);
  });
});

// Visual-consistency notes + assertions for the R11 bake path.
//
// CSS whole-element opacity and per-draw `globalAlpha` are the same visual
// result for a single non-overlapping shape: both multiply the shape's
// coverage against what is underneath. They DIFFER when two semi-transparent
// shapes overlap inside the same canvas:
//   - CSS composites the canvas as one layer at `opacity` after the shapes
//     have already blended with each other.
//   - per-draw globalAlpha blends each shape against the canvas content at
//     draw time, so the overlap region is (a×a) rather than (a).
// That difference is inherent to canvas alpha mixing vs layer compositing and
// is documented here rather than papered over. Heatmap hexes are opaque
// fills at a declared fill_opacity; label labels are opaque text. Color
// is a single rect. The three bake carriers therefore match CSS for every
// case they actually draw today.
describe("visual consistency: bake vs CSS (single shape)", () => {
  it("bake alpha equals the CSS opacity multiplier for a lone fill", () => {
    // CSS path: fill at declared α, element opacity L → observed α = α×L.
    // Bake path: fill at drawAlpha(α, L) with element opacity 1 → same α.
    const declared = 0.7;
    const layer = 0.5;
    const cssObserved = declared * layer;
    const bakeObserved = drawAlpha(declared, layer);
    expect(bakeObserved).toBeCloseTo(cssObserved);
  });

  it("overlap blending differs from CSS and is accepted as canvas semantics", () => {
    // Two shapes at α=0.5 overlapping inside one canvas:
    //   per-draw bake: second shape blends against first → overlap ~0.75
    //   CSS compositing: shapes blend at 0.5+0.5 → ~0.75 first, then the
    //   whole layer at L=0.5 → overlap ~0.375
    // Not equal. Recorded, not hidden — see the header comment.
    const a = 0.5;
    const bakeOverlap = a + a * (1 - a); // ~0.75
    const cssOverlap = bakeOverlap * a; // whole-layer then fade
    expect(bakeOverlap).toBeCloseTo(0.75);
    expect(cssOverlap).toBeCloseTo(0.375);
    expect(bakeOverlap).not.toBeCloseTo(cssOverlap);
  });
});

describe("visual consistency: stored layerAlpha survives a paint cycle", () => {
  it("setLayerAlpha is readable at draw time and independent per canvas", () => {
    const c1 = document.createElement("canvas");
    const c2 = document.createElement("canvas");
    setLayerAlpha(c1, 0.3);
    setLayerAlpha(c2, 0.8);
    expect(getLayerAlpha(c1)).toBeCloseTo(0.3);
    expect(getLayerAlpha(c2)).toBeCloseTo(0.8);
  });
});
