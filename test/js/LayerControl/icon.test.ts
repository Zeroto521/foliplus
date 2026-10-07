import { describe, expect, it } from "vitest";
import * as SVGs from "#foliplus/LayerControl/icon.js";

describe("ICON_LAYERS", () => {
  it("is an SVG string", () => {
    expect(SVGs.ICON_LAYERS).toContain("<svg");
    expect(SVGs.ICON_LAYERS).toContain("polygon");
  });
});

describe("ICON_DRAG_HANDLE", () => {
  it("is an SVG string with drag handle class", () => {
    expect(SVGs.ICON_DRAG_HANDLE).toContain("drag-handle");
    expect(SVGs.ICON_DRAG_HANDLE).toContain("circle");
  });
});

describe("ICON_POINT", () => {
  it("is an SVG string", () => {
    expect(SVGs.ICON_POINT).toContain("<svg");
    expect(SVGs.ICON_POINT).toContain("circle");
  });
});

describe("ICON_LINE", () => {
  it("is an SVG string", () => {
    expect(SVGs.ICON_LINE).toContain("<svg");
    expect(SVGs.ICON_LINE).toContain("path");
  });
});

describe("ICON_POLYGON", () => {
  it("is an SVG string", () => {
    expect(SVGs.ICON_POLYGON).toContain("<svg");
    expect(SVGs.ICON_POLYGON).toContain("polygon");
  });
});

describe("ICON_EMPTY", () => {
  it("is an SVG string", () => {
    expect(SVGs.ICON_EMPTY).toContain("<svg");
    expect(SVGs.ICON_EMPTY).toContain("dashed");
  });
});

describe("ICON_UNKNOWN", () => {
  it("is an SVG string", () => {
    expect(SVGs.ICON_UNKNOWN).toContain("<svg");
    expect(SVGs.ICON_UNKNOWN).toContain("</svg>");
  });
});

describe("ICON_COLOR", () => {
  it("is an SVG string with paint-bucket path", () => {
    expect(SVGs.ICON_COLOR).toContain("<svg");
    expect(SVGs.ICON_COLOR).toContain("path");
  });
});

describe("ICON_FOLD", () => {
  it("is an SVG string with polyline", () => {
    expect(SVGs.ICON_FOLD).toContain("<svg");
    expect(SVGs.ICON_FOLD).toContain("polyline");
  });
});

describe("ICON_MORE", () => {
  it("is an SVG string with three vertical dots", () => {
    expect(SVGs.ICON_MORE).toContain("<svg");
    // Three circles at cy=6, 12, 18
    expect(SVGs.ICON_MORE).toMatch(/cx="12"[^>]*cy="6"/);
    expect(SVGs.ICON_MORE).toMatch(/cx="12"[^>]*cy="12"/);
    expect(SVGs.ICON_MORE).toMatch(/cx="12"[^>]*cy="18"/);
  });
});

describe("ICON_FOCUS", () => {
  it("is an SVG string with corner brackets + center dot", () => {
    expect(SVGs.ICON_FOCUS).toContain("<svg");
    // Center dot (solid fill)
    expect(SVGs.ICON_FOCUS).toContain('class="solid"');
    expect((SVGs.ICON_FOCUS.match(/circle/g) ?? []).length).toBe(1);
    // Four corner brackets (extent frame)
    expect(SVGs.ICON_FOCUS).toContain("M3 9 V3 H9");
    expect(SVGs.ICON_FOCUS).toContain("M15 3 H21 V9");
    expect(SVGs.ICON_FOCUS).toContain("M21 15 V21 H15");
    expect(SVGs.ICON_FOCUS).toContain("M9 21 H3 V15");
  });
});
