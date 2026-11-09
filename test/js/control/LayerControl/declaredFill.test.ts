import { describe, expect, it, vi } from "vitest";
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

// The flat declaration shape: field(required) / method / classes / scheme /
// kind(optional override). The old nested {mode, ramp} shell is now an
// unknown-key pair that is ignored one by one (warn once) — never re-read.

describe("readDeclaredFill", () => {
  it("reads a full flat declaration (kind absent reads numeric)", () => {
    // kind is deliberately omitted on the numeric variant (absent = numeric,
    // resolved by inference in fill.ts) — the declared record carries no kind
    // key. method/classes/scheme are kept verbatim.
    const read = readDeclaredFill(
      layerWith({
        fill: { field: "score", method: "equal", classes: 5, scheme: "Reds" },
      }),
      "overlay1",
    );

    expect(read.invalid).toEqual([]);
    expect(read.declared).toEqual({
      field: "score",
      method: "equal",
      classes: 5,
      scheme: "Reds",
    });
  });

  it("naming only the field turns the variant on with the panel defaults", () => {
    // Declaring a field IS the instruction; the other keys fall back to what
    // the panel offers.
    const read = readDeclaredFill(layerWith({ fill: { field: "score" } }));

    expect(read.invalid).toEqual([]);
    expect(read.declared).toEqual({
      field: "score",
      method: "jenks",
      classes: 6,
      scheme: "Viridis",
    });
  });

  it("kind:numeric is the same as absent — no kind key on the record", () => {
    const read = readDeclaredFill(
      layerWith({ fill: { kind: "numeric", field: "score" } }),
      "overlay1",
    );
    expect(read.invalid).toEqual([]);
    expect(read.declared).toEqual({
      field: "score",
      method: "jenks",
      classes: 6,
      scheme: "Viridis",
    });
  });

  it("drops a declaration without a usable field instead of painting a solid face", () => {
    const read = readDeclaredFill(layerWith({ fill: { method: "equal" } }), "overlay1");
    expect(read.declared).toBeUndefined();
    expect(read.invalid).toHaveLength(1);
    expect(read.invalid[0]).toContain("without a fill.field");
  });

  it("rejects a field that is not a property name", () => {
    // A blank or non-string name classifies nothing. The field is fatal: with
    // no other usable field the whole declaration falls away.
    for (const field of ["", "   ", 42, null]) {
      const read = readDeclaredFill(layerWith({ fill: { field } }), "overlay1");
      expect(read.declared).toBeUndefined();
      // A bad value reports the invalid field first, then the missing-field
      // fatal message.
      expect(read.invalid.some(m => m.includes("invalid fill.field"))).toBe(true);
    }
  });

  it("ignores the cancelled ramp shell and mode switch as unknown keys", () => {
    // The old nested shape is not read anymore: both keys are unknown, ignored
    // one by one (warn once each) and the rest of the declaration survives.
    const read = readDeclaredFill(
      layerWith({ fill: { field: "score", ramp: { field: "a" }, mode: "ramp" } }),
      "overlay1",
    );
    expect(read.declared).toEqual({
      field: "score",
      method: "jenks",
      classes: 6,
      scheme: "Viridis",
    });
    expect(read.invalid).toHaveLength(2);
    expect(read.invalid.join(" ")).toContain('"ramp"');
    expect(read.invalid.join(" ")).toContain('"mode"');
  });

  it("ignores a typo key and keeps the known keys", () => {
    const read = readDeclaredFill(
      layerWith({ fill: { field: "score", future: true } }),
      "overlay1",
    );
    expect(read.declared).toMatchObject({ field: "score" });
    expect(read.invalid).toHaveLength(1);
    expect(read.invalid[0]).toContain('"future"');
  });

  it("drops each invalid key and keeps the rest of the declaration", () => {
    const read = readDeclaredFill(
      layerWith({
        fill: { field: "score", method: "kmeans", classes: 2.5, scheme: "" },
      }),
      "overlay1",
    );

    // Three rejected keys (method/classes/scheme), none fatal: the field
    // survives, so the variant stays on with the panel defaults for the rejected
    // keys.
    expect(read.invalid).toHaveLength(3);
    expect(read.declared).toEqual({
      field: "score",
      method: "jenks",
      classes: 6,
      scheme: "Viridis",
    });
  });

  it("keeps a declared class count above the editable range", () => {
    // 2..9 is the panel's vocabulary, not the author's: a declared 12 is
    // painted and displayed as 12. Clamping it to 9 here would be exactly the
    // silent "declared 12, painted 6" deviation this reader exists to prevent.
    const read = readDeclaredFill(
      layerWith({ fill: { field: "score", classes: 12 } }),
      "overlay1",
    );

    expect(read.invalid).toEqual([]);
    expect(read.declared).toMatchObject({ classes: 12 });
  });

  it("keeps a declared class count below the panel default", () => {
    // MIN is 2; the lower bound is a buildability limit (one class cannot
    // classify), not a preference.
    const read = readDeclaredFill(
      layerWith({ fill: { field: "score", classes: 2 } }),
      "overlay1",
    );

    expect(read.invalid).toEqual([]);
    expect(read.declared).toMatchObject({ classes: 2 });
  });

  it("rejects a class count a classifier cannot build", () => {
    for (const classes of [1, 0, -3, 2.5, "4"]) {
      const read = readDeclaredFill(
        layerWith({ fill: { field: "score", classes } }),
        "overlay1",
      );
      // The key is dropped, not the declaration: the field still names the variant.
      expect(read.invalid).toHaveLength(1);
      expect(read.invalid[0]).toContain("invalid fill.classes");
      expect(read.declared).toMatchObject({ classes: 6 });
    }
  });

  it("rejects an invalid method and falls back to the default", () => {
    const read = readDeclaredFill(
      layerWith({ fill: { field: "score", method: "bogus" } }),
      "overlay1",
    );
    expect(read.invalid).toHaveLength(1);
    expect(read.invalid[0]).toContain("invalid fill.method");
    expect(read.declared).toMatchObject({ method: "jenks" });
  });

  it("rejects an invalid scheme and falls back to the default", () => {
    const read = readDeclaredFill(
      layerWith({ fill: { field: "score", scheme: "" } }),
      "overlay1",
    );
    expect(read.invalid).toHaveLength(1);
    expect(read.invalid[0]).toContain("invalid fill.scheme");
    expect(read.declared).toMatchObject({ scheme: "Viridis" });
  });

  it("rejects a non-object declaration", () => {
    const read = readDeclaredFill(layerWith({ fill: "ramp" }), "overlay1");
    expect(read.declared).toBeUndefined();
    expect(read.invalid).toHaveLength(1);
    expect(read.invalid[0]).toContain("non-object fill declaration");
  });

  it("drops an empty fill object (no field names no variant)", () => {
    // field is the one required key; an object with no usable field cannot
    // turn any variant on, so it is dropped whole.
    const read = readDeclaredFill(layerWith({ fill: {} }), "overlay1");
    expect(read.declared).toBeUndefined();
    expect(read.invalid).toHaveLength(1);
    expect(read.invalid[0]).toContain("without a fill.field");
  });

  it("names an unregistered layer as such when it warns", () => {
    // The attach sweep reads layers it finds, so a read can run before the layer
    // has an id. The warning still has to point somewhere: the message spells
    // the missing id out instead of printing "undefined".
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
    // A null layer's declaration may still arrive with the late-linked carrier,
    // so the empty read must not be cached.
    const first = readDeclaredFill(null);
    const second = readDeclaredFill(null);
    expect(first).toEqual({ invalid: [] });
    expect(second).toEqual({ invalid: [] });
  });

  it("reads only the carrier's own options — no tree scan", () => {
    // folium stamps the namespace on the layer it renders, which is the layer
    // LayerControl registers. The reader deliberately does not walk a group's
    // children: the attach sweep reads every layer, and a per-layer tree scan
    // is the cost the controller's "unattributed add scans no tree" invariant
    // forbids.
    expect(
      readDeclaredFill(wrapperWith({ fill: { field: "count" } })).declared,
    ).toBeUndefined();
  });

  it("caches the declaration per layer object", () => {
    const layer = { options: { foliplus: { fill: { field: "a" } } } };
    const first = readDeclaredFill(layer as never);
    // The layer's options are final once it exists; a second read must not
    // re-walk the tree (the declaration is static).
    (layer.options.foliplus.fill as Record<string, unknown>).field = "b";
    const second = readDeclaredFill(layer as never);
    expect(second).toBe(first);
    expect(second.declared?.field).toBe("a");
  });

  it("reads a category declaration", () => {
    // The categorical variant: kind:"category" + field + scheme. method/classes
    // are irrelevant and deliberately not validated — the declaration keeps
    // the type-level defaults so the union stays assignable to RampConfig.
    const read = readDeclaredFill(
      layerWith({ fill: { kind: "category", field: "kind", scheme: "Set3" } }),
      "overlay1",
    );

    expect(read.invalid).toEqual([]);
    expect(read.declared).toEqual({
      kind: "category",
      field: "kind",
      method: "jenks",
      classes: 6,
      scheme: "Set3",
    });
  });

  it("rejects a category declaration without a scheme", () => {
    // A category palette is the one key beyond the field a category ramp
    // cannot build without; dropping it is fatal, not a degrade.
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
    // The persistence reader drops an unknown kind whole; the declaration
    // reader must apply the same rule so a declaration this client cannot
    // build is never silently painted as a numeric ramp.
    const read = readDeclaredFill(
      layerWith({ fill: { kind: "rainbow", field: "score" } }),
      "overlay1",
    );
    expect(read.declared).toBeUndefined();
    expect(read.invalid).toHaveLength(1);
    expect(read.invalid[0]).toContain("invalid fill.kind");
  });
});
