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
          ramp: { field: "score", method: "kmeans", classes: 12, scheme: "" },
        },
      }),
      "overlay1",
    );

    // Four rejected keys, none fatal: the field survives, so the arm stays on
    // with the panel defaults. classes 12 is dropped, never clamped — the
    // panel must not claim a range the author never asked for.
    expect(read.invalid).toHaveLength(4);
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
