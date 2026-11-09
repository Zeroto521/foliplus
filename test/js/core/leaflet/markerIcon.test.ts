// core/leaflet/markerIcon — pure Leaflet logic for the per-layer marker
// icon dimension (relocated from control/LayerControl/ui/style/icon.test.ts).
// No DOM/panel: this file pins the capture / derive / reset / probe
// contracts at the Leaflet-object level.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  PICKER_GLYPHS,
  glyphAvailable,
  glyphHtml,
  isGlyphSyntax,
  resolveGlyph,
} from "#core/leaflet/glyphSource.js";
import {
  applyIconColorToLeaves,
  applyIconToLeaves,
  authorGlyphName,
  authorGlyphPrefix,
  buildMarkerIcon,
  captureAuthorIcon,
  composeColorAlpha,
  isIconLeaf,
  parseColorAlpha,
  resetIconLeaves,
} from "#core/leaflet/markerIcon.js";

// The shared L stub (test/js/setup.ts) defines no Icon key; the lead's
// buildMarkerIcon branch reads L.Icon.Default (task #932 step 1). Provide a
// minimal Default class here so `author instanceof L.Icon.Default` does not
// throw, and so the default-icon tests below can build an author that IS an
// instance of it. Scoped to this file — the shared stub stays generic.
class TestDivIcon {
  options: any;
  constructor(options: any) {
    this.options = options;
  }
}
beforeEach(() => {
  (window.L as any).Icon = { Default: class {} };
  (window.L as any).DivIcon = TestDivIcon;
  (window.L as any).divIcon = vi.fn((options: any) => new TestDivIcon(options));
  // jsdom has no FontAwesome stylesheet, so getComputedStyle(..).content is
  // "none" and glyphAvailable probes every name unavailable. Stub it to a
  // glyph codepoint by default so the render tests exercise the paint path;
  // the dedicated unavailable test flips the flag back to "none".
  (window as any).__glyphProbePainted = true;
  vi.spyOn(window, "getComputedStyle").mockImplementation(
    (el: Element, pseudo?: string | null) =>
      ({
        content:
          (window as any).__glyphProbePainted && pseudo === "::before"
            ? '"\\f00a"'
            : "none",
      }) as CSSStyleDeclaration,
  );
});
afterEach(() => {
  vi.clearAllMocks();
});

// A marker leaf: the layer type the icon dimension owns. It carries a
// runtime `setIcon` (the duck-type the capability probe keys on) and an
// `options.icon` that `setIcon` replaces in place.
const makeMarker = (icon?: unknown): any => {
  const leaf: any = {
    options: { icon },
    setIcon: vi.fn((next: unknown) => {
      leaf.options.icon = next;
      return leaf;
    }),
  };
  return leaf;
};

const makeMarkerGroup = (...markers: any[]): any => ({
  options: {},
  eachLayer: vi.fn((fn: (child: unknown) => void) => {
    for (const marker of markers) fn(marker);
  }),
});

// A realistic author icon: the chassis a derive-based swap inherits. The
// assertions compare the DERIVED icon's `createIcon` output against the
// author's — className, backgroundImage/backgroundPosition, iconSize, and
// the shadow's presence — so the derive contract is pinned at the DOM level.
const makeAuthorIcon = (
  opts: Partial<{
    className: string;
    bg: string;
    size: [number, number];
    iconColor: string;
    withShadow: boolean;
  }> = {},
) => {
  const cfg = {
    className: opts.className ?? "awesome-marker",
    bg: opts.bg ?? "url(icon.png) -24px 0",
    size: opts.size ?? ([36, 46] as [number, number]),
    iconColor: opts.iconColor ?? "blue",
    withShadow: opts.withShadow ?? true,
  };
  const author: any = {
    options: {
      iconColor: cfg.iconColor,
      className: cfg.className,
      iconSize: cfg.size,
      iconAnchor: [cfg.size[0] / 2, cfg.size[1]],
      popupAnchor: [0, -cfg.size[1]],
    },
    createIcon: vi.fn(() => {
      const div = document.createElement("div");
      div.className = cfg.className;
      div.style.backgroundImage = cfg.bg;
      div.style.backgroundPosition = "-24px 0";
      div.style.width = `${cfg.size[0]}px`;
      div.style.height = `${cfg.size[1]}px`;
      div.innerHTML = '<i class="fa fa-map-marker"></i>';
      return div;
    }),
    _setIconStyles: vi.fn((div: HTMLElement, name: string) => {
      div.className = `${name} ${cfg.className}`.trim();
    }),
    createShadow: cfg.withShadow
      ? vi.fn(() => {
          const sh = document.createElement("div");
          sh.className = "awesome-marker-shadow";
          return sh;
        })
      : undefined,
  };
  return author;
};

