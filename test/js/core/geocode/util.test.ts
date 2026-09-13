import { describe, expect, it } from "vitest";
import {
  featuresToItems,
  interpolate,
  joinUrl,
  safeEval,
  toItems,
  withParams,
} from "#core/geocode/util.js";

describe("interpolate", () => {
  it("substitutes known placeholders and URL-encodes values", () => {
    expect(interpolate("/search?q={q}&limit={limit}", { q: "a b", limit: 5 })).toBe(
      "/search?q=a%20b&limit=5",
    );
  });

  it("leaves unknown placeholders and empty values untouched", () => {
    expect(interpolate("/x?q={q}&lon={lon}", { q: "", lon: "" })).toBe(
      "/x?q={q}&lon={lon}",
    );
  });
});

describe("joinUrl", () => {
  it("joins baseUrl and a relative path", () => {
    expect(joinUrl("https://api.example.com/", "/v1/search")).toBe(
      "https://api.example.com/v1/search",
    );
  });

  it("keeps absolute URLs untouched", () => {
    expect(joinUrl("https://a.example.com", "https://b.example.com/x")).toBe(
      "https://b.example.com/x",
    );
  });
});

describe("withParams", () => {
  it("appends params and skips nullish values", () => {
    const url = withParams("https://api.example.com/search?q=x", {
      size: "5",
      skip: null,
    });
    expect(url).toContain("q=x");
    expect(url).toContain("size=5");
    expect(url).not.toContain("skip");
  });

  it("returns an empty URL unchanged", () => {
    expect(withParams("", { a: "1" })).toBe("");
  });
});

describe("safeEval", () => {
  it("evals a single-arg arrow function", () => {
    const fn = safeEval("d => d.features");
    expect(fn({ features: [1, 2] })).toEqual([1, 2]);
  });

  it("throws on non-arrow-function source", () => {
    expect(() => safeEval("alert(1)")).toThrow(/invalid normalizer/);
  });

  it("throws on syntactically invalid arrow source", () => {
    expect(() => safeEval("x =>")).toThrow(/invalid normalizer/);
  });
});

describe("toItems", () => {
  it("keeps only SuggestItem-shaped elements", () => {
    expect(
      toItems([
        { lng: "1", lat: "2", display_name: "ok" },
        { lng: "3" }, // missing lat/display_name → dropped
        null,
      ]),
    ).toEqual([{ lng: "1", lat: "2", display_name: "ok" }]);
  });

  it("returns [] for non-arrays", () => {
    expect(toItems({ lng: "1", lat: "2", display_name: "x" })).toEqual([]);
  });
});

describe("featuresToItems", () => {
  it("maps a FeatureCollection and skips malformed features", () => {
    const items = featuresToItems(
      {
        features: [
          { geometry: { coordinates: [1, 2] }, properties: { name: "A" } },
          { properties: { name: "no-geometry" } },
        ],
      },
      p => String(p.name ?? ""),
    );
    expect(items).toHaveLength(1);
    expect(items[0]).toEqual({ lng: "1", lat: "2", name: "A", display_name: "A" });
  });
});
