import * as SVGs from "#foliplus/FullscreenControl/FullscreenControl.icon.js";
import { describe, expect, it } from "vitest";

describe("MAXIMIZE", () => {
  it("is an SVG string", () => {
    expect(SVGs.MAXIMIZE).toContain("<svg");
    expect(SVGs.MAXIMIZE).toContain("path");
  });
});

describe("MINIMIZE", () => {
  it("is an SVG string", () => {
    expect(SVGs.MINIMIZE).toContain("<svg");
    expect(SVGs.MINIMIZE).toContain("path");
  });
});

describe("ZOOM_IN", () => {
  it("is an SVG string with lines", () => {
    expect(SVGs.ZOOM_IN).toContain("<svg");
    expect(SVGs.ZOOM_IN).toContain("line");
  });
});

describe("ZOOM_OUT", () => {
  it("is an SVG string with a line", () => {
    expect(SVGs.ZOOM_OUT).toContain("<svg");
    expect(SVGs.ZOOM_OUT).toContain("line");
  });
});
