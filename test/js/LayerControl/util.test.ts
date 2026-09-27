import { describe, expect, it } from "vitest";
import * as SVGs from "#foliplus/LayerControl/icon.js";
import { getTypeSVG } from "#foliplus/LayerControl/util.js";

describe("getTypeSVG", () => {
  it("maps geometry types to their SVG icons", () => {
    expect(getTypeSVG("polygon")).toBe(SVGs.POLYGON);
    expect(getTypeSVG("line")).toBe(SVGs.LINE);
    expect(getTypeSVG("point")).toBe(SVGs.POINT);
    expect(getTypeSVG("empty")).toBe(SVGs.EMPTY);
  });

  it("falls back to UNKNOWN for unknown / custom / null", () => {
    // The surface's probe returns point / line / polygon / empty; `custom`
    // (iconSvg layers) and `null` (unresolved / missing surface) both show
    // the unknown glyph — the custom icon lives in the header, not here.
    expect(getTypeSVG("unknown")).toBe(SVGs.UNKNOWN);
    expect(getTypeSVG("custom")).toBe(SVGs.UNKNOWN);
    expect(getTypeSVG(null)).toBe(SVGs.UNKNOWN);
  });
});
