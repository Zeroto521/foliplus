// Unit tests for core/field — the numeric field enumeration used by the
// value-based fill dimension.
import { describe, expect, it } from "vitest";
import {
  categoricalPropertiesKeys,
  categoryDomain,
  inferFieldKind,
  isCategoryValue,
  isNumericValue,
  numericPropertiesKeys,
  resolveField,
} from "#core/value/field.js";

/** Build a fake Leaflet layer tree for the walker. */
const makeLeaf = (props: Record<string, unknown> | undefined) =>
  ({
    feature: props ? { properties: props } : undefined,
  }) as unknown as L.Layer;

const makeGroup = (children: L.Layer[]) =>
  ({
    eachLayer: (fn: (layer: L.Layer) => void) => children.forEach(fn),
  }) as unknown as L.Layer;

describe("isNumericValue", () => {
  it("accepts finite numbers", () => {
    expect(isNumericValue(0)).toBe(true);
    expect(isNumericValue(1.5)).toBe(true);
    expect(isNumericValue(-1e10)).toBe(true);
  });

  it("rejects NaN and infinities", () => {
    expect(isNumericValue(NaN)).toBe(false);
    expect(isNumericValue(Infinity)).toBe(false);
    expect(isNumericValue(-Infinity)).toBe(false);
  });

  it("rejects numeric strings and other types", () => {
    expect(isNumericValue("10")).toBe(false);
    expect(isNumericValue(null)).toBe(false);
    expect(isNumericValue(undefined)).toBe(false);
    expect(isNumericValue(true)).toBe(false);
    expect(isNumericValue({})).toBe(false);
  });
});

describe("numericPropertiesKeys", () => {
  it("collects distinct numeric keys in first-seen order", () => {
    const layer = makeGroup([
      makeLeaf({ price: 10, name: "a", qty: 3 }),
      makeLeaf({ price: 20, name: "b" }),
      makeLeaf({ price: 5, qty: 1, name: "c" }),
    ]);
    expect(numericPropertiesKeys(layer)).toEqual(["price", "qty"]);
  });

  it("excludes non-numeric fields (string, null, NaN, Infinity)", () => {
    const layer = makeGroup([
      makeLeaf({
        price: 10,
        name: "a",
        blank: null,
        bad: NaN,
        huge: Infinity,
        text: "10",
      }),
    ]);
    expect(numericPropertiesKeys(layer)).toEqual(["price"]);
  });

  it("the first finite sample wins over a later non-finite one", () => {
    const layer = makeGroup([makeLeaf({ price: 10 }), makeLeaf({ price: NaN })]);
    expect(numericPropertiesKeys(layer)).toEqual(["price"]);
  });

  it("a field whose only sample is non-finite is excluded", () => {
    const layer = makeGroup([makeLeaf({ price: NaN }), makeLeaf({ price: Infinity })]);
    expect(numericPropertiesKeys(layer)).toEqual([]);
  });

  it("returns an empty array for a layer with no features", () => {
    expect(numericPropertiesKeys(makeGroup([]))).toEqual([]);
    expect(numericPropertiesKeys(makeLeaf(undefined))).toEqual([]);
  });

  it("skips leaves without a feature envelope", () => {
    const layer = makeGroup([makeLeaf(undefined), makeLeaf({ price: 1 })]);
    expect(numericPropertiesKeys(layer)).toEqual(["price"]);
  });
});
describe("resolveField", () => {
  const fields = ["count", "price"];

  it("keeps a stored field that the layer still offers", () => {
    expect(resolveField("price", fields)).toBe("price");
  });

  it("falls back to the first offered field when the stored one is gone", () => {
    expect(resolveField("gone", fields)).toBe("count");
  });

  it("treats the empty sentinel as unpicked", () => {
    expect(resolveField("", fields)).toBe("count");
  });

  it("resolves to an empty name when the layer offers nothing", () => {
    expect(resolveField("price", [])).toBe("");
  });
});

