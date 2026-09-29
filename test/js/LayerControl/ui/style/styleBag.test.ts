import { describe, expect, it, vi } from "vitest";
import {
  STYLE_BAG_DEFAULTS,
  captureStyleBag,
  commitStyleDim,
  faceSlice,
  restoreStyleDim,
  styleBagOf,
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
    expect(styleDimPayload({}, "stroke")).toEqual({ stroke: true });
    expect(styleDimPayload({}, "fill")).toEqual({ fill: true });
  });

  it("rides value keys alongside the bit and drops undefined ones", () => {
    expect(styleDimPayload({ color: "#f00", weight: undefined }, "stroke")).toEqual({
      stroke: true,
      color: "#f00",
    });
    expect(styleDimPayload({ fillColor: "#0f0", fillOpacity: 0.5 }, "fill")).toEqual({
      fill: true,
      fillColor: "#0f0",
      fillOpacity: 0.5,
    });
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
    commitStyleDim(leaf, { color: "#f00", weight: 4 }, "stroke");
    expect(leaf.options).toMatchObject({
      color: "#f00",
      weight: 4,
      stroke: true,
      fill: false,
    });
    commitStyleDim(leaf, { fillColor: "#0f0" }, "fill");
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

    restoreStyleDim(leaf, "stroke");
    expect(leaf.options.stroke).toBe(false);
    expect(leaf.options.color).toBe("#111111");
    expect(leaf.options.weight).toBe(2);
    // fill face untouched by the stroke restore
    expect(leaf.options.fillColor).toBe("#0f0");
    expect(leaf.options.fill).toBe(true);

    restoreStyleDim(leaf, "fill");
    expect(leaf.options.fill).toBe(false);
    expect(leaf.options.fillColor).toBe("#222222");
    expect(leaf.options.fillOpacity).toBe(0.3);
  });

  it("is a no-op for a leaf that was never written", () => {
    const leaf = makeLeaf({ stroke: true });
    const setStyle = vi.spyOn(leaf, "setStyle");
    restoreStyleDim(leaf, "stroke");
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
    expect(faceSlice(bag, "stroke")).toEqual({
      color: "#111111",
      weight: 2,
      stroke: false,
    });
    expect(faceSlice(bag, "fill")).toEqual({
      fillColor: "#222222",
      fillOpacity: 0.3,
      fill: true,
    });
  });
});
