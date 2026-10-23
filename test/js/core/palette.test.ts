// Unit tests for core/palette — the shared scheme vocabulary and color
// scale builder.
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_SCHEMES,
  PaletteConfigError,
  SCHEME_FALLBACK_COLOR,
  getColorScale,
  safeColorScale,
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

  it("raises a project-owned error when chroma rejects the scheme", () => {
    // chroma throws on a name it cannot parse. Letting its own exception
    // escape meant the same shared function degraded in LayerControl's ramp but
    // aborted Heatmap's panel; a project-owned type is what lets each consumer
    // degrade on its own axis.
    globalThis.chroma = {
      scale: () => {
        throw new Error("unknown scheme");
      },
    } as never;
    expect(() => getColorScale("NotAScheme", 2)).toThrow(PaletteConfigError);
    // Namespaced like every other foliplus diagnostic.
    expect(() => getColorScale("NotAScheme", 2)).toThrow(/^\[foliplus\] /);
  });

  it("safeColorScale paints the fallback instead of failing", () => {
    // The total form: a caller that must not abort the control it is
    // painting uses this instead of catching the error itself.
    globalThis.chroma = {
      scale: () => {
        throw new Error("unknown scheme");
      },
    } as never;
    expect(safeColorScale("NotAScheme", 2)).toEqual([
      SCHEME_FALLBACK_COLOR,
      SCHEME_FALLBACK_COLOR,
    ]);
    expect(safeColorScale("NotAScheme", 0)).toEqual([]);
  });

  it("returns an empty array for n = 0", () => {
    expect(getColorScale("Reds", 0)).toEqual([]);
  });
});
