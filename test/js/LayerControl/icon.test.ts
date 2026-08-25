import { describe, expect, it } from "vitest";
import * as SVGs from "#foliplus/LayerControl/icon.js";

describe("LAYERS", () => {
  it("is an SVG string", () => {
    expect(SVGs.LAYERS).toContain("<svg");
    expect(SVGs.LAYERS).toContain("polygon");
  });
});

describe("DRAG_HANDLE", () => {
  it("is an SVG string with drag handle class", () => {
    expect(SVGs.DRAG_HANDLE).toContain("drag-handle");
    expect(SVGs.DRAG_HANDLE).toContain("circle");
  });
});

describe("POINT", () => {
  it("is an SVG string", () => {
    expect(SVGs.POINT).toContain("<svg");
    expect(SVGs.POINT).toContain("circle");
  });
});

describe("LINE", () => {
  it("is an SVG string", () => {
    expect(SVGs.LINE).toContain("<svg");
    expect(SVGs.LINE).toContain("path");
  });
});

describe("POLYGON", () => {
  it("is an SVG string", () => {
    expect(SVGs.POLYGON).toContain("<svg");
    expect(SVGs.POLYGON).toContain("polygon");
  });
});

describe("EMPTY", () => {
  it("is an SVG string", () => {
    expect(SVGs.EMPTY).toContain("<svg");
    expect(SVGs.EMPTY).toContain("dashed");
  });
});

describe("UNKNOWN", () => {
  it("is an SVG string", () => {
    expect(SVGs.UNKNOWN).toContain("<svg");
    expect(SVGs.UNKNOWN).toContain("</svg>");
  });
});

describe("COLOR", () => {
  it("is an SVG string with paint-bucket path", () => {
    expect(SVGs.COLOR).toContain("<svg");
    expect(SVGs.COLOR).toContain("path");
  });
});

describe("FOLD", () => {
  it("is an SVG string with polyline", () => {
    expect(SVGs.FOLD).toContain("<svg");
    expect(SVGs.FOLD).toContain("polyline");
  });
});

describe("MORE", () => {
  it("is an SVG string with three vertical dots", () => {
    expect(SVGs.MORE).toContain("<svg");
    // Three circles at cy=6, 12, 18
    expect(SVGs.MORE).toMatch(/cx="12"[^>]*cy="6"/);
    expect(SVGs.MORE).toMatch(/cx="12"[^>]*cy="12"/);
    expect(SVGs.MORE).toMatch(/cx="12"[^>]*cy="18"/);
  });
});
