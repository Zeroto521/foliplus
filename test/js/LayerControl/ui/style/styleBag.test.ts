import { describe, expect, it, vi } from "vitest";
import {
  FACE,
  STYLE_BAG_DEFAULTS,
  captureStyleBag,
  commitStyleDim,
  faceSlice,
  restoreStyleDim,
  styleBagOf,
  styleBaseOf,
  styleDimPayload,
} from "#foliplus/LayerControl/ui/style/styleBag.js";

/** A Path-like leaf: options bag + receiver-bound setStyle (Leaflet
 *  `Path.setStyle` mutates `this.options` via setOptions). */
const makeLeaf = (options: Record<string, unknown> = {}) => {
  const leaf: any = { options: { ...options } };
  leaf.setStyle = function (style: Record<string, unknown>) {
    Object.assign(this.options, style);
  };
  return leaf;
};

describe("styleDimPayload", () => {
  it("always lights the face visibility bit", () => {
    expect(styleDimPayload({}, FACE.STROKE)).toEqual({ stroke: true });
    expect(styleDimPayload({}, FACE.FILL)).toEqual({ fill: true });
  });

  it("rides value keys alongside the bit and drops undefined ones", () => {
    expect(styleDimPayload({ color: "#f00", weight: undefined }, FACE.STROKE)).toEqual({
      stroke: true,
      color: "#f00",
    });
    expect(styleDimPayload({ fillColor: "#0f0", fillOpacity: 0.5 }, FACE.FILL)).toEqual(
      {
        fill: true,
        fillColor: "#0f0",
        fillOpacity: 0.5,
      },
    );
  });
});

describe("captureStyleBag / styleBagOf", () => {
  it("records the author's full bag once, including false visibility flags", () => {
    const leaf = makeLeaf({
      color: "#111111",
      weight: 3,
      stroke: false,
      fillColor: "#222222",
      fillOpacity: 0.1,
      fill: false,
    });
    const bag = captureStyleBag(leaf);
    expect(bag).toEqual({
      color: "#111111",
      weight: 3,
      stroke: false,
      fillColor: "#222222",
      fillOpacity: 0.1,
      fill: false,
    });
    expect(styleBagOf(leaf)).toBe(bag);
  });

  it("fills missing keys with Leaflet defaults", () => {
    const bag = captureStyleBag(makeLeaf());
    expect(bag).toEqual(STYLE_BAG_DEFAULTS);
  });

  it("does not re-capture after a write mutates options", () => {
    const leaf = makeLeaf({ stroke: false, fill: false });
    const bag = captureStyleBag(leaf);
    leaf.setStyle({ stroke: true, fill: true, color: "#f00" });
    expect(styleBagOf(leaf)).toBe(bag);
    expect(bag.stroke).toBe(false);
    expect(bag.fill).toBe(false);
  });
});

describe("commitStyleDim", () => {
  it("writes value keys and forces the face bit on", () => {
    const leaf = makeLeaf({ stroke: false, fill: false });
    commitStyleDim(leaf, { color: "#f00", weight: 4 }, FACE.STROKE);
    expect(leaf.options).toMatchObject({
      color: "#f00",
      weight: 4,
      stroke: true,
      fill: false,
    });
    commitStyleDim(leaf, { fillColor: "#0f0" }, FACE.FILL);
    expect(leaf.options).toMatchObject({ fillColor: "#0f0", fill: true });
  });
});

describe("restoreStyleDim", () => {
  it("restores one face from the bag and leaves the other alone", () => {
    const leaf = makeLeaf({
      color: "#111111",
      weight: 2,
      stroke: false,
      fillColor: "#222222",
      fillOpacity: 0.3,
      fill: false,
    });
    commitStyleDim(leaf, { color: "#f00", weight: 9 }, "stroke");
    commitStyleDim(leaf, { fillColor: "#0f0", fillOpacity: 1 }, "fill");

    restoreStyleDim(leaf, FACE.STROKE);
    expect(leaf.options.stroke).toBe(false);
    expect(leaf.options.color).toBe("#111111");
    expect(leaf.options.weight).toBe(2);
    // fill face untouched by the stroke restore
    expect(leaf.options.fillColor).toBe("#0f0");
    expect(leaf.options.fill).toBe(true);

    restoreStyleDim(leaf, FACE.FILL);
    expect(leaf.options.fill).toBe(false);
    expect(leaf.options.fillColor).toBe("#222222");
    expect(leaf.options.fillOpacity).toBe(0.3);
  });

  it("is a no-op for a leaf that was never written", () => {
    const leaf = makeLeaf({ stroke: true });
    const setStyle = vi.spyOn(leaf, "setStyle");
    restoreStyleDim(leaf, FACE.STROKE);
    expect(setStyle).not.toHaveBeenCalled();
  });
});

