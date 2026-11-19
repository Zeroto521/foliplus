import { describe, expect, it } from "vitest";
import { STYLE_MODE } from "#core/layer/index.js";
import { readDeclaredBorder } from "#control/LayerControl/declaredParse.js";

/** A linked carrier carrying a foliplus border declaration. Fresh object per
 *  test: the reader caches per layer object, the way a folium layer's
 *  options are final once it exists. */
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

  it("rejects a border without a mode", () => {
    const read = readDeclaredBorder(layerWith({ border: {} }), "overlay1");
    expect(read.declared).toBeUndefined();
    expect(read.invalid.length).toBeGreaterThan(0);
  });

  it("rejects an unknown border mode", () => {
    const read = readDeclaredBorder(
      layerWith({ border: { mode: "solid" } }),
      "overlay1",
    );
    expect(read.declared).toBeUndefined();
    expect(read.invalid.length).toBeGreaterThan(0);
  });

  it("warns on an unknown key but keeps the valid mode (one-by-one warn)", () => {
    const read = readDeclaredBorder(
      layerWith({ border: { mode: "follow_fill", weight: 3 } }),
      "overlay1",
    );
    // The valid mode survives; the extra key is a typo to surface, never a
    // reason to drop the author's follow_fill intent.
    expect(read.declared).toBe(STYLE_MODE.FOLLOW_FILL);
    expect(read.invalid.length).toBeGreaterThan(0);
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
    // A declaration read before the layer is linked has no id; the warn scope
    // falls back to an empty label and "<unregistered>" in the message — the
    // nullish arms of reject(). Both arms are part of the public reader contract.
    const read = readDeclaredBorder(layerWith({ border: { mode: "solid" } }));
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
});
