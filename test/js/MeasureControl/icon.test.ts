import { describe, expect, it } from "vitest";
import * as SVGs from "#foliplus/MeasureControl/icon.js";

describe("RULER", () => {
  it("is an SVG string", () => {
    expect(SVGs.ICON_RULER).toContain("<svg");
    expect(SVGs.ICON_RULER).toContain("</svg>");
  });
});

describe("ICON_POLYGON", () => {
  it("is an SVG string", () => {
    expect(SVGs.ICON_POLYGON).toContain("<svg");
    expect(SVGs.ICON_POLYGON).toContain("</svg>");
  });
});

describe("CIRCLE", () => {
  it("is an SVG string", () => {
    expect(SVGs.ICON_CIRCLE).toContain("<svg");
    expect(SVGs.ICON_CIRCLE).toContain("</svg>");
  });
});
