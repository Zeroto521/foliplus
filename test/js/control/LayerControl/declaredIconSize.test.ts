// Guard tests for declaredIconSize — the marker icon pixel size a layer
// declares via foliplus={"icon_size": <px>}. These drive the reader against
// synthetic layer objects (no Leaflet), so the verdicts are checked without a
// map: a positive whole-number size resolves, a non-positive / fractional /
// non-numeric value is warned once and read as "not declared", and a layer with
// no declaration is a pure no-op.
import { describe, expect, it, vi } from "vitest";
import { readDeclaredIconSize } from "#control/LayerControl/declaredIconSize.js";

/** A synthetic carrier whose foliplus namespace carries the given declaration. */
const layerWith = (foliplus: Record<string, unknown> | undefined) =>
  ({ options: { foliplus } }) as unknown as object;

describe("readDeclaredIconSize", () => {
  it.each([1, 25, 36, 120])("resolves a positive integer size %i", px => {
    const { declared, invalid } = readDeclaredIconSize(
      layerWith({ icon_size: px }),
      "L",
    );
    expect(declared).toBe(px);
    expect(invalid).toEqual([]);
  });

  it.each([0, -8, 12.5, "36", true, Number.NaN])(
    "reads a non-positive-integer icon_size %j as not-declared and warns once",
    raw => {
      const warn = vi.fn();
      const { declared, invalid } = readDeclaredIconSize(
        layerWith({ icon_size: raw }),
        "L",
        warn,
      );
      expect(declared).toBeUndefined();
      expect(invalid).toHaveLength(1);
      expect(invalid[0]).toMatch(/non-positive-integer icon_size/);
    },
  );

  it("is a pure no-op for a layer with no declaration", () => {
    const { declared, invalid } = readDeclaredIconSize(layerWith({}), "L");
    expect(declared).toBeUndefined();
    expect(invalid).toEqual([]);
  });

  it("never caches a null layer (the carrier may be late-linked)", () => {
    expect(readDeclaredIconSize(null, "L").declared).toBeUndefined();
    const { declared } = readDeclaredIconSize(layerWith({ icon_size: 36 }), "L");
    expect(declared).toBe(36);
  });

  it("does not let a second layer's declaration bleed across the cache", () => {
    // The skeleton caches per layer OBJECT: two layers declaring different
    // sizes must each read their own, never the other's.
    const a = layerWith({ icon_size: 20 });
    const b = layerWith({ icon_size: 48 });
    expect(readDeclaredIconSize(a, "A").declared).toBe(20);
    expect(readDeclaredIconSize(b, "B").declared).toBe(48);
    expect(readDeclaredIconSize(a, "A").declared).toBe(20);
  });
});