describe("isCategoryValue", () => {
  it("accepts non-empty strings", () => {
    expect(isCategoryValue("a")).toBe(true);
    expect(isCategoryValue("category name")).toBe(true);
  });
  it("rejects empty strings and non-strings", () => {
    expect(isCategoryValue("")).toBe(false);
    expect(isCategoryValue(" ")).toBe(true); // whitespace is still a label
    expect(isCategoryValue(10)).toBe(false);
    expect(isCategoryValue(0)).toBe(false);
    expect(isCategoryValue(null)).toBe(false);
    expect(isCategoryValue(undefined)).toBe(false);
    expect(isCategoryValue(true)).toBe(false);
    expect(isCategoryValue({})).toBe(false);
  });
});

describe("categoricalPropertiesKeys", () => {
  it("collects distinct string keys in first-seen order", () => {
    const layer = makeGroup([
      makeLeaf({ kind: "forest", name: "a", zone: "north" }),
      makeLeaf({ kind: "lake", name: "b" }),
      makeLeaf({ kind: "urban", zone: "south" }),
    ]);
    // `name` is a string column too — every non-empty string field is a
    // category, so all three are offered.
    expect(categoricalPropertiesKeys(layer)).toEqual(["kind", "name", "zone"]);
  });
  it("excludes numeric-ID columns and empty strings", () => {
    const layer = makeGroup([
      makeLeaf({ id: 1, kind: "forest", blank: "", num: 42 }),
      makeLeaf({ id: 2, kind: "lake" }),
    ]);
    expect(categoricalPropertiesKeys(layer)).toEqual(["kind"]);
  });
  it("skips leaves without a feature envelope", () => {
    const layer = makeGroup([makeLeaf(undefined), makeLeaf({ kind: "forest" })]);
    expect(categoricalPropertiesKeys(layer)).toEqual(["kind"]);
  });
  it("returns an empty array for a layer with no string values", () => {
    expect(categoricalPropertiesKeys(makeGroup([]))).toEqual([]);
    expect(categoricalPropertiesKeys(makeLeaf({ id: 1 }))).toEqual([]);
  });
});

