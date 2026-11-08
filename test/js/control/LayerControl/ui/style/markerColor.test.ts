// control/LayerControl/ui/style/markerColor — the per-layer marker
// colour dimension (awesome-markers `markerColor` face), orthogonal to the
// glyph. This file pins the DOM/panel-level contract: the gate's positive
// and negative carriers, the merged single-construction derive (colour and
// glyph never split across two writes), Reset restoring the author paint
// without clearing a user glyph, and the persistence parser.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DIM } from "#core/layer/index.js";
import * as CONST from "#control/LayerControl/const.js";
import type { LayerController } from "#control/LayerControl/controller.js";
import type { LayerUI } from "#control/LayerControl/ui/index.js";
import { INTENT, getIntent } from "#control/LayerControl/ui/intent.js";
import { applyIconToLayer } from "#control/LayerControl/ui/style/icon.js";
import {
  MARKER_COLOR_DIMENSION,
  applyMarkerColorToLayer,
  buildMarkerColorRow,
  commitMarkerColor,
  layerCanMarkerColor,
  resetLayerMarkerColor,
} from "#control/LayerControl/ui/style/markerColor.js";
import { writeIntentKeys } from "#control/LayerControl/ui/style/registry.js";
import { FACE, flushStyleDimApply } from "#control/LayerControl/ui/style/styleBag.js";
import { initFixture } from "../fixture.js";

// The shared L stub (test/js/setup.ts) defines no Icon key. The core
// markerIcon module reads L.Icon.Default; provide a minimal Default class so
// `author instanceof L.Icon.Default` does not throw.
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
  vi.restoreAllMocks();
  document.body.innerHTML = "";
  (window as any).__glyphProbePainted = true;
});

