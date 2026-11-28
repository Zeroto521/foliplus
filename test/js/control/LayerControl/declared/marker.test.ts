// test/js/control/LayerControl/declared/marker — the icon_size and marker_color
// readers, one describe per channel.
//
// Both ride the readDeclaredKey skeleton; the describes pin the marker chassis
// parse (positive integer pixel size, preset name or CSS hex) and the thin
// reader over it.
import { describe, expect, it, vi } from "vitest";
import { MARKER_COLOR_PRESET_HEX } from "#core/leaflet/index.js";
import {
  readDeclaredIconSize,
  readDeclaredMarkerColor,
} from "#control/LayerControl/declared/index.js";

/** A linked carrier carrying a foliplus declaration. Fresh object per test: the
 *  reader caches per layer object, the way a folium layer's options are final
 *  once it exists. */
const layerWith = (foliplus: unknown) => ({ options: { foliplus } }) as never;

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

describe("readDeclaredMarkerColor", () => {
  it("resolves a declared preset name", () => {
    const { declared, invalid } = readDeclaredMarkerColor(
      layerWith({ marker_color: "darkred" }),
      "L",
    );
    expect(declared).toBe("darkred");
    expect(invalid).toEqual([]);
  });

  it("trims a padded preset and a padded hex with the shared trim", () => {
    expect(
      readDeclaredMarkerColor(layerWith({ marker_color: " darkred " }), "L").declared,
    ).toBe("darkred");
    for (const value of [" #f00 ", "\ufeff#f00", "\u2003#f00"]) {
      const { declared, invalid } = readDeclaredMarkerColor(
        layerWith({ marker_color: value }),
        "L",
      );
      expect(invalid, value).toEqual([]);
      expect(declared, value).toBe("#ff0000");
    }
  });

  it.each(["", " ", "\u001c", "\ufeff", "\u2003"])(
    "rejects an empty or whitespace-only marker_color %j with the blank message",
    value => {
      const warn = vi.fn();
      const { declared, invalid } = readDeclaredMarkerColor(
        layerWith({ marker_color: value }),
        "L",
        warn,
      );
      expect(declared).toBeUndefined();
      expect(invalid.join(" ")).toContain("empty or whitespace-only");
      expect(warn).toHaveBeenCalledOnce();
    },
  );

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

  it("resolves a declared CSS hex (6-digit, lowercased)", () => {
    const { declared, invalid } = readDeclaredMarkerColor(
      layerWith({ marker_color: "#00A6A6" }),
      "L",
    );
    expect(declared).toBe("#00a6a6");
    expect(invalid).toEqual([]);
  });

  it("resolves a declared CSS hex (3-digit, expanded to 6)", () => {
    const { declared, invalid } = readDeclaredMarkerColor(
      layerWith({ marker_color: "#abc" }),
      "L",
    );
    expect(declared).toBe("#aabbcc");
    expect(invalid).toEqual([]);
  });

  it("reads a malformed hex as not-declared and warns once", () => {
    const warn = vi.fn();
    const { declared, invalid } = readDeclaredMarkerColor(
      layerWith({ marker_color: "#12345" }),
      "L",
      warn,
    );
    expect(declared).toBeUndefined();
    expect(invalid).toHaveLength(1);
    expect(invalid[0]).toMatch(/unknown marker_color/);
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
