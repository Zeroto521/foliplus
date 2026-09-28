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
// fills at a declared fill_opacity; annotation labels are opaque text. Color
// is a single rect. The three bake carriers therefore match CSS for every
// case they actually draw today.
import { describe, expect, it } from "vitest";
import { drawAlpha, getLayerAlpha, setLayerAlpha } from "#common/canvasAlpha.js";

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
    //   CSS compositing: shapes blend at 0.5+0.5→~0.75 first, then the
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
