// Unit tests for core/palette — the shared scheme vocabulary and color
// scale builder.
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_SCHEMES,
  SCHEME_FALLBACK_COLOR,
  getColorScale,
} from "#core/palette.js";

afterEach(() => {
  delete globalThis.chroma;
});

describe("DEFAULT_SCHEMES", () => {
  it("offers the seven canonical schemes", () => {
    expect(DEFAULT_SCHEMES).toEqual([
      "Blues",
      "Greens",
      "Reds",
      "Oranges",
      "Purples",
      "YlOrRd",
      "Viridis",
    ]);
  });
});

describe("getColorScale", () => {
  it("builds a chroma scale with n colors when chroma is available", () => {
    const colorsSpy = vi.fn(() => ["#a", "#b"]);
    const modeSpy = vi.fn(() => ({ colors: colorsSpy }));
    const scaleSpy = vi.fn(() => ({ mode: modeSpy }));
    globalThis.chroma = { scale: scaleSpy } as never;
    expect(getColorScale("Reds", 2)).toEqual(["#a", "#b"]);
    expect(scaleSpy).toHaveBeenCalledWith("Reds");
    expect(modeSpy).toHaveBeenCalledWith("lab");
    expect(colorsSpy).toHaveBeenCalledWith(2);
  });

  it("falls back to a flat SCHEME_FALLBACK_COLOR array when chroma is absent", () => {
    expect(getColorScale("Reds", 3)).toEqual([
      SCHEME_FALLBACK_COLOR,
      SCHEME_FALLBACK_COLOR,
      SCHEME_FALLBACK_COLOR,
    ]);
  });

  it("returns an empty array for n = 0", () => {
    expect(getColorScale("Reds", 0)).toEqual([]);
  });
});
