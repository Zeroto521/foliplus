// Unit tests for core/field — the numeric field enumeration used by the
// value-based fill dimension.
import { describe, expect, it } from "vitest";
import { isNumericValue, numericPropertiesKeys } from "#core/field.js";

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
