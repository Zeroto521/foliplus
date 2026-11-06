// core/leaflet/markerIcon — pure Leaflet logic for the per-layer marker
// icon dimension (relocated from control/LayerControl/ui/style/icon.test.ts).
// No DOM/panel: this file pins the capture / derive / reset / probe
// contracts at the Leaflet-object level.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  GLYPH_NAMES,
  glyphHtml,
  isGlyphName,
  resolveGlyph,
} from "#core/leaflet/glyphSource.js";
import {
  applyIconToLeaves,
  authorGlyphName,
  buildMarkerIcon,
  captureAuthorIcon,
  isIconLeaf,
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
    markerColor: string;
    withShadow: boolean;
  }> = {},
) => {
  const cfg = {
    className: opts.className ?? "awesome-marker",
    bg: opts.bg ?? "url(icon.png) -24px 0",
    size: opts.size ?? ([36, 46] as [number, number]),
    markerColor: opts.markerColor ?? "blue",
    withShadow: opts.withShadow ?? true,
  };
  const author: any = {
    options: {
      markerColor: cfg.markerColor,
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
});

describe("authorGlyphName", () => {
  it("returns the first recognized author glyph name", () => {
    const withGlyph = makeMarker({ options: { icon: "star" } });
    const plain = makeMarker({ options: {} });
    expect(authorGlyphName(makeMarkerGroup(plain, withGlyph))).toBe("star");
  });
  it("returns null when no leaf declares a known glyph", () => {
    const plain = makeMarker({ options: {} });
    expect(authorGlyphName(makeMarkerGroup(plain))).toBeNull();
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

  it("carries the author inner <i> class and colour into the glyph", () => {
    const author = makeAuthorIcon();
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

  it("defaults the glyph colour to white when the author has none", () => {
    const author = makeAuthorIcon();
    const derived = buildMarkerIcon({ author, glyph: "star" }) as any;
    expect(derived.createIcon().querySelector("i")?.style.color).toBe(
      "rgb(255, 255, 255)",
    );
  });

  it("defaults to white and no author paint when the author div has no inner <i>", () => {
    const author = makeAuthorIcon();
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

  it("keeps the author icon for a name outside the set (no substitute glyph)", () => {
    const author = makeAuthorIcon();
    expect(buildMarkerIcon({ author, glyph: "nope" })).toBe(author);
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

describe("glyphSource", () => {
  it("resolves a known name to itself and renders a FontAwesome element", () => {
    expect(resolveGlyph("star")).toBe("star");
    const html = glyphHtml("star");
    expect(html).toContain('class="foliplus-marker-glyph fa-solid fa-star"');
  });
  it("returns null for a name outside the set — never a substitute icon", () => {
    expect(resolveGlyph("nope")).toBeNull();
    expect(resolveGlyph("pin")).toBeNull();
    expect(resolveGlyph("map-marker")).toBeNull();
  });
  it("gates persistence on the same set (no alias asymmetry to maintain)", () => {
    expect(isGlyphName("map-pin")).toBe(true);
    expect(isGlyphName("pin")).toBe(false);
    expect(isGlyphName("map-marker")).toBe(false);
    expect(GLYPH_NAMES).toContain("star");
  });
});