// A Leaflet default-icon author: an L.Icon.Default instance (the branch keys
// on `instanceof L.Icon.Default` first, then on createIcon -> <img>). Its
// createIcon returns a real <img> like Leaflet's _createImg, so the second
// clause also fires — the dedicated divIcon branch must take it over.
const makeDefaultIconAuthor = (): any => {
  const proto = (window.L as any).Icon.Default.prototype;
  const author = Object.create(proto);
  author.options = { iconSize: [25, 41], iconAnchor: [12, 41] };
  author.createIcon = vi.fn(() => document.createElement("img"));
  return author;
};

describe("isIconLeaf", () => {
  it("accepts a marker (runtime setIcon)", () => {
    expect(isIconLeaf(makeMarker())).toBe(true);
  });
  it("declines a non-marker leaf", () => {
    expect(isIconLeaf({ options: {} })).toBe(false);
  });
});

describe("captureAuthorIcon / resetIconLeaves", () => {
  it("captures the author icon on first write and never overwrites", () => {
    const leaf = makeMarker({ a: 1 });
    captureAuthorIcon(leaf);
    // second capture is a no-op (the WeakMap already holds it)
    leaf.options.icon = { b: 2 };
    captureAuthorIcon(leaf);
    resetIconLeaves(makeMarkerGroup(leaf));
    expect(leaf.options.icon).toEqual({ a: 1 });
  });

  it("falls back to the Leaflet default prototype for a leaf with no icon", () => {
    const leaf = makeMarker(undefined);
    captureAuthorIcon(leaf);
    const group = makeMarkerGroup(leaf);
    resetIconLeaves(group);
    // After capture of a bare leaf the fallback is the default prototype.
    expect(leaf.options.icon).not.toBeUndefined();
  });

  it("resetIconLeaves leaves a leaf with no captured icon untouched", () => {
    const leaf = makeMarker(); // never captured
    expect(() => resetIconLeaves(makeMarkerGroup(leaf))).not.toThrow();
    expect(leaf.setIcon).not.toHaveBeenCalled();
  });

  it("resetIconLeaves skips a non-icon leaf in the walk", () => {
    const leaf = { options: {} }; // no setIcon -> not an icon leaf
    expect(() => resetIconLeaves(makeMarkerGroup(leaf))).not.toThrow();
  });

  it("detaches the glyph element before restoring the author icon", () => {
    const leaf = makeMarker({ a: 1 });
    captureAuthorIcon(leaf);
    const removeIcon = vi.fn();
    const removeShadow = vi.fn();
    leaf._removeIcon = removeIcon;
    leaf._removeShadow = removeShadow;
    resetIconLeaves(makeMarkerGroup(leaf));
    expect(removeIcon).toHaveBeenCalled();
    expect(removeShadow).toHaveBeenCalled();
    expect(leaf.options.icon).toEqual({ a: 1 });
  });
});

