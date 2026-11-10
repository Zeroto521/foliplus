// core/leaflet/glyphSource — pins the glyph name gate and the runtime
// availability probe. Behavioural, not call-counting: each test states the
// invariant it protects.
import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_GLYPH_PREFIX,
  GLYPH_PREFIXES,
  PICKER_GLYPHS,
  coerceGlyphPrefix,
  glyphAvailable,
  glyphHtml,
  isGlyphSyntax,
  resolveGlyph,
} from "#core/leaflet/index.js";

describe("glyphSource", () => {
  it("accepts a syntactically valid FA6 name", () => {
    expect(isGlyphSyntax("flag")).toBe(true);
    expect(isGlyphSyntax("map-pin")).toBe(true);
    expect(isGlyphSyntax("a")).toBe(true);
  });

  it("rejects a name that is not lowercase alphanumerics joined by single hyphens", () => {
    expect(isGlyphSyntax("Flag")).toBe(false); // uppercase
    expect(isGlyphSyntax("-flag")).toBe(false); // leading hyphen
    expect(isGlyphSyntax("flag-")).toBe(false); // trailing hyphen
    expect(isGlyphSyntax("fla--g")).toBe(false); // double hyphen
    expect(isGlyphSyntax("fla g")).toBe(false); // space
    expect(isGlyphSyntax("fla_g")).toBe(false); // underscore
    expect(isGlyphSyntax("")).toBe(false); // empty
  });

  it("rejects a name longer than the FA6 grammar cap", () => {
    const tooLong = "a".repeat(65);
    expect(isGlyphSyntax(tooLong)).toBe(false);
    expect(isGlyphSyntax("a".repeat(64))).toBe(true);
  });

  it("rejects a non-string input (number / null / object)", () => {
    expect(isGlyphSyntax(42)).toBe(false);
    expect(isGlyphSyntax(null)).toBe(false);
    expect(isGlyphSyntax(undefined)).toBe(false);
    expect(isGlyphSyntax({ kind: "glyph" })).toBe(false);
  });

  it("resolveGlyph echoes a valid name and drops an invalid one", () => {
    expect(resolveGlyph("flag")).toBe("flag");
    expect(resolveGlyph("Not A Name")).toBeNull();
  });

  it("the picker grid is a subset of syntactically valid names", () => {
    for (const g of PICKER_GLYPHS) expect(isGlyphSyntax(g)).toBe(true);
  });

  it("glyphAvailable returns false when there is no document (jsdom-less run)", () => {
    // Model the "no document" branch: the probe cannot run without a host.
    const orig = (globalThis as { document?: unknown }).document;
    // biome-ignore lint/suspicious/noExplicitAny: modelling absence
    delete (globalThis as Record<string, unknown>).document;
    try {
      expect(glyphAvailable("flag")).toBe(false);
    } finally {
      (globalThis as { document?: unknown }).document = orig;
    }
  });

  it("glyphAvailable reads ::before content from an attached probe and caches the answer", () => {
    // jsdom has a document but no FontAwesome stylesheet; stub
    // getComputedStyle to model the loaded rule painting a codepoint. A fresh
    // name (never probed) forces a cache miss so the attach → read → remove →
    // cache path runs with a real DOM.
    const readSpy = vi.spyOn(
      // biome-ignore lint/suspicious/noExplicitAny: window typing
      window as any,
      "getComputedStyle",
    );
    // biome-ignore lint/suspicious/noExplicitAny: jsdom content shape
    readSpy.mockImplementation(() => ({ content: "\uf024" }) as any);
    const name = "unprobed-glyph";
    expect(glyphAvailable(name)).toBe(true); // cache miss → probe runs
    expect(glyphAvailable(name)).toBe(true); // cache hit → same answer
    expect(readSpy).toHaveBeenCalledTimes(1); // the second read came from cache
    readSpy.mockRestore();
  });

  it("glyphAvailable returns false when the loaded sheet paints nothing (empty content)", () => {
    // A wrong or unloaded name paints "" — the honest "not available" answer.
    const readSpy = vi.spyOn(
      // biome-ignore lint/suspicious/noExplicitAny: window typing
      window as any,
      "getComputedStyle",
    );
    // biome-ignore lint/suspicious/noExplicitAny: jsdom content shape
    readSpy.mockImplementation(() => ({ content: "" }) as any);
    expect(glyphAvailable("unloaded-glyph")).toBe(false);
    readSpy.mockRestore();
  });
});