describe("categoryDomain", () => {
  it("collects distinct string values in first-seen order", () => {
    const layer = makeGroup([
      makeLeaf({ kind: "forest" }),
      makeLeaf({ kind: "lake" }),
      makeLeaf({ kind: "forest" }),
      makeLeaf({ kind: "urban" }),
    ]);
    const { values, overflow } = categoryDomain(layer, "kind");
    expect(values).toEqual(["forest", "lake", "urban"]);
    expect(overflow).toBe(false);
  });
  it("drops the empty string and ignores non-string values", () => {
    const layer = makeGroup([
      makeLeaf({ kind: "", n: 1 }),
      makeLeaf({ kind: "forest", n: 2 }),
      makeLeaf({ kind: 5, n: 3 }), // a numeric ID value is not a label
    ]);
    const { values, overflow } = categoryDomain(layer, "kind");
    expect(values).toEqual(["forest"]);
    expect(overflow).toBe(false);
  });
  it("caps the domain at the cap and reports overflow", () => {
    const layer = makeGroup([
      makeLeaf({ kind: "a" }),
      makeLeaf({ kind: "b" }),
      makeLeaf({ kind: "c" }),
      makeLeaf({ kind: "d" }),
    ]);
    const { values, overflow } = categoryDomain(layer, "kind", 2);
    expect(values).toEqual(["a", "b"]);
    expect(overflow).toBe(true);
  });
  it("treats cap 0 as unlimited", () => {
    const layer = makeGroup([
      makeLeaf({ kind: "a" }),
      makeLeaf({ kind: "b" }),
      makeLeaf({ kind: "c" }),
    ]);
    const { values, overflow } = categoryDomain(layer, "kind", 0);
    expect(values).toEqual(["a", "b", "c"]);
    expect(overflow).toBe(false);
  });
  it("returns empty for a layer with no matching values", () => {
    const { values, overflow } = categoryDomain(makeGroup([]), "kind");
    expect(values).toEqual([]);
    expect(overflow).toBe(false);
  });
  it("skips leaves without a feature envelope", () => {
    const layer = makeGroup([makeLeaf(undefined), makeLeaf({ kind: "forest" })]);
    const { values, overflow } = categoryDomain(layer, "kind");
    expect(values).toEqual(["forest"]);
    expect(overflow).toBe(false);
  });
  it("returns empty for a missing field", () => {
    const layer = makeGroup([makeLeaf({ other: "x" })]);
    const { values, overflow } = categoryDomain(layer, "kind");
    expect(values).toEqual([]);
    expect(overflow).toBe(false);
  });
});
describe("inferFieldKind", () => {
  it("types a number sample as numeric", () => {
    const layer = makeGroup([makeLeaf({ score: 10 }), makeLeaf({ score: 3.5 })]);
    expect(inferFieldKind(layer, "score")).toBe("numeric");
  });

  it("types a non-empty string sample as category", () => {
    const layer = makeGroup([makeLeaf({ kind: "forest" })]);
    expect(inferFieldKind(layer, "kind")).toBe("category");
  });

  it("types a boolean sample as category", () => {
    // A boolean column is a label, not a number: the fill mode's category
    // predicate accepts it so a boolean declaration can actually paint.
    const layer = makeGroup([makeLeaf({ active: true }), makeLeaf({ active: false })]);
    expect(inferFieldKind(layer, "active")).toBe("category");
  });

  it("reports mixed when number and category values coexist", () => {
    const layer = makeGroup([makeLeaf({ score: 10 }), makeLeaf({ score: "high" })]);
    expect(inferFieldKind(layer, "score")).toBe("mixed");
  });

  it("reports mixed when number and boolean values coexist", () => {
    const layer = makeGroup([makeLeaf({ v: 1 }), makeLeaf({ v: true })]);
    expect(inferFieldKind(layer, "v")).toBe("mixed");
  });

  it("reports empty for all-null / no-usable values", () => {
    const layer = makeGroup([
      makeLeaf({ score: null }),
      makeLeaf({ score: undefined }),
    ]);
    expect(inferFieldKind(layer, "score")).toBe("empty");
  });

  it("reports empty for a layer with no features", () => {
    expect(inferFieldKind(makeGroup([]), "score")).toBe("empty");
    expect(inferFieldKind(makeLeaf(undefined), "score")).toBe("empty");
  });

  it("reports empty for a null / non-object layer", () => {
    expect(inferFieldKind(null, "score")).toBe("empty");
    expect(inferFieldKind(undefined, "score")).toBe("empty");
    expect(inferFieldKind(42, "score")).toBe("empty");
  });

  it("skips null values between usable ones", () => {
    const layer = makeGroup([
      makeLeaf({ v: null }),
      makeLeaf({ v: 5 }),
      makeLeaf({ v: null }),
    ]);
    expect(inferFieldKind(layer, "v")).toBe("numeric");
  });

  it("skips leaves without a feature envelope", () => {
    const layer = makeGroup([makeLeaf(undefined), makeLeaf({ v: "a" })]);
    expect(inferFieldKind(layer, "v")).toBe("category");
  });

  it("caps the sample at 64 leaves (a later different kind is not seen)", () => {
    // 64 numeric leaves then a string: the sample cap stops before the
    // string, so the field stays numeric instead of flipping to mixed.
    const numeric = Array.from({ length: 64 }, () => makeLeaf({ v: 1 }));
    const layer = makeGroup([...numeric, makeLeaf({ v: "x" })]);
    expect(inferFieldKind(layer, "v")).toBe("numeric");
  });

  it("caches the result per (layer, field) — a changed value is not re-inferred", () => {
    const leaf = makeLeaf({ v: 1 });
    const layer = makeGroup([leaf]);
    expect(inferFieldKind(layer, "v")).toBe("numeric");
    // The declaration-lifetime cache means a later streamed value of another
    // type is not re-walked; the first result stands.
    (
      leaf as unknown as { feature: { properties: Record<string, unknown> } }
    ).feature.properties.v = "x";
    expect(inferFieldKind(layer, "v")).toBe("numeric");
  });
});