describe("faceSlice", () => {
  it("returns only that face's keys from the bag", () => {
    const bag = {
      color: "#111111",
      weight: 2,
      stroke: false,
      fillColor: "#222222",
      fillOpacity: 0.3,
      fill: true,
    };
    expect(faceSlice(bag, FACE.STROKE)).toEqual({
      color: "#111111",
      weight: 2,
      stroke: false,
    });
    expect(faceSlice(bag, FACE.FILL)).toEqual({
      fillColor: "#222222",
      fillOpacity: 0.3,
      fill: true,
    });
  });
});

describe("styleBaseOf", () => {
  // Minimal LayerUI mock: styleBaseOf only touches ui.c.findLayer.
  const mockUi = (layer: unknown) => ({ c: { findLayer: () => layer } }) as any;

  it("reads the first style leaf's options before any capture", () => {
    const leaf = makeLeaf({
      color: "#111111",
      weight: 3,
      fillColor: "#222222",
      fillOpacity: 0.4,
    });
    expect(styleBaseOf(mockUi(leaf), "vec1")).toEqual({
      color: "#111111",
      weight: 3,
      fillColor: "#222222",
      fillOpacity: 0.4,
    });
  });

  it("prefers the captured bag over live options after a user write", () => {
    const leaf = makeLeaf({ color: "#111111", fillColor: "#222222" });
    // A user write captures the authored bag first, then mutates options.
    commitStyleDim(leaf, { color: "#ff0000" }, FACE.STROKE);
    expect(leaf.options.color).toBe("#ff0000"); // live options are polluted
    expect(styleBaseOf(mockUi(leaf), "vec1").color).toBe("#111111");
    // The fill face was never written — still read live from options.
    expect(styleBaseOf(mockUi(leaf), "vec1").fillColor).toBe("#222222");
  });

  it("returns Leaflet defaults for a layer that declares no style", () => {
    const leaf = makeLeaf();
    const base = styleBaseOf(mockUi(leaf), "vec1");
    expect(base.color).toBe(STYLE_BAG_DEFAULTS.color);
    expect(base.weight).toBe(STYLE_BAG_DEFAULTS.weight);
    expect(base.fillColor).toBe(STYLE_BAG_DEFAULTS.fillColor);
    // fillOpacity stays nullable — the row layer's display falls back to
    // VISIBLE_FILL_OPACITY, not the bag's capture-time floor.
    expect(base.fillOpacity).toBeNull();
  });

  it("returns Leaflet defaults when the layer is null (late-binding miss)", () => {
    const base = styleBaseOf(mockUi(null), "ghost1");
    expect(base.color).toBe(STYLE_BAG_DEFAULTS.color);
    expect(base.weight).toBe(STYLE_BAG_DEFAULTS.weight);
    expect(base.fillColor).toBe(STYLE_BAG_DEFAULTS.fillColor);
    expect(base.fillOpacity).toBeNull();
  });

  it("descends through a group to read the first leaf's style", () => {
    const leaf = makeLeaf({ color: "#0000ff", weight: 1.5 });
    const group: any = {
      options: {},
      eachLayer: vi.fn((fn: (child: unknown) => void) => fn(leaf)),
    };
    expect(styleBaseOf(mockUi(group), "grp1")).toMatchObject({
      color: "#0000ff",
      weight: 1.5,
    });
  });

  it("reads only the first leaf's fillColor — a later leaf's value never leaks in", () => {
    // The old fill-color reader walked every leaf and took the first
    // `fillColor != null`; `styleBaseOf` matches `authoredBorder`'s existing
    // semantics — take the FIRST leaf with `setStyle` and read ONLY that
    // leaf's options. For a mixed group where the first leaf declares no
    // fillColor but a later leaf does, the result is the default, not the
    // later leaf's value. This locks the unified semantics in place:
    // the panel shows the first feature's actual paint, even if a sibling
    // has a different fill, because that's what the author painted on the
    // first feature the map will hit.
    const firstLeaf = makeLeaf({ color: "#111111" }); // no fillColor
    const laterLeaf = makeLeaf({ color: "#222222", fillColor: "#00ff00" });
    const group: any = {
      options: {},
      eachLayer: vi.fn((fn: (child: unknown) => void) => {
        fn(firstLeaf);
        fn(laterLeaf);
      }),
    };
    const base = styleBaseOf(mockUi(group), "grp1");
    expect(base.fillColor).toBe(STYLE_BAG_DEFAULTS.fillColor);
    expect(base.fillColor).not.toBe("#00ff00");
    // The border face still reads the first leaf's declared color.
    expect(base.color).toBe("#111111");
  });

  it("fill and border consumers share one reader — same output shape", () => {
    // The whole point of this helper is that fill and border rows read
    // from the same call site (`styleBaseOf`), so neither row can drift
    // from the other. Assert a single styleBaseOf call gives both faces
    // consistent values.
    const leaf = makeLeaf({
      color: "#aabbcc",
      weight: 2,
      fillColor: "#ddeeff",
      fillOpacity: 0.3,
    });
    const base = styleBaseOf(mockUi(leaf), "vec1");
    expect(base).toEqual({
      color: "#aabbcc",
      weight: 2,
      fillColor: "#ddeeff",
      fillOpacity: 0.3,
    });
  });
});
