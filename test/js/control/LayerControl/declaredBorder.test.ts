import { describe, expect, it } from "vitest";
import { STYLE_MODE } from "#core/layer/index.js";
import { readDeclaredBorder } from "#control/LayerControl/declaredParse.js";

/** A linked carrier carrying a foliplus border declaration. Fresh object per
 *  test: the reader caches per layer object, the way a folium layer's options
 *  are final once it exists. */
const layerWith = (foliplus: unknown) => ({ options: { foliplus } }) as never;

describe("readDeclaredBorder", () => {
  it("reads a follow_fill declaration", () => {
    const read = readDeclaredBorder(
      layerWith({ border: { mode: "follow_fill" } }),
      "overlay1",
    );
    expect(read.invalid).toEqual([]);
    expect(read.declared).toBe(STYLE_MODE.FOLLOW_FILL);
  });

  it("reads nothing on a layer with no declaration (byte-identical default)", () => {
    const read = readDeclaredBorder(layerWith({}), "overlay1");
    expect(read.invalid).toEqual([]);
    expect(read.declared).toBeUndefined();
  });

  it("reads nothing when foliplus.border is absent but other keys exist", () => {
    const read = readDeclaredBorder(layerWith({ fill: { field: "x" } }), "overlay1");
    expect(read.invalid).toEqual([]);
    expect(read.declared).toBeUndefined();
  });

  it("rejects a non-object border declaration (warn once, reads not declared)", () => {
    const read = readDeclaredBorder(layerWith({ border: "follow_fill" }), "overlay1");
    expect(read.declared).toBeUndefined();
    expect(read.invalid.length).toBeGreaterThan(0);
  });

  it("rejects an array border declaration (reads not declared)", () => {
    const read = readDeclaredBorder(layerWith({ border: ["follow_fill"] }), "overlay1");
    expect(read.declared).toBeUndefined();
    expect(read.invalid.length).toBeGreaterThan(0);
  });

  it("rejects a border without a mode, field, colour or weight", () => {
    const read = readDeclaredBorder(layerWith({ border: {} }), "overlay1");
    expect(read.declared).toBeUndefined();
    expect(read.invalid.length).toBeGreaterThan(0);
  });

  it("rejects an unknown border mode", () => {
    const read = readDeclaredBorder(
      layerWith({ border: { mode: "rainbow" } }),
      "overlay1",
    );
    expect(read.declared).toBeUndefined();
    expect(read.invalid.length).toBeGreaterThan(0);
  });

  it("reads a solid declaration with a colour and a weight", () => {
    const read = readDeclaredBorder(
      layerWith({ border: { mode: "solid", color: "#FF0000", weight: 2 } }),
      "overlay1",
    );
    expect(read.invalid).toEqual([]);
    expect(read.declared).toBe(STYLE_MODE.SOLID);
    expect(read.declaredColor).toBe("#ff0000");
    expect(read.declaredWeight).toBe(2);
  });

  it("a colour alone implies the solid mode", () => {
    const read = readDeclaredBorder(
      layerWith({ border: { color: "#abc" } }),
      "overlay1",
    );
    expect(read.invalid).toEqual([]);
    expect(read.declared).toBe(STYLE_MODE.SOLID);
    expect(read.declaredColor).toBe("#aabbcc");
  });

  it("a weight alone implies the solid mode", () => {
    const read = readDeclaredBorder(layerWith({ border: { weight: 3 } }), "overlay1");
    expect(read.invalid).toEqual([]);
    expect(read.declared).toBe(STYLE_MODE.SOLID);
    expect(read.declaredWeight).toBe(3);
  });

  it("reads an explicit original declaration (weight still rides it)", () => {
    const read = readDeclaredBorder(
      layerWith({ border: { mode: "original", weight: 1.5 } }),
      "overlay1",
    );
    expect(read.invalid).toEqual([]);
    expect(read.declared).toBe(STYLE_MODE.ORIGINAL);
    expect(read.declaredWeight).toBe(1.5);
  });

  it("weight rides the follow_fill mode", () => {
    const read = readDeclaredBorder(
      layerWith({ border: { mode: "follow_fill", weight: 2 } }),
      "overlay1",
    );
    expect(read.invalid).toEqual([]);
    expect(read.declared).toBe(STYLE_MODE.FOLLOW_FILL);
    expect(read.declaredWeight).toBe(2);
  });

  it("rejects an invalid weight and keeps the mode", () => {
    for (const weight of [0, -1, "2", true, Number.NaN]) {
      const read = readDeclaredBorder(
        layerWith({ border: { mode: "solid", weight } }),
        "overlay1",
      );
      expect(read.declared).toBe(STYLE_MODE.SOLID);
      expect(read.declaredWeight).toBeUndefined();
      expect(read.invalid.length).toBeGreaterThan(0);
      expect(read.invalid[0]).toContain("invalid border.weight");
    }
  });

  it("rejects an invalid colour and keeps the mode", () => {
    for (const color of ["red", "#12", 7, ""]) {
      const read = readDeclaredBorder(
        layerWith({ border: { mode: "solid", color } }),
        "overlay1",
      );
      expect(read.declared).toBe(STYLE_MODE.SOLID);
      expect(read.declaredColor).toBeUndefined();
      expect(read.invalid.length).toBeGreaterThan(0);
      expect(read.invalid[0]).toContain("invalid border.color");
    }
  });

  it("drops a solid declaration that carries a value-mode field", () => {
    const read = readDeclaredBorder(
      layerWith({ border: { mode: "solid", field: "count" } }),
      "overlay1",
    );
    expect(read.declared).toBeUndefined();
    expect(read.invalid.join(" ")).toContain("contradicts");
  });

  it("drops a value declaration that carries a solid colour", () => {
    const read = readDeclaredBorder(
      layerWith({ border: { mode: "value", field: "count", color: "#ff0000" } }),
      "overlay1",
    );
    expect(read.declared).toBeUndefined();
    expect(read.invalid.join(" ")).toContain("contradicts");
  });

  it("drops a follow-fill declaration that carries a value-mode key", () => {
    const read = readDeclaredBorder(
      layerWith({ border: { mode: "follow_fill", scheme: "Reds" } }),
      "overlay1",
    );
    expect(read.declared).toBeUndefined();
    expect(read.invalid.join(" ")).toContain("does not classify by value");
  });

  it("rejects an explicit value mode without a field", () => {
    const read = readDeclaredBorder(layerWith({ border: { mode: "value" } }), "overlay1");
    expect(read.declared).toBeUndefined();
    expect(read.invalid[0]).toContain("requires border.field");
  });

  it("caches per layer object: a second read does not re-validate", () => {
    const layer = layerWith({ border: { mode: "follow_fill" } });
    const first = readDeclaredBorder(layer, "overlay1");
    const second = readDeclaredBorder(layer, "overlay1");
    expect(second).toBe(first);
  });

  it("does not cache a null layer (the declaration may still arrive)", () => {
    const first = readDeclaredBorder(null, "overlay1");
    const second = readDeclaredBorder(null, "overlay1");
    expect(first.invalid).toEqual([]);
    expect(first.declared).toBeUndefined();
    expect(second).toEqual(first);
  });

  it("warns with the unregistered scope when no layerId is known (undefined layerId)", () => {
    const read = readDeclaredBorder(layerWith({ border: { mode: "rainbow" } }));
    expect(read.declared).toBeUndefined();
    expect(read.invalid.length).toBeGreaterThan(0);
  });

  it("reads a value-mode shell declaration", () => {
    const read = readDeclaredBorder(
      layerWith({ border: { mode: "value", field: "score", scheme: "Reds" } }),
      "overlay1",
    );
    expect(read.invalid).toEqual([]);
    expect(read.declared).toBe(STYLE_MODE.VALUE);
    expect(read.declaredValue).toEqual({
      field: "score",
      method: "jenks",
      classes: 6,
      scheme: "Reds",
    });
  });

  it("reads the flat fill-isomorphic form as an implicit value mode", () => {
    const read = readDeclaredBorder(
      layerWith({ border: { field: "score", scheme: "Reds" } }),
      "overlay1",
    );
    expect(read.invalid).toEqual([]);
    expect(read.declared).toBe(STYLE_MODE.VALUE);
    expect(read.declaredValue?.field).toBe("score");
    expect(read.declaredValue?.scheme).toBe("Reds");
  });

  it("rejects a value mode without a field (value mode requires one)", () => {
    const read = readDeclaredBorder(
      layerWith({ border: { mode: "value" } }),
      "overlay1",
    );
    expect(read.declared).toBeUndefined();
    expect(read.invalid.length).toBeGreaterThan(0);
  });

  it("rejects a follow_fill mode with a field (contradiction)", () => {
    const read = readDeclaredBorder(
      layerWith({ border: { mode: "follow_fill", field: "score" } }),
      "overlay1",
    );
    expect(read.declared).toBeUndefined();
    expect(read.invalid.length).toBeGreaterThan(0);
  });

  it("reads an explicit category value declaration", () => {
    const read = readDeclaredBorder(
      layerWith({
        border: {
          mode: "value",
          field: "cls",
          kind: "category",
          scheme: "Set1",
        },
      }),
      "overlay1",
    );
    expect(read.invalid).toEqual([]);
    expect(read.declared).toBe(STYLE_MODE.VALUE);
    expect(read.declaredValue?.kind).toBe("category");
    expect(read.declaredValue?.scheme).toBe("Set1");
  });

  it("reads the declared value config but not the mode shell keys into it", () => {
    const read = readDeclaredBorder(
      layerWith({ border: { mode: "value", field: "score", classes: 7 } }),
      "overlay1",
    );
    expect(read.invalid).toEqual([]);
    expect(read.declared).toBe(STYLE_MODE.VALUE);
    expect(read.declaredValue?.classes).toBe(7);
  });

  it("rejects a value declaration whose shared schema is unbuildable (invalid kind)", () => {
    const read = readDeclaredBorder(
      layerWith({ border: { mode: "value", field: "score", kind: "bogus" } }),
      "overlay1",
    );
    expect(read.declared).toBeUndefined();
    expect(read.invalid.length).toBeGreaterThan(0);
  });
});