describe("applyIconToLeaves", () => {
  it("applies the glyph to every marker leaf, capturing each author once", () => {
    const author = makeAuthorIcon();
    const mA = makeMarker(author);
    const mB = makeMarker(author);
    applyIconToLeaves(makeMarkerGroup(mA, mB), "star");
    expect(mA.options.icon).not.toBe(author);
    expect(mB.options.icon).not.toBe(author);
    expect(Object.getPrototypeOf(mA.options.icon)).toBe(author);
    expect(Object.getPrototypeOf(mB.options.icon)).toBe(author);
  });
  it("skips a non-marker leaf in the walk", () => {
    const leaf = { options: {} };
    expect(() => applyIconToLeaves(makeMarkerGroup(leaf), "star")).not.toThrow();
  });

  it("applyIconColorToLeaves skips a non-icon leaf in the walk", () => {
    const leaf = { options: {} };
    expect(() =>
      applyIconColorToLeaves(makeMarkerGroup(leaf), "#ff0000", null),
    ).not.toThrow();
  });

  it("applyIconColorToLeaves captures each author once and derives in one construction", () => {
    const author = makeAuthorIcon({ iconColor: "blue" });
    const mA = makeMarker(author);
    applyIconColorToLeaves(makeMarkerGroup(mA), "#00ff00", "star");
    expect(mA.setIcon).toHaveBeenCalledTimes(1);
    const div = mA.options.icon.createIcon();
    const inner = div.querySelector("i") as HTMLElement;
    expect(inner.style.color).toBe("rgb(0, 255, 0)");
    expect(inner.className).toContain("fa-star");
  });
  it("applyIconColorToLeaves falls back to the circle glyph when none is given", () => {
    const author = makeAuthorIcon({ iconColor: "" });
    const m = makeMarker(author);
    applyIconColorToLeaves(makeMarkerGroup(m), "#00ff00", null);
    expect(m.setIcon).toHaveBeenCalledTimes(1);
    const div = m.options.icon.createIcon();
    const inner = div.querySelector("i") as HTMLElement;
    expect(inner.className).toContain("fa-circle");
  });
});

describe("authorGlyphName", () => {
  it("returns the first valid author glyph name with its verdict", () => {
    const withGlyph = makeMarker({ options: { icon: "star" } });
    const plain = makeMarker({ options: {} });
    expect(authorGlyphName(makeMarkerGroup(plain, withGlyph))).toEqual({
      name: "star",
      valid: true,
    });
  });
  it("returns null when no leaf declares a glyph name", () => {
    const plain = makeMarker({ options: {} });
    expect(authorGlyphName(makeMarkerGroup(plain))).toBeNull();
  });
  it("stops walking after the first valid glyph (short-circuit)", () => {
    const withGlyph = makeMarker({ options: { icon: "star" } });
    const after = makeMarker({ options: { icon: "heart" } });
    // The second recognized leaf is never read: the walk returns at the first.
    expect(authorGlyphName(makeMarkerGroup(withGlyph, after))).toEqual({
      name: "star",
      valid: true,
    });
  });
  it("skips a non-icon leaf and keeps walking", () => {
    const poly = { options: {} };
    const withGlyph = makeMarker({ options: { icon: "star" } });
    expect(authorGlyphName(makeMarkerGroup(poly, withGlyph))).toEqual({
      name: "star",
      valid: true,
    });
  });
  it("returns an invalid author name with valid=false instead of dropping it", () => {
    // A syntactically invalid declaration (spaces) must surface raw — the UI
    // shows the unavailable state, not the author-original label.
    const bad = makeMarker({ options: { icon: "not an icon" } });
    expect(authorGlyphName(makeMarkerGroup(bad))).toEqual({
      name: "not an icon",
      valid: false,
    });
  });
  it("prefers a valid declaration over an earlier invalid one", () => {
    const bad = makeMarker({ options: { icon: "not an icon" } });
    const good = makeMarker({ options: { icon: "star" } });
    expect(authorGlyphName(makeMarkerGroup(bad, good))).toEqual({
      name: "star",
      valid: true,
    });
  });
  it("keeps the first invalid declaration when a later one is also invalid", () => {
    const bad1 = makeMarker({ options: { icon: "not an icon" } });
    const bad2 = makeMarker({ options: { icon: "also not an icon" } });
    expect(authorGlyphName(makeMarkerGroup(bad1, bad2))).toEqual({
      name: "not an icon",
      valid: false,
    });
  });
});

