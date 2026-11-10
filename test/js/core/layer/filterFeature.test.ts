// Unit tests for core/layer/filterFeatures — the generic data-layer filter
// snapshot builder + hidden-set computation.
//
// The filter contract (per the generic-layer-filter design):
//  ① Field domain: finite number → numeric; non-empty string → enum; boolean
//     → enum ("true"/"false" labels, bag holds the RAW boolean); null / object
//     / array / NaN / ±Infinity / undefined → key omitted from the bag, the
//     feature still counts toward total.
//  ② total = all geometry leaf (Polygon/Polyline/CircleMarker/Marker, skip
//     isLabel, ignore properties); filterable feature = subset (≥1 field).
//  ③ no properties → in total, not filterable; has properties but only
//     non-filterable values → in total, not filterable.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildFilterFeatures, filterLeafSet } from "#core/layer/filterFeature.js";

// Minimal Leaflet classes for the `instanceof` checks in the builder. The
// base setup does not install these, so this file brings its own stubs.
class Polygon {}

class Polyline {}

class CircleMarker {}

class Marker {}

beforeEach(() => {
  window.L.Polygon = Polygon;
  window.L.Polyline = Polyline;
  window.L.CircleMarker = CircleMarker;
  window.L.Marker = Marker;
  let id = 0;
  window.L.stamp = vi.fn(() => ++id);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// A Leaflet-style container that walkLeaf can descend into.
const group = (...children: unknown[]) => ({
  eachLayer: (fn: (l: unknown) => void) => children.forEach(fn),
});

type Kind = "polygon" | "polyline" | "circle" | "marker";
const makeLeaf = (
  kind: Kind,
  props?: Record<string, unknown>,
  isLabel?: boolean,
): L.Layer => {
  const cls =
    kind === "polygon"
      ? Polygon
      : kind === "polyline"
        ? Polyline
        : kind === "circle"
          ? CircleMarker
          : Marker;
  const leaf = new cls() as any;
  if (props !== undefined) leaf.feature = { properties: props };
  if (isLabel) leaf.isLabel = true;
  return leaf;
};

describe("buildFilterFeatures — walk, geometry types, total", () => {
  it("collects every geometry leaf and counts total in walk order", () => {
    const a = makeLeaf("polygon", { name: "a", count: 1 });
    const b = makeLeaf("marker", { name: "b", count: 2 });
    const c = makeLeaf("polyline", { name: "c", count: 3 });
    const d = makeLeaf("circle", { name: "d", count: 4 });
    const feat = buildFilterFeatures(group(a, b, c, d));
    expect(feat.total).toBe(4);
    expect(feat.features).toHaveLength(4);
    expect(feat.features.map(f => f.leaf)).toEqual([a, b, c, d]);
  });

  it("skips isLabel leaves and non-geometry leaves", () => {
    const labelled = makeLeaf("marker", { count: 1 }, true);
    const nonGeom = { getLatLngs: () => [] };
    const a = makeLeaf("marker", { count: 1 });
    const feat = buildFilterFeatures(group(labelled, nonGeom, a));
    expect(feat.total).toBe(1);
    expect(feat.features).toHaveLength(1);
  });

  it("counts a plain Marker without feature in total but with empty fields", () => {
    const bare = makeLeaf("marker");
    const feat = buildFilterFeatures(group(bare));
    expect(feat.total).toBe(1);
    expect(feat.features[0].fields).toEqual({});
  });

  it("dedupes by stamp — the same object twice yields one feature", () => {
    const original = makeLeaf("marker", { count: 1 });
    window.L.stamp = vi.fn(() => "same-id");
    const feat = buildFilterFeatures(group(original, original));
    expect(feat.total).toBe(1);
  });
});

describe("buildFilterFeatures — field domain", () => {
  it("collects finite numbers into numericFields/ranges", () => {
    const a = makeLeaf("marker", { score: 10 });
    const b = makeLeaf("marker", { score: 30 });
    const feat = buildFilterFeatures(group(a, b));
    expect(feat.numericFields).toEqual(["score"]);
    expect(feat.ranges.score).toEqual([10, 30]);
    expect(feat.features[0].fields.score).toBe(10);
    expect(feat.features[1].fields.score).toBe(30);
  });

  it("shrinks the range when a later value is below the running minimum", () => {
    // A value below the running minimum rewrites the range low edge.
    const a = makeLeaf("marker", { score: 30 });
    const b = makeLeaf("marker", { score: 10 });
    const feat = buildFilterFeatures(group(a, b));
    expect(feat.ranges.score).toEqual([10, 30]);
  });

  it("excludes NaN / ±Infinity from numeric fields; a numeric-looking string is enum", () => {
    const a = makeLeaf("marker", { ok: 5, bad: Number.NaN, inf: Infinity, str: "5" });
    const feat = buildFilterFeatures(group(a));
    // NaN / ±Infinity never reach a numeric field; "5" is a string → enum.
    expect(feat.numericFields).toEqual(["ok"]);
    expect(feat.enumFields).toEqual(["str"]);
    expect(feat.features[0].fields).toEqual({ ok: 5, str: "5" });
  });

  it("collects non-empty strings into enumFields and stores raw strings", () => {
    const a = makeLeaf("marker", { kind: "x" });
    const b = makeLeaf("marker", { kind: "y" });
    const feat = buildFilterFeatures(group(a, b));
    expect(feat.enumFields).toEqual(["kind"]);
    expect(feat.enumValues.kind).toEqual(["x", "y"]);
    expect(feat.features[0].fields.kind).toBe("x");
    expect(feat.features[1].fields.kind).toBe("y");
  });

  it("enum-izes boolean: labels true/false, bag holds the raw boolean", () => {
    const a = makeLeaf("marker", { flag: true });
    const feat = buildFilterFeatures(group(a));
    expect(feat.enumFields).toEqual(["flag"]);
    expect(feat.enumValues.flag).toEqual(["true", "false"]);
    expect(feat.features[0].fields.flag).toBe(true);
  });

  it("omits null from the bag but keeps the feature in total", () => {
    const a = makeLeaf("marker", { score: null, name: "x" });
    const feat = buildFilterFeatures(group(a));
    expect(feat.total).toBe(1);
    expect(feat.features[0].fields).toEqual({ name: "x" });
    expect(feat.numericFields).toEqual([]);
  });

  it("omits object / array / undefined from the bag but keeps the feature", () => {
    const a = makeLeaf("marker", { obj: { a: 1 }, arr: [1, 2], undef: undefined });
    const feat = buildFilterFeatures(group(a));
    expect(feat.total).toBe(1);
    expect(feat.features[0].fields).toEqual({});
    expect(feat.numericFields).toEqual([]);
    expect(feat.enumFields).toEqual([]);
  });

  it("fixes a field's kind by first value; a later different type is omitted", () => {
    const a = makeLeaf("marker", { score: 10 });
    const b = makeLeaf("marker", { score: "ten" });
    const feat = buildFilterFeatures(group(a, b));
    expect(feat.numericFields).toEqual(["score"]);
    expect(feat.features[1].fields).toEqual({}); // "ten" omitted (mixed type)
  });

  it("keeps a numeric value inside the established range unchanged", () => {
    // A value inside [min, max] takes neither range rewrite branch — the
    // running extents are unchanged (the else-if false branches).
    const a = makeLeaf("marker", { score: 10 });
    const b = makeLeaf("marker", { score: 30 });
    const c = makeLeaf("marker", { score: 20 });
    const feat = buildFilterFeatures(group(a, b, c));
    expect(feat.ranges.score).toEqual([10, 30]);
    expect(feat.features[2].fields.score).toBe(20);
  });

  it("omits a later non-string from a string-typed field", () => {
    // The string domain is fixed by the first value; a later number is not a
    // string, so it is omitted from the bag (it cannot match an enum filter).
    const a = makeLeaf("marker", { kind: "x" });
    const b = makeLeaf("marker", { kind: 5 });
    const feat = buildFilterFeatures(group(a, b));
    expect(feat.enumFields).toEqual(["kind"]);
    expect(feat.enumValues.kind).toEqual(["x"]);
    expect(feat.features[1].fields).toEqual({}); // 5 omitted (mixed type)
  });

  it("omits a later non-boolean from a boolean field and reuses the enum set", () => {
    // Two booleans share one enum set; a later non-boolean is omitted. The
    // boolean branch keeps the RAW boolean in the bag, never a string.
    const a = makeLeaf("marker", { flag: true });
    const b = makeLeaf("marker", { flag: false });
    const c = makeLeaf("marker", { flag: "yes" });
    const feat = buildFilterFeatures(group(a, b, c));
    expect(feat.enumFields).toEqual(["flag"]);
    expect(feat.enumValues.flag).toEqual(["true", "false"]);
    expect(feat.features[0].fields.flag).toBe(true);
    expect(feat.features[1].fields.flag).toBe(false);
    expect(feat.features[2].fields).toEqual({}); // "yes" omitted (mixed type)
  });
});

describe("buildFilterFeatures — total vs filterable", () => {
  it("a leaf with only non-filterable values is in total but not filterable", () => {
    const a = makeLeaf("marker", { score: null });
    const feat = buildFilterFeatures(group(a));
    expect(feat.total).toBe(1);
    expect(feat.features[0].fields).toEqual({});
    expect(feat.numericFields).toEqual([]);
  });
});

describe("filterLeafSet — hidden set", () => {
  it("hides nothing when the filter is absent", () => {
    const a = makeLeaf("marker", { score: 10 });
    const feat = buildFilterFeatures(group(a));
    const hidden = filterLeafSet(feat.features, undefined);
    expect(hidden.has(a)).toBe(false);
  });

  it("hides leaves outside a numeric range", () => {
    const a = makeLeaf("marker", { score: 10 });
    const b = makeLeaf("marker", { score: 30 });
    const c = makeLeaf("marker", { score: 50 });
    const feat = buildFilterFeatures(group(a, b, c));
    const hidden = filterLeafSet(feat.features, {
      kind: "atom",
      field: "score",
      op: "between",
      range: [20, 40],
    });
    expect(hidden.has(a)).toBe(true);
    expect(hidden.has(b)).toBe(false);
    expect(hidden.has(c)).toBe(true);
  });

  it("hides a non-filterable leaf (empty bag) when a filter is active", () => {
    const bare = makeLeaf("marker");
    const a = makeLeaf("marker", { score: 10 });
    const feat = buildFilterFeatures(group(bare, a));
    const hidden = filterLeafSet(feat.features, {
      kind: "atom",
      field: "score",
      op: "between",
      range: [0, 100],
    });
    expect(hidden.has(bare)).toBe(true); // empty bag → hidden when filtered
    expect(hidden.has(a)).toBe(false);
  });

  it("matches an enum filter on a string field", () => {
    const a = makeLeaf("marker", { kind: "x" });
    const b = makeLeaf("marker", { kind: "y" });
    const feat = buildFilterFeatures(group(a, b));
    const hidden = filterLeafSet(feat.features, {
      kind: "enum",
      field: "kind",
      values: ["x"],
    });
    expect(hidden.has(a)).toBe(false);
    expect(hidden.has(b)).toBe(true);
  });
});
