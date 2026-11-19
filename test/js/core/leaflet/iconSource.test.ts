// core/leaflet — the iconSource predicates: the URL whitelist and the
// divIcon className whitelist. These are the ONLY acceptance gates for the
// two non-glyph marker-icon sources, so the tests pin both the happy paths
// and every scriptable mediatype the whitelist must keep out.
import { describe, expect, it } from "vitest";
import {
  DIVICON_CLASS_NAMES,
  DIVICON_SHAPES,
  divIconClassNameOf,
  isAllowedIconUrl,
  isDivIconGlyph,
} from "#foliplus/core/leaflet/iconSource.js";

describe("isAllowedIconUrl", () => {
  it.each([
    "https://example.com/a.png",
    "http://example.com/a.png",
    "data:image/png;base64,iVBORw0KGgo=",
    "data:image/jpeg;base64,/9j/4AAQ",
    "data:image/gif;base64,R0lGODlh",
    "data:image/webp;base64,UklGRho",
  ])("accepts a whitelisted image URL: %s", url => {
    expect(isAllowedIconUrl(url)).toBe(true);
  });

  it.each([
    "data:text/html,<script>alert(1)</script>",
    "data:image/svg+xml,<svg onload=alert(1)></svg>",
    "javascript:alert(1)",
    "data:application/javascript,alert(1)",
    "data:image/png,<svg onload=alert(1)></svg>",
    "/relative/path.png",
    "//protocol-relative.example.com/a.png",
    "ftp://example.com/a.png",
    "file:///etc/passwd",
    "",
    "   ",
    "not a url",
  ])("rejects a non-whitelisted URL: %s", url => {
    expect(isAllowedIconUrl(url)).toBe(false);
  });

  it("rejects a non-string", () => {
    expect(isAllowedIconUrl(undefined)).toBe(false);
    expect(isAllowedIconUrl(null)).toBe(false);
    expect(isAllowedIconUrl(123)).toBe(false);
  });
});

describe("divIcon className whitelist", () => {
  it("resolves a whitelisted shape key to its className", () => {
    for (const shape of DIVICON_SHAPES) {
      expect(divIconClassNameOf(shape)).toBe(
        (DIVICON_CLASS_NAMES as Record<string, string>)[shape],
      );
    }
  });

  it("rejects a non-whitelisted className", () => {
    expect(divIconClassNameOf("arbitrary-css-class")).toBeNull();
    expect(divIconClassNameOf("foliplus-shape-pin extra")).toBeNull();
    expect(divIconClassNameOf(123)).toBeNull();
    expect(divIconClassNameOf(undefined)).toBeNull();
  });
});

describe("isDivIconGlyph", () => {
  it("accepts a syntactically valid FA6 name", () => {
    expect(isDivIconGlyph("circle")).toBe(true);
    expect(isDivIconGlyph("map-pin")).toBe(true);
  });

  it("rejects a non-syntax name", () => {
    expect(isDivIconGlyph("<script>")).toBe(false);
    expect(isDivIconGlyph("")).toBe(false);
    expect(isDivIconGlyph(undefined)).toBe(false);
  });
});
