// test/js/control/LayerControl/declared/face — the icon / marker face readers
// and the one sub-key normalisation point they share.
//
// A face declaration accepts camel and snake spellings of its multi-word
// sub-keys, normalises them to camelCase and warns on an unknown sub-key; the
// alpha-only reader is a thin projection of the face reader. These cases pin
// that behaviour on both faces.
import { describe, expect, it, vi } from "vitest";
import {
  readDeclaredIcon,
  readDeclaredIconColorOpacity,
  readDeclaredMarker,
  readDeclaredMarkerColorOpacity,
} from "#control/LayerControl/declared/index.js";

/** A linked carrier carrying a foliplus declaration. Fresh object per test: the
 *  reader caches per layer object, the way a folium layer's options are final
 *  once it exists. */
const layerWith = (foliplus: unknown) => ({ options: { foliplus } }) as never;

describe("readDeclaredIconColorOpacity", () => {
  it("reads the glyph alpha off the icon face", () => {
    const { declared, invalid } = readDeclaredIconColorOpacity(
      layerWith({ icon: { colorOpacity: 60 } }),
      "L",
    );
    expect(declared).toBe(60);
    expect(invalid).toEqual([]);
  });

  it("reads nothing when the icon face is absent", () => {
    const { declared, invalid } = readDeclaredIconColorOpacity(layerWith({}), "L");
    expect(declared).toBeUndefined();
    expect(invalid).toEqual([]);
  });

  it("reads nothing when the icon face is not a mapping", () => {
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
  it("reads the chassis alpha off the marker face", () => {
    const { declared, invalid } = readDeclaredMarkerColorOpacity(
      layerWith({ marker: { colorOpacity: 60 } }),
      "L",
    );
    expect(declared).toBe(60);
    expect(invalid).toEqual([]);
  });

  it("reads nothing when the marker face is absent", () => {
    const { declared, invalid } = readDeclaredMarkerColorOpacity(layerWith({}), "L");
    expect(declared).toBeUndefined();
    expect(invalid).toEqual([]);
  });

  it("reads nothing when the marker face is not a mapping", () => {
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

describe("readDeclaredIcon", () => {
  it("reads the glyph, colour and alpha of an icon face", () => {
    const { declared, invalid } = readDeclaredIcon(
      layerWith({ icon: { glyph: "star", color: "#FF0000", colorOpacity: 60 } }),
      "L",
    );
    expect(invalid).toEqual([]);
    expect(declared).toEqual({
      glyph: "star",
      color: "#ff0000",
      colorOpacity: 60,
    });
  });

  it("accepts the snake_case alpha spelling and normalises it to camelCase", () => {
    const { declared, invalid } = readDeclaredIcon(
      layerWith({ icon: { color_opacity: 40 } }),
      "L",
    );
    expect(invalid).toEqual([]);
    expect(declared).toEqual({ colorOpacity: 40 });
  });

  it("keeps the first spelling when the face declares the alpha twice", () => {
    const warn = vi.fn();
    const { declared, invalid } = readDeclaredIcon(
      layerWith({ icon: { colorOpacity: 60, color_opacity: 40 } }),
      "L",
      warn,
    );
    expect(declared).toEqual({ colorOpacity: 60 });
    expect(invalid).toHaveLength(1);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("trims a padded glyph and colour the way the Python normaliser does", () => {
    // Python's face normaliser strips both strings before validating them; a
    // declaration is accepted on both stacks or on neither. The stored value is
    // the trimmed / expanded form, never the author's padding.
    const { declared, invalid } = readDeclaredIcon(
      layerWith({ icon: { glyph: "  star ", color: " #F00 " } }),
      "L",
    );
    expect(invalid).toEqual([]);
    expect(declared).toEqual({ glyph: "star", color: "#ff0000" });
  });

  it.each([
    0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x1c, 0x1d, 0x1e, 0x1f, 0x20, 0x85, 0xa0, 0x1680,
    0x2000, 0x2001, 0x2002, 0x2003, 0x2004, 0x2005, 0x2006, 0x2007, 0x2008, 0x2009,
    0x200a, 0x2028, 0x2029, 0x202f, 0x205f, 0x3000, 0xfeff,
  ])(
    "trims the shared whitespace code point %i like the Python normaliser",
    codePoint => {
      // The set is the UNION of the two hosts' whitespace: U+FEFF (a BOM pasted
      // from a CSV) and U+001C-1F / U+0085 disagree between trim() and
      // str.strip(), while U+2000-200A / U+2028 / U+3000 are what an author
      // pastes from rich text or CJK input. One set, one declared value on
      // either stack.
      const pad = String.fromCodePoint(codePoint);
      const { declared, invalid } = readDeclaredIcon(
        layerWith({ icon: { glyph: `${pad}star${pad}`, color: ` #f00${pad}` } }),
        "L",
      );
      expect(invalid).toEqual([]);
      expect(declared).toEqual({ glyph: "star", color: "#ff0000" });
    },
  );

  it("accepts an integral float alpha (the JS reader sees 40.0 as 40)", () => {
    expect(
      readDeclaredIcon(layerWith({ icon: { colorOpacity: 40.0 } }), "L").declared,
    ).toEqual({ colorOpacity: 40 });
  });

  it.each([
    [{ color: null }, /non-hex icon color/],
    [{ colorOpacity: null }, /colorOpacity/],
  ])("warns on a null sub-key value %j and drops it alone", (face, pattern) => {
    const warn = vi.fn();
    const { declared, invalid } = readDeclaredIcon(
      layerWith({ icon: face }),
      "NullLayer",
      warn,
    );
    expect(declared).toBeUndefined();
    expect(invalid[0]).toMatch(pattern);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('on layer "NullLayer"'));
  });

  it("ignores a duplicate spelling even when the first value was unusable", () => {
    // The FIRST occurrence owns the canonical key (Python marks it seen before
    // validating), so an unusable first value drops the key and the second
    // spelling is only a duplicate — it never becomes a fallback.
    const warn = vi.fn();
    const { declared, invalid } = readDeclaredIcon(
      layerWith({ icon: { colorOpacity: 101, color_opacity: 40 } }),
      "L",
      warn,
    );
    expect(declared).toBeUndefined();
    expect(invalid).toHaveLength(2);
    expect(invalid[0]).toMatch(/colorOpacity/);
    expect(invalid[1]).toMatch(/duplicate sub-key "color_opacity"/);
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it("names the layer id in an unknown-sub-key warning", () => {
    const warn = vi.fn();
    readDeclaredIcon(
      layerWith({ icon: { glyph: "star", colour: "#fff" } }),
      "IconF",
      warn,
    );
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('unknown sub-key "colour" on layer "IconF"'),
    );
  });

  it("names an unregistered carrier when no layer id is known", () => {
    // A read before the layer is linked has no id; the warning still says so
    // instead of hiding the locator (the same "<unregistered>" wording the
    // border reader uses).
    const warn = vi.fn();
    readDeclaredIcon(layerWith({ icon: { colour: "#fff" } }), undefined, warn);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('on layer "<unregistered>"'),
    );
  });

  it("rejects a non-string colour like the malicious case it is", () => {
    const { declared, invalid } = readDeclaredIcon(
      layerWith({ icon: { color: 7 } }),
      "L",
      vi.fn(),
    );
    expect(declared).toBeUndefined();
    expect(invalid[0]).toMatch(/CSS hex/);
  });

  it("names the layer id when a face value is rejected", () => {
    const warn = vi.fn();
    readDeclaredIcon(layerWith({ icon: { color: "nope" } }), "IconG", warn);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('on layer "IconG"'));
  });

  it("warns on an unknown sub-key and keeps the known ones", () => {
    const warn = vi.fn();
    const { declared, invalid } = readDeclaredIcon(
      layerWith({ icon: { glyph: "star", colour: "#fff" } }),
      "L",
      warn,
    );
    expect(declared).toEqual({ glyph: "star" });
    expect(invalid).toHaveLength(1);
    expect(invalid[0]).toMatch(/unknown sub-key "colour"/);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it.each([
    [{ glyph: "" }, /non-empty string/],
    [{ glyph: 7 }, /non-empty string/],
    [{ color: "red" }, /CSS hex/],
    [{ colorOpacity: 101 }, /colorOpacity/],
  ])("rejects a malformed sub-key %j alone", (face, pattern) => {
    const warn = vi.fn();
    const { declared, invalid } = readDeclaredIcon(
      layerWith({ icon: face }),
      "L",
      warn,
    );
    expect(declared).toBeUndefined();
    expect(invalid).toHaveLength(1);
    expect(invalid[0]).toMatch(pattern);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("a malformed sub-key does not drop its siblings", () => {
    const { declared, invalid } = readDeclaredIcon(
      layerWith({ icon: { glyph: "star", color: "nope" } }),
      "L",
      vi.fn(),
    );
    expect(declared).toEqual({ glyph: "star" });
    expect(invalid).toHaveLength(1);
  });

  it("is a pure no-op for a layer with no icon face", () => {
    const { declared, invalid } = readDeclaredIcon(layerWith({}), "L");
    expect(declared).toBeUndefined();
    expect(invalid).toEqual([]);
  });

  it("reads nothing when the icon face is not a mapping", () => {
    const { declared, invalid } = readDeclaredIcon(
      layerWith({ icon: "red" }),
      "L",
      vi.fn(),
    );
    expect(declared).toBeUndefined();
    expect(invalid).toHaveLength(1);
  });

  it("never caches a null layer", () => {
    expect(readDeclaredIcon(null, "L").declared).toBeUndefined();
  });
});

describe("readDeclaredMarker", () => {
  it("reads the chassis alpha off the marker face (both spellings)", () => {
    expect(
      readDeclaredMarker(layerWith({ marker: { colorOpacity: 40 } }), "L").declared,
    ).toEqual({ colorOpacity: 40 });
    expect(
      readDeclaredMarker(layerWith({ marker: { color_opacity: 40 } }), "M").declared,
    ).toEqual({ colorOpacity: 40 });
  });

  it("warns on a glyph sub-key (the marker face carries no glyph)", () => {
    const warn = vi.fn();
    const { declared, invalid } = readDeclaredMarker(
      layerWith({ marker: { glyph: "star" } }),
      "L",
      warn,
    );
    expect(declared).toBeUndefined();
    expect(invalid).toHaveLength(1);
    expect(invalid[0]).toMatch(/unknown sub-key "glyph"/);
  });

  it("warns on a face-level colour (the chassis colour is marker_color)", () => {
    const { declared, invalid } = readDeclaredMarker(
      layerWith({ marker: { color: "#ff0000" } }),
      "L",
      vi.fn(),
    );
    expect(declared).toBeUndefined();
    expect(invalid).toHaveLength(1);
    expect(invalid[0]).toMatch(/unknown sub-key "color"/);
  });
});
