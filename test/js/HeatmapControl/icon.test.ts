import * as SVGs from "#foliplus/HeatmapControl/icon.js";
import { describe, expect, it } from "vitest";

describe("HEXAGON", () => {
  it("is an SVG string", () => {
    expect(SVGs.HEXAGON).toContain("<svg");
    expect(SVGs.HEXAGON).toContain("</svg>");
    expect(SVGs.HEXAGON).toContain("polygon");
  });
});