describe("authorGlyphPrefix", () => {
  it("returns the first author prefix declared on an icon leaf", () => {
    const withPrefix = makeMarker({ options: { prefix: "fa" } });
    const plain = makeMarker({ options: {} });
    expect(authorGlyphPrefix(makeMarkerGroup(plain, withPrefix))).toBe("fa");
  });
  it("returns null when no leaf declares a prefix", () => {
    const plain = makeMarker({ options: {} });
    expect(authorGlyphPrefix(makeMarkerGroup(plain))).toBeNull();
  });
  it("stops walking after the first prefix (short-circuit)", () => {
    const withPrefix = makeMarker({ options: { prefix: "fa" } });
    const after = makeMarker({ options: { prefix: "fa-solid" } });
    expect(authorGlyphPrefix(makeMarkerGroup(withPrefix, after))).toBe("fa");
  });
  it("skips a non-icon leaf and keeps walking", () => {
    const poly = { options: {} };
    const withPrefix = makeMarker({ options: { prefix: "fa" } });
    expect(authorGlyphPrefix(makeMarkerGroup(poly, withPrefix))).toBe("fa");
  });
  it("ignores an empty-string prefix (treats as absent)", () => {
    const empty = makeMarker({ options: { prefix: "" } });
    const withPrefix = makeMarker({ options: { prefix: "fa" } });
    expect(authorGlyphPrefix(makeMarkerGroup(empty, withPrefix))).toBe("fa");
  });
});

