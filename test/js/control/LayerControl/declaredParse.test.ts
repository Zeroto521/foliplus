// test/js/control/LayerControl/declaredParse — the three scalar declared*
// readers (border, icon_size, marker_color) behind one registry module.
//
// The readers share the readDeclaredKey skeleton (read/cache/warn-once); each
// describe pins one channel's parse and its facade over that skeleton. The
// dimension-specific cases stay separate because each has its own message and
// its own invalid accumulation — only the file is shared (the module's own
// header says a new scalar channel registers here instead of opening a file).
import { describe, expect, it, vi } from "vitest";
import { STYLE_MODE } from "#core/layer/index.js";
import { MARKER_COLOR_PRESET_HEX } from "#core/leaflet/index.js";
import {
  readDeclaredBorder,
  readDeclaredIconColorOpacity,
  readDeclaredIconSize,
  readDeclaredMarkerColor,
  readDeclaredMarkerColorOpacity,
  readDeclaredOpacity,
} from "#control/LayerControl/declaredParse.js";

/** A linked carrier carrying a foliplus declaration. Fresh object per test: the
 *  reader caches per layer object, the way a folium layer's options are final
 *  once it exists. */
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
    const read = readDeclaredBorder(
      layerWith({ border: { mode: "value" } }),
      "overlay1",
    );
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

describe("readDeclaredOpacity", () => {
  it("reads a declared whole-layer opacity", () => {
    const { declared, invalid } = readDeclaredOpacity(layerWith({ opacity: 0.6 }), "L");
    expect(declared).toBe(0.6);
    expect(invalid).toEqual([]);
  });

  it("reads the camelCased spelling (a rendered map camelizes option keys)", () => {
    const { declared } = readDeclaredOpacity(layerWith({ opacity: 0.35 }), "L");
    expect(declared).toBe(0.35);
  });

  it("reads nothing on a layer with no declaration", () => {
    const { declared, invalid } = readDeclaredOpacity(layerWith({}), "L");
    expect(declared).toBeUndefined();
    expect(invalid).toEqual([]);
  });

  it.each([1.5, -0.1, true, "0.6", NaN, Infinity])(
    "reads a malformed opacity %j as not-declared and warns once",
    raw => {
      const warn = vi.fn();
      const { declared, invalid } = readDeclaredOpacity(
        layerWith({ opacity: raw }),
        "L",
        warn,
      );
      expect(declared).toBeUndefined();
      expect(invalid).toHaveLength(1);
      expect(invalid[0]).toMatch(/out-of-range opacity|non-finite opacity/);
    },
  );

  it("reads 0 and 1 as valid (the closed interval)", () => {
    expect(readDeclaredOpacity(layerWith({ opacity: 0 }), "L").declared).toBe(0);
    expect(readDeclaredOpacity(layerWith({ opacity: 1 }), "L").declared).toBe(1);
  });

  it("is a pure no-op for a null layer (never cached)", () => {
    expect(readDeclaredOpacity(null, "L").declared).toBeUndefined();
  });
});

describe("readDeclaredIconColorOpacity", () => {
  it("reads the glyph alpha off the icon block", () => {
    const { declared, invalid } = readDeclaredIconColorOpacity(
      layerWith({ icon: { colorOpacity: 60 } }),
      "L",
    );
    expect(declared).toBe(60);
    expect(invalid).toEqual([]);
  });

  it("reads nothing when the icon block is absent", () => {
    const { declared, invalid } = readDeclaredIconColorOpacity(layerWith({}), "L");
    expect(declared).toBeUndefined();
    expect(invalid).toEqual([]);
  });

  it("reads nothing when the icon block is not a mapping", () => {
    const { declared } = readDeclaredIconColorOpacity(layerWith({ icon: "red" }), "L");
    expect(declared).toBeUndefined();
  });

  it("reads nothing when the colorOpacity sub-key is absent", () => {
    const { declared } = readDeclaredIconColorOpacity(
      layerWith({ icon: { color: "#ff0000" } }),
      "L",
    );
    expect(declared).toBeUndefined();
  });

  it.each([101, -1, 60.5, true, "60"])(
    "reads a malformed colorOpacity %j as not-declared and warns once",
    raw => {
      const warn = vi.fn();
      const { declared, invalid } = readDeclaredIconColorOpacity(
        layerWith({ icon: { colorOpacity: raw } }),
        "L",
        warn,
      );
      expect(declared).toBeUndefined();
      expect(invalid).toHaveLength(1);
    },
  );

  it("never caches a null layer", () => {
    expect(readDeclaredIconColorOpacity(null, "L").declared).toBeUndefined();
  });
});

describe("readDeclaredMarkerColorOpacity", () => {
  it("reads the chassis alpha off the marker block", () => {
    const { declared, invalid } = readDeclaredMarkerColorOpacity(
      layerWith({ marker: { colorOpacity: 60 } }),
      "L",
    );
    expect(declared).toBe(60);
    expect(invalid).toEqual([]);
  });

  it("reads nothing when the marker block is absent", () => {
    const { declared, invalid } = readDeclaredMarkerColorOpacity(layerWith({}), "L");
    expect(declared).toBeUndefined();
    expect(invalid).toEqual([]);
  });

  it("reads nothing when the marker block is not a mapping", () => {
    const { declared } = readDeclaredMarkerColorOpacity(
      layerWith({ marker: "red" }),
      "L",
    );
    expect(declared).toBeUndefined();
  });

  it.each([101, -1, 60.5, true, "60"])(
    "reads a malformed colorOpacity %j as not-declared and warns once",
    raw => {
      const warn = vi.fn();
      const { declared, invalid } = readDeclaredMarkerColorOpacity(
        layerWith({ marker: { colorOpacity: raw } }),
        "L",
        warn,
      );
      expect(declared).toBeUndefined();
      expect(invalid).toHaveLength(1);
    },
  );
});
