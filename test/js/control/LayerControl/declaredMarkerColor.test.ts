// Guard tests for declaredMarkerColor — the marker chassis preset a layer
// declares via foliplus={"marker_color": "<preset>"}. These drive the reader
// against synthetic layer objects (no Leaflet), so the verdicts are checked
// without a map: a declared preset resolves, an unknown preset and a malformed
// value are warned once and read as "not declared", and a layer with no
// declaration is a pure no-op.
import { describe, expect, it, vi } from "vitest";
import { MARKER_COLOR_PRESET_HEX } from "#core/leaflet/index.js";
import { readDeclaredMarkerColor } from "#control/LayerControl/declaredParse.js";

/** A synthetic carrier whose foliplus namespace carries the given declaration. */
const layerWith = (foliplus: Record<string, unknown> | undefined) =>
  ({ options: { foliplus } }) as unknown as object;

describe("readDeclaredMarkerColor", () => {
  it("resolves a declared preset name", () => {
    const { declared, invalid } = readDeclaredMarkerColor(
      layerWith({ marker_color: "darkred" }),
      "L",
    );
    expect(declared).toBe("darkred");
    expect(invalid).toEqual([]);
  });

  it("resolves every preset in the runtime table", () => {
    // The declared vocabulary IS the runtime preset table: a reader that
    // rejected a real preset (or accepted a non-preset) would desync from the
    // panel's own swatches.
    for (const name of Object.keys(MARKER_COLOR_PRESET_HEX)) {
      const { declared, invalid } = readDeclaredMarkerColor(
        layerWith({ marker_color: name }),
        "L",
      );
      expect(declared, name).toBe(name);
      expect(invalid, name).toEqual([]);
    }
  });

  it("reads a non-preset name as not-declared and warns once", () => {
    const warn = vi.fn();
    const { declared, invalid } = readDeclaredMarkerColor(
      layerWith({ marker_color: "chartreuse" }),
      "L",
      warn,
    );
    expect(declared).toBeUndefined();
    expect(invalid).toHaveLength(1);
    expect(invalid[0]).toMatch(/unknown marker_color preset/);
  });

  it.each([7, ["red"], { name: "red" }, "   "])(
    "reads a malformed marker_color %j as not-declared",
    raw => {
      const warn = vi.fn();
      const { declared, invalid } = readDeclaredMarkerColor(
        layerWith({ marker_color: raw }),
        "L",
        warn,
      );
      expect(declared).toBeUndefined();
      expect(invalid).toHaveLength(1);
    },
  );

  it("is a pure no-op for a layer with no declaration", () => {
    const { declared, invalid } = readDeclaredMarkerColor(layerWith({}), "L");
    expect(declared).toBeUndefined();
    expect(invalid).toEqual([]);
  });

  it("never caches a null layer (the carrier may be late-linked)", () => {
    // A null layer reads provisional and empty; a later read with the real
    // carrier must still resolve the declaration.
    expect(readDeclaredMarkerColor(null, "L").declared).toBeUndefined();
    const { declared } = readDeclaredMarkerColor(
      layerWith({ marker_color: "blue" }),
      "L",
    );
    expect(declared).toBe("blue");
  });
});