it("glyphHtml renders the shell + FA classes with no extra class or style", () => {
  const html = glyphHtml("flag");
  expect(html).toContain('class="foliplus-marker-glyph fa-solid fa-flag"');
  expect(html).toContain('aria-hidden="true"');
  expect(html).not.toContain("style=");
});

it("glyphHtml includes the extra class and inline style when provided", () => {
  const html = glyphHtml("star", "icon-white", "color: red");
  expect(html).toContain("icon-white");
  expect(html).toContain('style="color: red"');
});

it("glyphHtml drops an empty extraClass (no trailing double space)", () => {
  const html = glyphHtml("star", "", "");
  expect(html).not.toContain("  ");
  expect(html).toContain('class="foliplus-marker-glyph fa-solid fa-star"');
});

it("glyphAvailable returns false when neither document.body nor documentElement exists", () => {
  // Model the "no host to attach to" branch: both body and documentElement absent.
  const origBody = document.body;
  const origDocEl = document.documentElement;
  Object.defineProperty(document, "body", {
    value: null,
    configurable: true,
    writable: true,
  });
  Object.defineProperty(document, "documentElement", {
    value: null,
    configurable: true,
    writable: true,
  });
  try {
    expect(glyphAvailable("no-host-glyph")).toBe(false);
  } finally {
    Object.defineProperty(document, "body", {
      value: origBody,
      configurable: true,
      writable: true,
    });
    Object.defineProperty(document, "documentElement", {
      value: origDocEl,
      configurable: true,
      writable: true,
    });
  }
});

describe("glyph prefix family", () => {
  it("declares the solid family as the default and the regular family as a peer", () => {
    expect(GLYPH_PREFIXES.solid).toBe("fa-solid");
    expect(GLYPH_PREFIXES.regular).toBe("fa-regular");
    expect(DEFAULT_GLYPH_PREFIX).toBe(GLYPH_PREFIXES.solid);
  });

  it("coerces a known family verbatim and falls back to the default for anything else", () => {
    expect(coerceGlyphPrefix("fa-solid")).toBe("fa-solid");
    expect(coerceGlyphPrefix("fa-regular")).toBe("fa-regular");
    expect(coerceGlyphPrefix("fa")).toBe(DEFAULT_GLYPH_PREFIX); // FA4-style
    expect(coerceGlyphPrefix("fas")).toBe(DEFAULT_GLYPH_PREFIX);
    expect(coerceGlyphPrefix(undefined)).toBe(DEFAULT_GLYPH_PREFIX);
    expect(coerceGlyphPrefix("")).toBe(DEFAULT_GLYPH_PREFIX);
  });

  it("glyphHtml paints under the given family and under the default when omitted", () => {
    expect(glyphHtml("flag")).toContain('class="foliplus-marker-glyph fa-solid fa-flag"');
    expect(glyphHtml("flag", "", "", "fa-regular")).toContain(
      'class="foliplus-marker-glyph fa-regular fa-flag"',
    );
  });

  it("the availability probe keys its cache on the family prefix", () => {
    // A fresh name (never probed elsewhere in this file) so no earlier test's
    // cache entry (e.g. the no-document run caching "fa-solid|flag"=false) can
    // poison the assertion. The probe attaches a hidden <i> and reads ::before;
    // stub it so the cacheKey (prefix|name) is what distinguishes families.
    const getComputedStyle = vi.fn(() => ({ content: "\uf276" }));
    vi.stubGlobal("getComputedStyle", getComputedStyle);
    try {
      const name = "prefix-cache-probe";
      expect(glyphAvailable(name, "fa-solid")).toBe(true);
      expect(glyphAvailable(name, "fa-regular")).toBe(true);
      // One probe per distinct (prefix|name) key — the raw prefix, not a
      // normalised one, so a future coerce-in-key regression turns red.
      expect(getComputedStyle).toHaveBeenCalledTimes(2);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
