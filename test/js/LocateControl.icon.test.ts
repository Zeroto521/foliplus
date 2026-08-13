import * as SVGs from "#foliplus/LocateControl/LocateControl.icon.js";
import { describe, expect, it } from "vitest";

describe("LOCATE", () => {
  it("is an AMap-style crosshair SVG string", () => {
    expect(SVGs.LOCATE).toContain("<svg");
    expect(SVGs.LOCATE).toContain("viewBox");
    expect(SVGs.LOCATE).toContain("circle");
    expect(SVGs.LOCATE).toContain("line");
  });

  it("has a centered crosshair structure", () => {
    // Crosshair: outer circle + center dot + 4 tick marks at N/S/E/W.
    const lines = (SVGs.LOCATE.match(/<line/g) || []).length;
    expect(lines).toBe(4);
    const circles = (SVGs.LOCATE.match(/<circle/g) || []).length;
    expect(circles).toBe(2);
  });
});