// A marker leaf: the layer type the colour dimension owns. It carries a
// runtime `setIcon` (the duck-type the capability probe keys on) and an
// `options.icon` that `setIcon` replaces in place.
const makeMarker = (props: Record<string, unknown> = {}, icon?: unknown): any => {
  const leaf: any = {
    feature: { properties: props },
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

const makePoly = (): any => ({
  options: {},
  setStyle: vi.fn(),
  getLatLngs: () => [
    [
      { lat: 0, lng: 0 },
      { lat: 1, lng: 0 },
      { lat: 0, lng: 1 },
    ],
  ],
});

const BASE_LAYER = {
  id: "base1",
  name: "OSM",
  role: "base",
  layer: { options: {}, setZIndex: vi.fn() } as never,
  paneName: "tilePane",
};

const fixtureWithMarkers = (markers: any[]) => {
  const layer = makeMarkerGroup(...markers);
  const fixture = initFixture({
    data: [{ id: "overlay1", name: "CM", role: "overlay", layer }, BASE_LAYER],
  });
  return { ...fixture, layer };
};

const flushMarkerColor = (id: string) => flushStyleDimApply(FACE.MARKER_COLOR, id);

// A realistic awesome-markers author icon. Its `options` declares a
// `markerColor` face (the capability probe keys on this), and its
// `createIcon` returns an <i> with the author's inline colour.
const makeAuthorIcon = (opts: { markerColor?: string; innerColor?: string } = {}) => {
  const author: any = {
    options: {
      markerColor: opts.markerColor ?? "blue",
      className: "awesome-marker",
      iconSize: [36, 46],
      iconAnchor: [18, 46],
      popupAnchor: [0, -46],
    },
    createIcon: vi.fn(() => {
      const div = document.createElement("div");
      div.className = "awesome-marker";
      div.style.backgroundImage = "url(icon.png) -24px 0";
      div.style.backgroundPosition = "-24px 0";
      div.style.width = "36px";
      div.style.height = "46px";
      div.innerHTML = opts.innerColor
        ? '<i class="fa fa-map-marker" style="color:' + opts.innerColor + '"></i>'
        : '<i class="fa fa-map-marker"></i>';
      return div;
    }),
    _setIconStyles: vi.fn((div: HTMLElement, name: string) => {
      div.className = (name + " awesome-marker").trim();
    }),
    createShadow: vi.fn(() => {
      const sh = document.createElement("div");
      sh.className = "awesome-marker-shadow";
      return sh;
    }),
  };
  return author;
};

// A plain divIcon author: NO markerColor face. The capability probe must
// answer "none" so the marker-colour row never renders for this carrier.
const makePlainDivIconAuthor = () => ({
  options: { className: "plain-div-icon" },
  createIcon: vi.fn(() => {
    const div = document.createElement("div");
    div.className = "plain-div-icon";
    return div;
  }),
  _setIconStyles: vi.fn((div: HTMLElement) => {
    div.className = "plain-div-icon";
  }),
});

describe("layerCanMarkerColor", () => {
  let manager: LayerController;
  let ui: LayerUI;

  beforeEach(() => {
    ({ manager, ui } = fixtureWithMarkers([
      makeMarker({ type: "school" }, makeAuthorIcon({ markerColor: "blue" })),
    ]));
    window.localStorage.removeItem(CONST.STORAGE.KEY);
  });

  afterEach(() => {
    manager?.debouncedEnforce?.cancel?.();
    vi.useRealTimers();
  });

  it("accepts an awesome-markers carrier (markerColor face declared)", () => {
    expect(layerCanMarkerColor(ui, "overlay1")).toBe(true);
  });

  it("declines a plain divIcon carrier (no markerColor face)", () => {
    const plain = makeMarker({ type: "school" }, makePlainDivIconAuthor());
    const { ui: u2 } = fixtureWithMarkers([plain]);
    expect(layerCanMarkerColor(u2, "overlay1")).toBe(false);
  });

  it("declines a leaf with no icon at all", () => {
    const bare = makeMarker({ type: "school" });
    const { ui: u3 } = fixtureWithMarkers([bare]);
    expect(layerCanMarkerColor(u3, "overlay1")).toBe(false);
  });

  it("declines a non-marker layer (polygon)", () => {
    const layer = makeMarkerGroup(makePoly() as any);
    const { ui: u4 } = initFixture({
      data: [{ id: "overlay1", name: "CM", role: "overlay", layer }, BASE_LAYER],
    });
    expect(layerCanMarkerColor(u4, "overlay1")).toBe(false);
  });

  it("declines a layer not in the registry", () => {
    expect(layerCanMarkerColor(ui, "nope")).toBe(false);
  });
});

describe("buildMarkerColorRow", () => {
  let manager: LayerController;
  let ui: LayerUI;

  beforeEach(() => {
    ({ manager, ui } = fixtureWithMarkers([
      makeMarker({ type: "school" }, makeAuthorIcon({ markerColor: "blue" })),
    ]));
    window.localStorage.removeItem(CONST.STORAGE.KEY);
  });

  afterEach(() => {
    manager?.debouncedEnforce?.cancel?.();
    document.body.innerHTML = "";
    vi.useRealTimers();
  });

  it("renders the row for an awesome-markers carrier", () => {
    const row = buildMarkerColorRow(ui, "overlay1");
    expect(row).not.toBeNull();
    expect(row!.classList.contains(CONST.CLASSES.STYLE_MARKER_COLOR_ROW)).toBe(true);
    expect(row!.querySelector("input[type=color]")).not.toBeNull();
  });

  it("returns null for a plain divIcon carrier (capability gate negative)", () => {
    const plain = makeMarker({ type: "school" }, makePlainDivIconAuthor());
    const { ui: u2 } = fixtureWithMarkers([plain]);
    expect(buildMarkerColorRow(u2, "overlay1")).toBeNull();
  });

  it("shows the author colour as the default value", () => {
    // A hex author colour survives the row's colour-input normalisation.
    const hex = makeMarker(
      { type: "school" },
      makeAuthorIcon({ markerColor: "#3366ff" }),
    );
    const { ui: uHex } = fixtureWithMarkers([hex]);
    const row = buildMarkerColorRow(uHex, "overlay1")!;
    const input = row.querySelector("input[type=color]") as HTMLInputElement;
    expect(input.value).toBe("#3366ff");
  });

  it("shows the user's stored colour when one is set", () => {
    writeIntentKeys(ui, "overlay1", [[INTENT.MARKER_COLOR, "#ff0000"]]);
    const row = buildMarkerColorRow(ui, "overlay1")!;
    const input = row.querySelector("input[type=color]") as HTMLInputElement;
    expect(input.value).toBe("#ff0000");
  });
});

describe("applyMarkerColorToLayer / commitMarkerColor / resetLayerMarkerColor", () => {
  let manager: LayerController;
  let ui: LayerUI;
  let school: any;
  let authorIcon: any;

  beforeEach(() => {
    authorIcon = makeAuthorIcon({ markerColor: "blue" });
    school = makeMarker({ type: "school" }, authorIcon);
    ({ manager, ui } = fixtureWithMarkers([school]));
    window.localStorage.removeItem(CONST.STORAGE.KEY);
  });

  afterEach(() => {
    manager?.debouncedEnforce?.cancel?.();
    document.body.innerHTML = "";
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it("commit writes the intent and schedules an apply", () => {
    commitMarkerColor(ui, "overlay1", "#00ff00");
    const intent = getIntent(ui, "overlay1", INTENT.MARKER_COLOR);
    expect(intent).toBe("#00ff00");
    flushMarkerColor("overlay1");
    expect(school.setIcon).toHaveBeenCalled();
    const written = school.options.icon;
    expect(written).not.toBe(authorIcon);
    // The derived icon carries the colour in ONE construction with the glyph.
    const div = written.createIcon();
    const inner = div.querySelector("i") as HTMLElement;
    expect(inner.style.color).toBe("rgb(0, 255, 0)");
    expect(inner.className).toContain("foliplus-marker-glyph");
  });

  it("apply is a no-op without a colour intent", () => {
    applyMarkerColorToLayer(ui, "overlay1");
    expect(school.setIcon).not.toHaveBeenCalled();
    expect(school.options.icon).toBe(authorIcon);
  });

  it("merged construction: setting a glyph then a colour keeps both", () => {
    // Simulate the glyph dimension having already written its intent.
    writeIntentKeys(ui, "overlay1", [[INTENT.ICON, { kind: "glyph", value: "star" }]]);
    commitMarkerColor(ui, "overlay1", "#ff0000");
    flushMarkerColor("overlay1");
    const div = school.options.icon.createIcon();
    const inner = div.querySelector("i") as HTMLElement;
    // The glyph survived the colour write (single construction merged both).
    expect(inner.className).toContain("foliplus-marker-glyph");
    expect(inner.className).toContain("fa-star");
    expect(inner.style.color).toBe("rgb(255, 0, 0)");
  });

  it("merged construction: setting a colour then a glyph keeps both", () => {
    commitMarkerColor(ui, "overlay1", "#00ff00");
    flushMarkerColor("overlay1");
    // Now the glyph dimension writes its intent and applies (applyIconToLayer
    // merges the current colour into the same derived construction).
    writeIntentKeys(ui, "overlay1", [[INTENT.ICON, { kind: "glyph", value: "star" }]]);
    applyIconToLayer(ui, "overlay1");
    flushStyleDimApply(FACE.ICON, "overlay1");
    const div = school.options.icon.createIcon();
    const inner = div.querySelector("i") as HTMLElement;
    // The colour survived the glyph write.
    expect(inner.className).toContain("fa-star");
    expect(inner.style.color).toBe("rgb(0, 255, 0)");
  });

  it("reset restores the author paint and drops the intent", () => {
    commitMarkerColor(ui, "overlay1", "#ff0000");
    flushMarkerColor("overlay1");
    expect(school.options.icon).not.toBe(authorIcon);
    resetLayerMarkerColor(ui, "overlay1");
    flushMarkerColor("overlay1");
    const div = school.options.icon.createIcon();
    const inner = div.querySelector("i") as HTMLElement;
    // Reset restored the author paint: the author declares markerColor "blue",
    // so the derived icon paints blue (white is only the no-author-color
    // fallback). The glyph is re-derived in the SAME construction.
    expect(inner.style.color).toBe("blue");
    expect(getIntent(ui, "overlay1", INTENT.MARKER_COLOR)).toBeUndefined();
  });

  it("reset preserves a user-set glyph (orthogonal)", () => {
    // User set both a glyph and a colour.
    writeIntentKeys(ui, "overlay1", [
      [INTENT.ICON, { kind: "glyph", value: "star" }],
      [INTENT.MARKER_COLOR, "#ff0000"],
    ]);
    commitMarkerColor(ui, "overlay1", "#ff0000");
    flushMarkerColor("overlay1");
    // Reset the colour only — the glyph must survive.
    resetLayerMarkerColor(ui, "overlay1");
    flushMarkerColor("overlay1");
    const div = school.options.icon.createIcon();
    const inner = div.querySelector("i") as HTMLElement;
    expect(inner.className).toContain("foliplus-marker-glyph");
    expect(inner.className).toContain("fa-star");
  });

  it("reset skips a missing layer without throwing", () => {
    expect(() => resetLayerMarkerColor(ui, "nope")).not.toThrow();
  });

  it("reset is a no-op when the layer left the map", () => {
    commitMarkerColor(ui, "overlay1", "#ff0000");
    flushMarkerColor("overlay1");
    vi.spyOn(ui.c, "findLayer").mockReturnValue(null as never);
    expect(() => resetLayerMarkerColor(ui, "overlay1")).not.toThrow();
    expect(getIntent(ui, "overlay1", INTENT.MARKER_COLOR)).toBeUndefined();
    vi.restoreAllMocks();
  });
});

describe("markerColor dimension — surface integration", () => {
  it("registers the dimension with the markerColor face", () => {
    // The dimension must declare its own face so it never fights the icon
    // dimension over one coalescer slot (registry.test pins the faces set).
    expect(MARKER_COLOR_DIMENSION).toBeDefined();
    expect(MARKER_COLOR_DIMENSION.contentChange).toMatchObject({
      kind: "frame",
      face: FACE.MARKER_COLOR,
    });
  });
});
