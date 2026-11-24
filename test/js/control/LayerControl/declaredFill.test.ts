import { describe, expect, it, vi } from "vitest";
import { STYLE_MODE } from "#core/layer/index.js";
import { readDeclaredFill } from "#control/LayerControl/declaredFill.js";

/** A linked carrier carrying a foliplus declaration. Fresh object per test:
 *  the reader caches per layer object, the way a folium layer's options are
 *  final once it exists. */
const layerWith = (foliplus: unknown) => ({ options: { foliplus } }) as never;

/** A wrapper group whose child (not the group itself) carries the namespace —
 *  the layer a control registers is not always the node folium stamped. */
const wrapperWith = (foliplus: unknown) => {
  const child = { options: { foliplus } };
  return {
    options: {},
    eachLayer: (fn: (node: unknown) => void) => fn(child),
  } as never;
};

// The declaration is a flat mapping. Fill accepts two modes expressed by the
// same key set: the value mode (field + optional method/classes/scheme/kind)
// and the solid mode (color + opacity). "mode" may name solid/value/original
// explicitly; absent, a field implies value and a color/opacity implies solid.
// Opacity rides every mode (the sub-dimension the panel can set in each).

describe("readDeclaredFill", () => {
  it("reads a full value-mode declaration (kind absent reads numeric)", () => {
    const read = readDeclaredFill(
      layerWith({
        fill: { field: "score", method: "equal", classes: 5, scheme: "Reds" },
      }),
      "overlay1",
    );

    expect(read.invalid).toEqual([]);
    expect(read.declared).toEqual({
      mode: STYLE_MODE.VALUE,
      value: {
        field: "score",
        method: "equal",
        classes: 5,
        scheme: "Reds",
      },
    });
  });

  it("naming only the field turns the value mode on with the panel defaults", () => {
    const read = readDeclaredFill(layerWith({ fill: { field: "score" } }));

    expect(read.invalid).toEqual([]);
    expect(read.declared).toEqual({
      mode: STYLE_MODE.VALUE,
      value: {
        field: "score",
        method: "jenks",
        classes: 6,
        scheme: "Viridis",
      },
    });
  });

  it("kind:numeric is the same as absent — no kind key on the record", () => {
    const read = readDeclaredFill(
      layerWith({ fill: { kind: "numeric", field: "score" } }),
      "overlay1",
    );
    expect(read.invalid).toEqual([]);
    expect(read.declared?.value).toEqual({
      field: "score",
      method: "jenks",
      classes: 6,
      scheme: "Viridis",
    });
  });

  it("reads a solid declaration with a colour and an opacity", () => {
    const read = readDeclaredFill(
      layerWith({ fill: { mode: "solid", color: "#FF0000", opacity: 0.5 } }),
      "overlay1",
    );
    expect(read.invalid).toEqual([]);
    expect(read.declared).toEqual({
      mode: STYLE_MODE.SOLID,
      color: "#ff0000",
      opacity: 0.5,
    });
  });

  it("a colour alone implies the solid mode", () => {
    const read = readDeclaredFill(layerWith({ fill: { color: "#abc" } }));
    expect(read.invalid).toEqual([]);
    expect(read.declared).toEqual({ mode: STYLE_MODE.SOLID, color: "#aabbcc" });
  });

  it("an opacity alone implies the solid mode", () => {
    const read = readDeclaredFill(layerWith({ fill: { opacity: 0.4 } }));
    expect(read.invalid).toEqual([]);
    expect(read.declared).toEqual({ mode: STYLE_MODE.SOLID, opacity: 0.4 });
  });

  it("reads an explicit original declaration (opacity still rides it)", () => {
    const read = readDeclaredFill(
      layerWith({ fill: { mode: "original", opacity: 0.8 } }),
      "overlay1",
    );
    expect(read.invalid).toEqual([]);
    expect(read.declared).toEqual({ mode: STYLE_MODE.ORIGINAL, opacity: 0.8 });
  });

  it("opacity rides the value mode", () => {
    const read = readDeclaredFill(
      layerWith({ fill: { mode: "value", field: "score", opacity: 0.3 } }),
      "overlay1",
    );
    expect(read.invalid).toEqual([]);
    expect(read.declared?.mode).toBe(STYLE_MODE.VALUE);
    expect(read.declared?.opacity).toBe(0.3);
    expect(read.declared?.value?.field).toBe("score");
  });

  it("drops a declaration without a mode, field, colour or opacity", () => {
    const read = readDeclaredFill(layerWith({ fill: {} }), "overlay1");
    expect(read.declared).toBeUndefined();
    expect(read.invalid).toHaveLength(1);
    expect(read.invalid[0]).toContain("without fill.mode");
  });

  it("rejects an unknown mode instead of guessing one", () => {
    const read = readDeclaredFill(
      layerWith({ fill: { mode: "rainbow", field: "score" } }),
      "overlay1",
    );
    expect(read.declared).toBeUndefined();
    expect(read.invalid).toHaveLength(1);
    expect(read.invalid[0]).toContain("invalid fill.mode");
  });

  it("drops a solid declaration that carries a value-mode field", () => {
    const read = readDeclaredFill(
      layerWith({ fill: { mode: "solid", field: "score" } }),
      "overlay1",
    );
    expect(read.declared).toBeUndefined();
    expect(read.invalid.join(" ")).toContain("contradicts");
  });

  it("drops a value declaration that carries a solid colour", () => {
    const read = readDeclaredFill(
      layerWith({ fill: { mode: "value", field: "score", color: "#ff0000" } }),
      "overlay1",
    );
    expect(read.declared).toBeUndefined();
    expect(read.invalid.join(" ")).toContain("contradicts");
  });

  it("drops an original declaration that carries a colour", () => {
    const read = readDeclaredFill(
      layerWith({ fill: { mode: "original", color: "#ff0000" } }),
      "overlay1",
    );
    expect(read.declared).toBeUndefined();
    expect(read.invalid.join(" ")).toContain("contradicts");
  });

  it("drops a declaration without a usable field instead of painting a solid face", () => {
    const read = readDeclaredFill(layerWith({ fill: { method: "equal" } }), "overlay1");
    expect(read.declared).toBeUndefined();
    expect(read.invalid.length).toBeGreaterThan(0);
  });

  it("rejects a field that is not a property name", () => {
    for (const field of ["", "   ", 42, null]) {
      const read = readDeclaredFill(layerWith({ fill: { field } }), "overlay1");
      expect(read.declared).toBeUndefined();
      expect(read.invalid.some(m => m.includes("invalid fill.field"))).toBe(true);
    }
  });

  it("still ignores the cancelled nested ramp shell as an unknown key", () => {
    const read = readDeclaredFill(
      layerWith({ fill: { field: "score", ramp: { field: "a" } } }),
      "overlay1",
    );
    expect(read.declared?.mode).toBe(STYLE_MODE.VALUE);
    expect(read.invalid).toHaveLength(1);
    expect(read.invalid[0]).toContain('"ramp"');
  });

  it("ignores a typo key and keeps the known keys", () => {
    const read = readDeclaredFill(
      layerWith({ fill: { field: "score", future: true } }),
      "overlay1",
    );
    expect(read.declared?.value).toMatchObject({ field: "score" });
    expect(read.invalid).toHaveLength(1);
    expect(read.invalid[0]).toContain('"future"');
  });

  it("drops each invalid value key and keeps the rest of the declaration", () => {
    const read = readDeclaredFill(
      layerWith({
        fill: { field: "score", method: "kmeans", classes: 2.5, scheme: "" },
      }),
      "overlay1",
    );
    expect(read.invalid).toHaveLength(3);
    expect(read.declared?.value).toEqual({
      field: "score",
      method: "jenks",
      classes: 6,
      scheme: "Viridis",
    });
  });

  it("rejects an invalid colour and keeps the mode", () => {
    for (const color of ["red", "#12", 7, ""]) {
      const read = readDeclaredFill(
        layerWith({ fill: { mode: "solid", color } }),
        "overlay1",
      );
      expect(read.declared).toEqual({ mode: STYLE_MODE.SOLID });
      expect(read.invalid).toHaveLength(1);
      expect(read.invalid[0]).toContain("invalid fill.color");
    }
  });

  it("rejects an out-of-range opacity and keeps the mode", () => {
    for (const opacity of [-0.1, 1.1, "0.5", true, Number.NaN]) {
      const read = readDeclaredFill(
        layerWith({ fill: { mode: "solid", opacity } }),
        "overlay1",
      );
      expect(read.declared).toEqual({ mode: STYLE_MODE.SOLID });
      expect(read.invalid).toHaveLength(1);
      expect(read.invalid[0]).toContain("invalid fill.opacity");
    }
  });

  it("keeps a declared class count above the editable range", () => {
    const read = readDeclaredFill(
      layerWith({ fill: { field: "score", classes: 12 } }),
      "overlay1",
    );
    expect(read.invalid).toEqual([]);
    expect(read.declared?.value).toMatchObject({ classes: 12 });
  });

  it("keeps a declared class count below the panel default", () => {
    const read = readDeclaredFill(
      layerWith({ fill: { field: "score", classes: 2 } }),
      "overlay1",
    );
    expect(read.invalid).toEqual([]);
    expect(read.declared?.value).toMatchObject({ classes: 2 });
  });

  it("rejects a class count a classifier cannot build", () => {
    for (const classes of [1, 0, -3, 2.5, "4"]) {
      const read = readDeclaredFill(
        layerWith({ fill: { field: "score", classes } }),
        "overlay1",
      );
      expect(read.invalid).toHaveLength(1);
      expect(read.invalid[0]).toContain("invalid fill.classes");
      expect(read.declared?.value).toMatchObject({ classes: 6 });
    }
  });

  it("rejects an invalid method and falls back to the default", () => {
    const read = readDeclaredFill(
      layerWith({ fill: { field: "score", method: "bogus" } }),
      "overlay1",
    );
    expect(read.invalid).toHaveLength(1);
    expect(read.invalid[0]).toContain("invalid fill.method");
    expect(read.declared?.value).toMatchObject({ method: "jenks" });
  });

  it("rejects an invalid scheme and falls back to the default", () => {
    const read = readDeclaredFill(
      layerWith({ fill: { field: "score", scheme: "" } }),
      "overlay1",
    );
    expect(read.invalid).toHaveLength(1);
    expect(read.invalid[0]).toContain("invalid fill.scheme");
    expect(read.declared?.value).toMatchObject({ scheme: "Viridis" });
  });

  it("rejects a non-object declaration", () => {
    const read = readDeclaredFill(layerWith({ fill: "ramp" }), "overlay1");
    expect(read.declared).toBeUndefined();
    expect(read.invalid).toHaveLength(1);
    expect(read.invalid[0]).toContain("non-object fill declaration");
  });

  it("names an unregistered layer as such when it warns", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const read = readDeclaredFill(layerWith({ fill: { field: "score", bogus: 1 } }));

    expect(read.invalid).toHaveLength(1);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('on layer "<unregistered>"'),
    );
    warn.mockRestore();
  });

  it("returns empty for a layer with no foliplus namespace", () => {
    expect(readDeclaredFill({ options: {} } as never).declared).toBeUndefined();
    expect(readDeclaredFill(null).declared).toBeUndefined();
    expect(readDeclaredFill(undefined).declared).toBeUndefined();
  });

  it("does not cache a null / non-object layer read", () => {
    const first = readDeclaredFill(null);
    const second = readDeclaredFill(null);
    expect(first).toEqual({ invalid: [] });
    expect(second).toEqual({ invalid: [] });
  });

  it("reads only the carrier's own options — no tree scan", () => {
    expect(
      readDeclaredFill(wrapperWith({ fill: { field: "count" } })).declared,
    ).toBeUndefined();
  });

  it("caches the declaration per layer object", () => {
    const layer = { options: { foliplus: { fill: { field: "a" } } } };
    const first = readDeclaredFill(layer as never);
    (layer.options.foliplus.fill as Record<string, unknown>).field = "b";
    const second = readDeclaredFill(layer as never);
    expect(second).toBe(first);
    expect(second.declared?.value?.field).toBe("a");
  });

  it("reads a category declaration", () => {
    const read = readDeclaredFill(
      layerWith({ fill: { kind: "category", field: "kind", scheme: "Set3" } }),
      "overlay1",
    );
    expect(read.invalid).toEqual([]);
    expect(read.declared).toEqual({
      mode: STYLE_MODE.VALUE,
      value: {
        kind: "category",
        field: "kind",
        method: "jenks",
        classes: 6,
        scheme: "Set3",
      },
    });
  });

  it("rejects a category declaration without a scheme", () => {
    const read = readDeclaredFill(
      layerWith({ fill: { kind: "category", field: "kind" } }),
      "overlay1",
    );
    expect(read.declared).toBeUndefined();
    expect(read.invalid).toHaveLength(1);
    expect(read.invalid[0]).toContain("without a fill.scheme");
  });

  it("rejects a category declaration with a non-name scheme", () => {
    const read = readDeclaredFill(
      layerWith({ fill: { kind: "category", field: "kind", scheme: "" } }),
      "overlay1",
    );
    expect(read.declared).toBeUndefined();
    expect(read.invalid).toHaveLength(1);
    expect(read.invalid[0]).toContain("invalid fill.scheme");
  });

  it("rejects an unrecognized kind instead of misapplying it", () => {
    const read = readDeclaredFill(
      layerWith({ fill: { kind: "rainbow", field: "score" } }),
      "overlay1",
    );
    expect(read.declared).toBeUndefined();
    expect(read.invalid).toHaveLength(1);
    expect(read.invalid[0]).toContain("invalid fill.kind");
  });
});
