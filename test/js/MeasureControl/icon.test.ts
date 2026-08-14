import * as SVGs from "#foliplus/MeasureControl/icon.js";
import { describe, expect, it } from "vitest";

describe("RULER", () => {
  it("is an SVG string", () => {
    expect(SVGs.RULER).toContain("<svg");
    expect(SVGs.RULER).toContain("</svg>");
  });
});

describe("POLYGON", () => {
  it("is an SVG string", () => {
    expect(SVGs.POLYGON).toContain("<svg");
    expect(SVGs.POLYGON).toContain("</svg>");
  });
});

describe("CIRCLE", () => {
  it("is an SVG string", () => {
    expect(SVGs.CIRCLE).toContain("<svg");
    expect(SVGs.CIRCLE).toContain("</svg>");
  });
});

describe("TRASH", () => {
  it("is an SVG string", () => {
    expect(SVGs.TRASH).toContain("<svg");
    expect(SVGs.TRASH).toContain("</svg>");
  });
});