describe("buildMarkerIcon", () => {
  it("derives from the author and swaps only the inner symbol", () => {
    const author = makeAuthorIcon();
    const derived = buildMarkerIcon({ author, glyph: "circle" }) as any;
    expect(derived).not.toBe(author);
    expect(Object.getPrototypeOf(derived)).toBe(author);
    const div = derived.createIcon();
    const authorDiv = author.createIcon();
    expect(div.className).toBe(authorDiv.className);
    expect(div.style.backgroundImage).toBe(authorDiv.style.backgroundImage);
    expect(div.style.backgroundPosition).toBe(authorDiv.style.backgroundPosition);
    expect(div.style.width).toBe(authorDiv.style.width);
    expect(div.style.height).toBe(authorDiv.style.height);
    const glyphEl = div.querySelector(".foliplus-marker-glyph") as HTMLElement;
    expect(glyphEl).not.toBeNull();
    expect(glyphEl.className).toContain("fa-solid");
    expect(glyphEl.className).toContain("fa-circle");
    expect(div.innerHTML).not.toContain("fa-map-marker");
    expect(!!derived.createShadow?.()).toBe(!!author.createShadow?.());
  });

  it("returns null when the author chassis cannot be built", () => {
    const author = { ...makeAuthorIcon(), createIcon: vi.fn(() => null) };
    const derived = buildMarkerIcon({ author, glyph: "star" }) as any;
    expect(derived.createIcon()).toBeNull();
  });

  it("keeps the shadow absence identical when the author has none", () => {
    const author = makeAuthorIcon({ withShadow: false });
    const derived = buildMarkerIcon({ author, glyph: "star" }) as any;
    expect(derived.createShadow).toBeUndefined();
  });

  it("returns the author unchanged when it is not a Leaflet icon", () => {
    const author = { html: "raw" };
    expect(buildMarkerIcon({ author, glyph: "circle" })).toBe(author);
  });

  it("carries the author inner <i> class and color into the glyph", () => {
    // The author declares no options.iconColor, so the inner <i> inline color
    // is the fallback and must carry into the glyph.
    const author = makeAuthorIcon({ iconColor: "" });
    author.createIcon = vi.fn(() => {
      const div = document.createElement("div");
      div.className = "awesome-marker";
      div.innerHTML = '<i class="fa icon-white" style="color: rgb(255, 255, 255)"></i>';
      return div;
    });
    const derived = buildMarkerIcon({ author, glyph: "star" }) as any;
    const inner = derived.createIcon().querySelector("i");
    expect(inner.className).toContain("foliplus-marker-glyph");
    expect(inner.className).toContain("icon-white");
    expect(inner.style.color).toBe("rgb(255, 255, 255)");
  });

  it("defaults the glyph color to white when the author has none", () => {
    const author = makeAuthorIcon({ iconColor: "" });
    const derived = buildMarkerIcon({ author, glyph: "star" }) as any;
    expect(derived.createIcon().querySelector("i")?.style.color).toBe(
      "rgb(255, 255, 255)",
    );
  });

  it("uses the author iconColor when the inner <i> declares no inline color", () => {
    // The author declares options.iconColor (the glyph-color face on options)
    // with NO inline style on the inner <i>. The derive must read that declared
    // glyph color, not fall through to white — otherwise Reset/derive loses an
    // awesome-markers-only author paint.
    const author = makeAuthorIcon({ iconColor: "red" });
    author.createIcon = vi.fn(() => {
      const div = document.createElement("div");
      div.className = "awesome-marker";
      div.innerHTML = '<i class="fa fa-map-marker"></i>';
      return div;
    });
    const derived = buildMarkerIcon({ author, glyph: "star" }) as any;
    const inner = derived.createIcon().querySelector("i");
    expect(inner.style.color).toBe("red");
  });

  it("prefers the author inner inline color over the declared iconColor", () => {
    // The inner <i> inline color is the author's actual painted glyph (the
    // same paint the author's createIcon produced) and WINS over a declared
    // options.iconColor — the derive must reproduce the author's real glyph,
    // not an option the author may have set but never painted.
    const author = makeAuthorIcon({ iconColor: "blue" });
    author.createIcon = vi.fn(() => {
      const div = document.createElement("div");
      div.className = "awesome-marker";
      div.innerHTML = '<i class="fa icon-white" style="color: rgb(255, 0, 0)"></i>';
      return div;
    });
    const derived = buildMarkerIcon({ author, glyph: "star" }) as any;
    const inner = derived.createIcon().querySelector("i");
    expect(inner.style.color).toBe("rgb(255, 0, 0)");
  });

  it("defaults to white and no author paint when the author div has no inner <i>", () => {
    const author = makeAuthorIcon({ iconColor: "" });
    author.createIcon = vi.fn(() => {
      const div = document.createElement("div");
      div.className = "awesome-marker";
      return div;
    });
    const derived = buildMarkerIcon({ author, glyph: "star" }) as any;
    const inner = derived.createIcon().querySelector("i") as HTMLElement;
    expect(inner).not.toBeNull();
    expect(inner.className).toContain("foliplus-marker-glyph");
    expect(inner.className).toContain("fa-solid");
    expect(inner.className).not.toContain("fa ");
    expect(inner.style.color).toBe("rgb(255, 255, 255)");
  });

  it("keeps the author icon for a syntactically invalid name (no substitute glyph)", () => {
    // "nope!" is invalid syntax: resolveGlyph returns null, so the author icon
    // stays. (A valid-but-unpainted name is the availability branch's job.)
    const author = makeAuthorIcon();
    expect(buildMarkerIcon({ author, glyph: "nope!" })).toBe(author);
  });
  it("keeps the author icon and warns once when the stylesheet does not paint the glyph", () => {
    // A syntactically valid name the loaded FA CSS does not paint: honest
    // degradation to the author icon, with a single warn per name.
    (window as any).__glyphProbePainted = false;
    const author = makeAuthorIcon();
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(buildMarkerIcon({ author, glyph: "map-location-dot" })).toBe(author);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    // Second encounter of the same name warns no more (cache + warned set).
    expect(buildMarkerIcon({ author, glyph: "map-location-dot" })).toBe(author);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    warnSpy.mockRestore();
    (window as any).__glyphProbePainted = true;
  });

  it("takes a Leaflet default icon down a dedicated divIcon branch", () => {
    const author = makeDefaultIconAuthor();
    const derived = buildMarkerIcon({ author, glyph: "map-pin" }) as any;
    expect(derived).toBeInstanceOf((window.L as any).DivIcon);
    expect(derived.options).toMatchObject({
      className: "foliplus-marker-default",
      iconSize: [25, 41],
      iconAnchor: [12, 41],
    });
    expect(derived.options.html).toContain("foliplus-marker-glyph");
    expect(derived.options.html).toContain("fa-solid");
    expect(derived.options.html).toContain("fa-map-pin");
  });
});
it("paints a user color and opacity on the default-icon divIcon branch", () => {
  const author = makeDefaultIconAuthor();
  const derived = buildMarkerIcon({
    author,
    glyph: "star",
    color: "#ff0000",
    opacity: 50,
  }) as any;
  expect(derived).toBeInstanceOf((window.L as any).DivIcon);
  // The style string carries the composed rgba paint.
  expect(derived.options.html).toContain("color:rgba(255, 0, 0, 0.5)");
});
it("paints a default-icon author white when the user sets no color", () => {
  const author = makeDefaultIconAuthor();
  const derived = buildMarkerIcon({ author, glyph: "map-pin" }) as any;
  expect(derived).toBeInstanceOf((window.L as any).DivIcon);
  // No user color, no opacity — the default-icon branch paints the glyph
  // white (the same default the derive path uses), never an empty style.
  expect(derived.options.html).toContain("color:#fff");
});

