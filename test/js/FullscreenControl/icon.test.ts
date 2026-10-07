import { describe, expect, it } from "vitest";
import * as SVGs from "#foliplus/FullscreenControl/icon.js";

describe("MAXIMIZE", () => {
  it("is an SVG string", () => {
    expect(SVGs.ICON_MAXIMIZE).toContain("<svg");
    expect(SVGs.ICON_MAXIMIZE).toContain("path");
  });
});

describe("MINIMIZE", () => {
  it("is an SVG string", () => {
    expect(SVGs.ICON_MINIMIZE).toContain("<svg");
    expect(SVGs.ICON_MINIMIZE).toContain("path");
  });
});

describe("ZOOM_IN", () => {
  it("is an SVG string with lines", () => {
    expect(SVGs.ICON_ZOOM_IN).toContain("<svg");
    expect(SVGs.ICON_ZOOM_IN).toContain("line");
  });
});

describe("ZOOM_OUT", () => {
  it("is an SVG string with a line", () => {
    expect(SVGs.ICON_ZOOM_OUT).toContain("<svg");
    expect(SVGs.ICON_ZOOM_OUT).toContain("line");
  });
});
