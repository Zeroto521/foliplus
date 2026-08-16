import { describe, expect, it } from "vitest";
import * as SVGs from "#foliplus/HeatmapControl/icon.js";

describe("HEXAGON", () => {
  it("is an SVG string", () => {
    expect(SVGs.HEXAGON).toContain("<svg");
    expect(SVGs.HEXAGON).toContain("</svg>");
    expect(SVGs.HEXAGON).toContain("polygon");
  });
});
