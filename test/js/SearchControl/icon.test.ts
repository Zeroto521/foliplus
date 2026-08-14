import * as SVGs from "#foliplus/SearchControl/icon.js";
import { describe, expect, it } from "vitest";

describe("SEARCH", () => {
  it("is an SVG string", () => {
    expect(SVGs.SEARCH).toContain("<svg");
    expect(SVGs.SEARCH).toContain("circle");
    expect(SVGs.SEARCH).toContain("line");
  });
});
