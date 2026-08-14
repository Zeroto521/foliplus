import * as SVGs from "#foliplus/ExportControl/ExportControl.icon.js";
import { describe, expect, it } from "vitest";

describe("CAMERA", () => {
  it("is an SVG string", () => {
    expect(SVGs.CAMERA).toContain("<svg");
    expect(SVGs.CAMERA).toContain("</svg>");
    expect(SVGs.CAMERA).toContain("circle");
  });
});

describe("CHECK", () => {
  it("is an SVG string", () => {
    expect(SVGs.CHECK).toContain("<svg");
    expect(SVGs.CHECK).toContain("polyline");
  });
});

describe("DOWNLOAD", () => {
  it("is an SVG string", () => {
    expect(SVGs.DOWNLOAD).toContain("<svg");
    expect(SVGs.DOWNLOAD).toContain("path");
  });
});