it("paints a user color at the user's opacity", () => {
  const author = makeAuthorIcon({ iconColor: "" });
  const derived = buildMarkerIcon({
    author,
    glyph: "star",
    color: "#ff0000",
    opacity: 50,
  }) as any;
  expect(derived.createIcon().querySelector("i")?.style.color).toBe(
    "rgba(255, 0, 0, 0.5)",
  );
});
it("paints a user color opaque by default", () => {
  const author = makeAuthorIcon({ iconColor: "" });
  const derived = buildMarkerIcon({ author, glyph: "star", color: "#12abef" }) as any;
  // jsdom normalizes the inline style color to rgb().
  expect(derived.createIcon().querySelector("i")?.style.color).toBe(
    "rgb(18, 171, 239)",
  );
});
it("keeps the author's translucent alpha when only the color is re-derived", () => {
  // The author's inner <i> paints rgba(0, 255, 0, 0.4) inline; re-deriving
  // the glyph (no user color/opacity) must carry that alpha, not reset to 1.
  const author = makeAuthorIcon({ iconColor: "" });
  author.createIcon = vi.fn(() => {
    const div = document.createElement("div");
    div.className = "awesome-marker";
    div.innerHTML =
      '<i class="fa fa-map-marker" style="color: rgba(0, 255, 0, 0.4)"></i>';
    return div;
  });
  const derived = buildMarkerIcon({ author, glyph: "star" }) as any;
  expect(derived.createIcon().querySelector("i")?.style.color).toBe(
    "rgba(0, 255, 0, 0.4)",
  );
});
it("paints a user color at opacity 0 as fully transparent", () => {
  const author = makeAuthorIcon({ iconColor: "" });
  const derived = buildMarkerIcon({
    author,
    glyph: "star",
    color: "#0000ff",
    opacity: 0,
  }) as any;
  expect(derived.createIcon().querySelector("i")?.style.color).toBe(
    "rgba(0, 0, 255, 0)",
  );
});
describe("parseColorAlpha / composeColorAlpha", () => {
  it("parses a 6-digit hex as opaque", () => {
    expect(parseColorAlpha("#12abef")).toEqual({ hex: "#12abef", alpha: 100 });
  });
  it("expands a 3-digit hex and lowercases", () => {
    expect(parseColorAlpha("#ABC")).toEqual({ hex: "#aabbcc", alpha: 100 });
  });
  it("parses a normalized rgb() as opaque", () => {
    expect(parseColorAlpha("rgb(255, 0, 0)")).toEqual({ hex: "#ff0000", alpha: 100 });
  });
  it("parses a normalized rgba() with a 0-1 alpha", () => {
    expect(parseColorAlpha("rgba(255, 0, 0, 0.5)")).toEqual({
      hex: "#ff0000",
      alpha: 50,
    });
  });
  it("rounds a fractional rgba alpha to a whole percent", () => {
    expect(parseColorAlpha("rgba(18, 171, 239, 0.33)")).toEqual({
      hex: "#12abef",
      alpha: 33,
    });
  });
  it("returns null for a named color, CSS variable, or empty string", () => {
    expect(parseColorAlpha("blue")).toBeNull();
    expect(parseColorAlpha("var(--x)")).toBeNull();
    expect(parseColorAlpha("")).toBeNull();
    expect(parseColorAlpha("  ")).toBeNull();
  });
  it("composes an opaque alpha as the bare hex", () => {
    expect(composeColorAlpha("#12abef", 100)).toBe("#12abef");
  });
  it("composes a translucent alpha as rgba with a 0-1 fraction", () => {
    expect(composeColorAlpha("#ff0000", 50)).toBe("rgba(255, 0, 0, 0.5)");
    expect(composeColorAlpha("#12abef", 33)).toBe("rgba(18, 171, 239, 0.33)");
  });
  it("composes 0 alpha as fully transparent", () => {
    expect(composeColorAlpha("#0000ff", 0)).toBe("rgba(0, 0, 255, 0)");
  });
});

