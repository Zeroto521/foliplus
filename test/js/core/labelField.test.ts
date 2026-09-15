import { describe, expect, it } from "vitest";
import {
  AUTO_FIELD,
  autoLabelField,
  collectLabelFields,
  isNumericField,
  resolveSelectedField,
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

  it("keeps the earlier type when a later leaf carries null", () => {
    // The upgrade branch only fires for a real value: a later leaf with null for
    // an already-seen key must not downgrade what the first leaf established.
    const fields = collectLabelFields([leaf({ value: 12.5 }), leaf({ value: null })]);

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

  it("drops properties whose value is not a primitive", () => {
    // A label renders one string, so an object would come out as
    // "[object Object]". folium is why this matters: TopoJson with a
    // style_function writes the resolved style object into every geometry's
    // properties (`style_data`), where it looks exactly like a column.
    const fields = collectLabelFields([
      leaf({
        name: "a",
        style: { color: "#abc", fillOpacity: 0.5 },
        tags: ["x", "y"],
        empty: null,
      }),
    ]);

    expect(fields.map(f => f.name)).toEqual(["name", "empty"]);
  });

  it("drops folium's reserved colour key", () => {
    // `__folium_color` is a primitive — the value rule alone would keep it — but
    // it is how a GeoJSON colours a feature through its properties, not data; a
    // label over it would print a hex colour.
    const fields = collectLabelFields([
      leaf({ name: "a", __folium_color: "#ff0000", value: 3 }),
    ]);

    expect(fields.map(f => f.name)).toEqual(["name", "value"]);
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

describe("resolveSelectedField", () => {
  const fields = [
    { name: "name", numeric: false },
    { name: "count", numeric: true },
  ];

  it("keeps an explicit choice", () => {
    expect(resolveSelectedField("name", fields)).toBe("name");
    expect(resolveSelectedField("count", fields)).toBe("count");
  });

  it("resolves the auto sentinel to the shared auto pick", () => {
    expect(AUTO_FIELD).toBe("");
    expect(resolveSelectedField(AUTO_FIELD, fields)).toBe("count");
  });

  it("resolves the sentinel to empty for a fieldless layer", () => {
    // Nothing to render — the caller treats "" as "no labels".
    expect(resolveSelectedField(AUTO_FIELD, [])).toBe("");
  });
});
