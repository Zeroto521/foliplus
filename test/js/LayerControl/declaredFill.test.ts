import { describe, expect, it } from "vitest";
import { readDeclaredFill } from "#foliplus/LayerControl/declaredFill.js";

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

describe("readDeclaredFill", () => {
  it("reads a full ramp declaration", () => {
    const read = readDeclaredFill(
      layerWith({
        fill: {
          mode: "ramp",
          ramp: { field: "score", method: "equal", classes: 5, scheme: "Reds" },
        },
      }),
      "overlay1",
    );

    expect(read.invalid).toEqual([]);
    expect(read.declared).toEqual({
      mode: "ramp",
      ramp: {
        kind: "numeric",
        field: "score",
        method: "equal",
        classes: 5,
        scheme: "Reds",
      },
    });
  });

  it("naming only the field turns the ramp arm on with the panel defaults", () => {
    // Declaring a field IS the instruction (the annotation declaration reads
    // the same way); the other keys fall back to what the panel offers.
    const read = readDeclaredFill(layerWith({ fill: { ramp: { field: "score" } } }));

    expect(read.declared).toEqual({
      mode: "ramp",
      ramp: {
        kind: "numeric",
        field: "score",
        method: "jenks",
        classes: 6,
        scheme: "Viridis",
      },
    });
  });

  it("mode solid alone declares no ramp", () => {
    const read = readDeclaredFill(layerWith({ fill: { mode: "solid" } }));
    expect(read.declared).toEqual({ mode: "solid" });
  });

  it("mode solid wins over a ramp given beside it", () => {
    // The panel's arms are exclusive; an explicit solid is the author saying
    // "do not paint by value", so the stored ramp is ignored (the same rule a
    // panel mode=solid applies to a kept ramp config).
    const read = readDeclaredFill(
      layerWith({ fill: { mode: "solid", ramp: { field: "score" } } }),
    );
    expect(read.declared?.mode).toBe("solid");
    expect(read.declared?.ramp).toBeDefined();
  });

  it("drops a ramp without a usable field instead of painting a misleading solid face", () => {
    const read = readDeclaredFill(
      layerWith({ fill: { mode: "ramp", ramp: { method: "equal" } } }),
      "overlay1",
    );
    expect(read.declared).toBeUndefined();
    expect(read.invalid).toHaveLength(1);
  });

  it("drops each invalid key and keeps the rest of the declaration", () => {
    const read = readDeclaredFill(
      layerWith({
        fill: {
          mode: "rainbow",
          ramp: { field: "score", method: "kmeans", classes: 3, scheme: "" },
        },
      }),
      "overlay1",
    );

    // Three rejected keys, none fatal: the field survives, so the arm stays on
    // with the panel defaults for the rejected keys.
    expect(read.invalid).toHaveLength(3);
    expect(read.declared).toEqual({
      mode: "ramp",
      ramp: {
        kind: "numeric",
        field: "score",
        method: "jenks",
        classes: 3,
        scheme: "Viridis",
      },
    });
  });

  it("keeps a declared class count above the editable range", () => {
    // 2..9 is the panel's vocabulary, not the author's: a declared 12 is
    // painted and displayed as 12. Clamping it to 9 here would be exactly the
    // silent "declared 12, painted 6" deviation this reader exists to prevent.
    const read = readDeclaredFill(
      layerWith({ fill: { ramp: { field: "score", classes: 12 } } }),
      "overlay1",
    );

    expect(read.invalid).toEqual([]);
    expect(read.declared).toMatchObject({ ramp: { classes: 12 } });
  });

  it("keeps a declared class count below the panel default", () => {
    // MIN is 2; the lower bound is a buildability limit (one class cannot
    // classify), not a preference.
    const read = readDeclaredFill(
      layerWith({ fill: { ramp: { field: "score", classes: 2 } } }),
      "overlay1",
    );

    expect(read.invalid).toEqual([]);
    expect(read.declared).toMatchObject({ ramp: { classes: 2 } });
  });

  it("rejects a class count a classifier cannot build", () => {
    for (const classes of [1, 0, -3, 2.5, "4"]) {
      const read = readDeclaredFill(
        layerWith({ fill: { ramp: { field: "score", classes } } }),
        "overlay1",
      );
      // The key is dropped, not the declaration: the field still names the arm.
      expect(read.invalid).toHaveLength(1);
      expect(read.declared).toMatchObject({ ramp: { classes: 6 } });
    }
  });

  it("rejects a ramp that is not an object instead of half-reading it", () => {
    // A ramp declaration is an object or it is nothing: a string, an array or a
    // number has no keys to salvage, so one rejection stands for the whole key.
    // There is no partial reading to fall back on — and with no usable field
    // the arm cannot turn on either.
    for (const ramp of ["Reds", ["field", "score"], 5]) {
      const read = readDeclaredFill(layerWith({ fill: { ramp } }), "overlay1");
      expect(read.declared).toBeUndefined();
      expect(read.invalid).toHaveLength(1);
      expect(read.invalid[0]).toContain("non-object ramp declaration");
    }
  });

  it("rejects a ramp.field that is not a property name", () => {
    // A blank or non-string name classifies nothing. The key is dropped (the
    // rest of the ramp survives), and with no other usable field the whole
    // declaration falls away rather than painting a solid face under a ramp
    // panel state.
    for (const field of ["", "   ", 42, null]) {
      const read = readDeclaredFill(
        layerWith({ fill: { ramp: { field } } }),
        "overlay1",
      );
      expect(read.declared).toBeUndefined();
      expect(read.invalid).toHaveLength(1);
      expect(read.invalid[0]).toContain("invalid ramp.field");
    }
  });

  it("reads an object with no recognised key as an empty declaration", () => {
    // Forward compatibility: a key this reader does not know is not an error
    // (a newer folium could stamp one), and an object that names no arm and no
    // field declares nothing at all.
    for (const fill of [{}, { future: true }]) {
      const read = readDeclaredFill(layerWith({ fill }), "overlay1");
      expect(read.declared).toBeUndefined();
      expect(read.invalid).toEqual([]);
    }
  });

  it("rejects a non-object declaration", () => {
    const read = readDeclaredFill(layerWith({ fill: "ramp" }), "overlay1");
    expect(read.declared).toBeUndefined();
    expect(read.invalid).toHaveLength(1);
  });

  it("returns empty for a layer with no foliplus namespace", () => {
    expect(readDeclaredFill({ options: {} } as never).declared).toBeUndefined();
    expect(readDeclaredFill(null).declared).toBeUndefined();
    expect(readDeclaredFill(undefined).declared).toBeUndefined();
  });

  it("reads only the carrier's own options — no tree scan", () => {
    // folium stamps the namespace on the layer it renders, which is the layer
    // LayerControl registers. The reader deliberately does not walk a group's
    // children: the attach sweep reads every layer, and a per-layer tree scan
    // is the cost the controller's "unattributed add scans no tree" invariant
    // forbids.
    expect(
      readDeclaredFill(wrapperWith({ fill: { ramp: { field: "count" } } })).declared,
    ).toBeUndefined();
  });

  it("caches the declaration per layer object", () => {
    const layer = { options: { foliplus: { fill: { ramp: { field: "a" } } } } };
    const first = readDeclaredFill(layer as never);
    // The layer's options are final once it exists; a second read must not
    // re-walk the tree (the declaration is static).
    (layer.options.foliplus.fill as Record<string, unknown>).ramp = {
      field: "b",
    };
    const second = readDeclaredFill(layer as never);
    expect(second).toBe(first);
    expect(second.declared?.ramp?.field).toBe("a");
  });
});
