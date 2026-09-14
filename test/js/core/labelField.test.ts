import { describe, expect, it } from "vitest";
import {
  autoLabelField,
  collectLabelFields,
  isNumericField,
} from "#foliplus/core/labelField.js";

/** A leaf that carries a GeoJSON feature, or one that carries none. */
const leaf = (properties?: Record<string, unknown>): L.Layer =>
  ({ feature: properties ? { properties } : undefined }) as unknown as L.Layer;

describe("collectLabelFields", () => {
  it("keeps first-seen order and samples each key's type once", () => {
    const fields = collectLabelFields([
      leaf({ name: "a", count: 1 }),
      leaf({ count: 2, share: "x" }),
    ]);

    expect(fields).toEqual([
      { name: "name", numeric: false },
      { name: "count", numeric: true },
      { name: "share", numeric: false },
    ]);
  });

  it("upgrades the type when a later leaf carries the number", () => {
    const fields = collectLabelFields([leaf({ value: "n/a" }), leaf({ value: 12.5 })]);

    expect(fields).toEqual([{ name: "value", numeric: true }]);
  });

  it("ignores leaves without feature.properties", () => {
    // Annotation label markers ride inside the layer tree and carry no
    // feature; they must not contribute a field.
    const fields = collectLabelFields([leaf(), leaf({ only: 1 }), leaf()]);

    expect(fields).toEqual([{ name: "only", numeric: true }]);
  });

  it("returns [] for a layer with no properties", () => {
    expect(collectLabelFields([])).toEqual([]);
    expect(collectLabelFields([leaf(), leaf()])).toEqual([]);
  });
});

describe("isNumericField", () => {
  const fields = [
    { name: "label", numeric: false },
    { name: "count", numeric: true },
  ];

  it("reads the sampled type", () => {
    expect(isNumericField(fields, "count")).toBe(true);
    expect(isNumericField(fields, "label")).toBe(false);
  });

  it("treats an unknown field as non-numeric", () => {
    // The safe answer for a control (the number-format row) that only makes
    // sense on numbers.
    expect(isNumericField(fields, "missing")).toBe(false);
    expect(isNumericField(fields, "")).toBe(false);
  });
});

describe("autoLabelField", () => {
  it("prefers the first numeric field", () => {
    expect(
      autoLabelField([
        { name: "name", numeric: false },
        { name: "count", numeric: true },
        { name: "share", numeric: true },
      ]),
    ).toBe("count");
  });

  it("falls back to the first field when nothing is numeric", () => {
    expect(
      autoLabelField([
        { name: "name", numeric: false },
        { name: "note", numeric: false },
      ]),
    ).toBe("name");
  });

  it("returns an empty string for a fieldless layer", () => {
    expect(autoLabelField([])).toBe("");
  });
});
