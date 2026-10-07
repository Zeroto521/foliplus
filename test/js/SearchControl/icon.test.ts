import { describe, expect, it } from "vitest";
import * as SVGs from "#foliplus/SearchControl/icon.js";

describe("SEARCH", () => {
  it("is an SVG string", () => {
    expect(SVGs.ICON_SEARCH).toContain("<svg");
    expect(SVGs.ICON_SEARCH).toContain("circle");
    expect(SVGs.ICON_SEARCH).toContain("line");
  });
});