describe("glyphSource", () => {
  it("resolves a syntactically valid name to itself and renders a FontAwesome element", () => {
    expect(resolveGlyph("star")).toBe("star");
    const html = glyphHtml("star");
    expect(html).toContain('class="foliplus-marker-glyph fa-solid fa-star"');
  });
  it("accepts any syntactically valid name — the grid is not a whitelist", () => {
    // A valid FA6 name outside the 40-slot grid round-trips: resolveGlyph
    // keeps it, isGlyphSyntax admits it. Only syntax is the gate.
    expect(resolveGlyph("map-location-dot")).toBe("map-location-dot");
    expect(isGlyphSyntax("map-location-dot")).toBe(true);
    expect(isGlyphSyntax("star")).toBe(true);
    expect(isGlyphSyntax("circle-info")).toBe(true);
  });
  it("rejects a syntactically invalid name", () => {
    // Empty, too long, bad characters, leading/trailing/double hyphens.
    expect(isGlyphSyntax("")).toBe(false);
    expect(isGlyphSyntax("Map-Pin")).toBe(false); // uppercase
    expect(isGlyphSyntax("map_pin")).toBe(false); // underscore
    expect(isGlyphSyntax("map pin")).toBe(false); // space
    expect(isGlyphSyntax("-pin")).toBe(false); // leading hyphen
    expect(isGlyphSyntax("pin-")).toBe(false); // trailing hyphen
    expect(isGlyphSyntax("a--b")).toBe(false); // double hyphen
    expect(isGlyphSyntax("a".repeat(65))).toBe(false); // too long
    expect(resolveGlyph("nope-!")).toBeNull();
  });
  it("reports availability by the loaded stylesheet paint", () => {
    // Default stub paints ::before; a real FA class gives a codepoint.
    (window as any).__glyphProbePainted = true;
    expect(glyphAvailable("star")).toBe(true);
    // Flip to "none" for a fresh name: the stylesheet does not paint it.
    (window as any).__glyphProbePainted = false;
    expect(glyphAvailable("nonexistent")).toBe(false);
  });
  it("reports unavailable when there is no document (Leaflet-free DOM)", () => {
    // The no-document arm of glyphAvailable — a non-browser context has no
    // stylesheet to probe, so every name is unavailable. vi.stubGlobal
    // handles jsdom's getter-only document property.
    vi.stubGlobal("document", undefined);
    try {
      expect(glyphAvailable("no-doc-probe")).toBe(false);
    } finally {
      vi.unstubAllGlobals();
    }
  });
  it("caches a probe result so a second read never re-queries", () => {
    const spy = vi.mocked(window.getComputedStyle);
    (window as any).__glyphProbePainted = true;
    glyphAvailable("cached-star");
    const callsAfterFirst = spy.mock.calls.length;
    glyphAvailable("cached-star");
    expect(spy.mock.calls.length).toBe(callsAfterFirst);
  });
  it("keeps the 40-slot shortcut grid", () => {
    expect(PICKER_GLYPHS).toContain("star");
    expect(PICKER_GLYPHS.length).toBe(40);
  });
});
