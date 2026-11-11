// control/LayerControl/ui/style/markerColor — the per-layer marker
// chassis color dimension (custom hex swatch + chassis opacity), orthogonal
// to the glyph and the glyph color. This file pins the DOM/panel-level
// contract: the gate's positive and negative carriers, the merged
// single-construction derive (chassis and glyph/color never split across two
// writes), the chassis-span structure (preset sprite / custom mask, span
// opacity leaves the glyph untouched), Reset restoring the author chassis
// without clearing a user glyph or icon color, and the persistence parser.
import { initFixture } from "../fixture.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as CONST from "#control/LayerControl/const.js";
import type { LayerController } from "#control/LayerControl/controller.js";
import type { LayerUI } from "#control/LayerControl/ui/index.js";
import { INTENT, getIntent } from "#control/LayerControl/ui/intent.js";
import {
  MARKER_COLOR_DIMENSION,
  applyMarkerColorToLayer,
  buildMarkerColorRow,
  commitMarkerColor,
  commitMarkerColorOpacity,
  layerCanMarkerColor,
  resetLayerMarkerColor,
} from "#control/LayerControl/ui/style/markerColor.js";
import { writeIntentKeys } from "#control/LayerControl/ui/style/registry.js";
import { FACE, flushStyleDimApply } from "#control/LayerControl/ui/style/styleBag.js";

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
// `markerColor` face (the capability probe keys on this) — the preset enum
// name the sprite class is built from — and its `createIcon` paints the
// preset chassis through the author's own `_setIconStyles`, exactly the way
// the real awesome-markers library builds the sprite background. The inline
// backgroundImage is a BARE url (jsdom rejects the url+position shorthand),
// with the position in its own longhand, so readChassisSprite can read it.
const makeAuthorIcon = (
  opts: {
    iconColor?: string;
    innerColor?: string;
    markerColor?: string;
  } = {},
) => {
  const markerColor = opts.markerColor ?? "blue";
  const author: any = {
    options: {
      iconColor: opts.iconColor ?? "blue",
      markerColor,
      className: "awesome-marker",
      iconSize: [36, 46],
      iconAnchor: [18, 46],
      popupAnchor: [0, -46],
    },
    createIcon: vi.fn(function (this: any) {
      const div = document.createElement("div");
      div.style.backgroundImage = "url(icon.png)";
      div.style.backgroundPosition = "-24px 0";
      div.style.width = "36px";
      div.style.height = "46px";
      div.innerHTML = opts.innerColor
        ? `<i class="fa fa-map-marker" style="color:${opts.innerColor}"></i>`
        : '<i class="fa fa-map-marker"></i>';
      this._setIconStyles?.(div, `icon-${this.options.markerColor}`);
      return div;
    }),
    _setIconStyles: vi.fn(function (this: any, div: HTMLElement, name: string) {
      div.className =
        `awesome-marker-${name} ${this.options.className ?? "awesome-marker"}`.trim();
    }),
    createShadow: vi.fn(() => {
      const sh = document.createElement("div");
      sh.className = "awesome-marker-shadow";
      return sh;
    }),
  };
  return author;
};

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

const makeImgAuthor = () => ({
  options: { className: "leaflet-marker-icon" },
  createIcon: vi.fn(() => {
    const img = document.createElement("img");
    img.className = "leaflet-marker-icon";
    return img;
  }),
  _setIconStyles: vi.fn((div: HTMLElement) => {
    div.className = "leaflet-marker-icon";
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

  it("declines an <img>-based icon (Icon.Default / iconUrl)", () => {
    const img = makeMarker({ type: "school" }, makeImgAuthor());
    const { ui: u3 } = fixtureWithMarkers([img]);
    expect(layerCanMarkerColor(u3, "overlay1")).toBe(false);
  });

  it("declines a leaf with no icon at all", () => {
    const bare = makeMarker({ type: "school" });
    const { ui: u4 } = fixtureWithMarkers([bare]);
    expect(layerCanMarkerColor(u4, "overlay1")).toBe(false);
  });

  it("declines a non-marker layer (polygon)", () => {
    const layer = makeMarkerGroup(makePoly() as any);
    const { ui: u5 } = initFixture({
      data: [{ id: "overlay1", name: "CM", role: "overlay", layer }, BASE_LAYER],
    });
    expect(layerCanMarkerColor(u5, "overlay1")).toBe(false);
  });

  it("declines a layer not in the registry", () => {
    expect(layerCanMarkerColor(ui, "nope")).toBe(false);
  });

  it("author default maps the author preset name to its hex", () => {
    const noPaint = makeMarker({ type: "school" }, makeAuthorIcon({ markerColor: "" }));
    const { ui: uNoPaint } = fixtureWithMarkers([noPaint]);
    const row = buildMarkerColorRow(uNoPaint, "overlay1")!;
    const input = row.querySelector("input[type=color]") as HTMLInputElement;
    expect(input.value).toBe("#38aadd");
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
    expect(row!.querySelector("input[type=number]")).not.toBeNull();
  });

  it("wraps the swatch in the shared inline flex shell", () => {
    const row = buildMarkerColorRow(ui, "overlay1")!;
    const input = row.querySelector("input[type=color]")!;
    expect(input.parentElement!.classList.contains("foliplus-form-inline")).toBe(true);
    expect(
      input.parentElement!.parentElement!.classList.contains("foliplus-form-control"),
    ).toBe(true);
  });

  it("row is null when the layer is registered but not findable (findLayer null)", () => {
    const spy = vi.spyOn(ui.c, "findLayer").mockReturnValue(null as never);
    expect(buildMarkerColorRow(ui, "overlay1")).toBeNull();
    spy.mockRestore();
  });

  it("returns null for an <img>-based icon (capability gate negative)", () => {
    const img = makeMarker({ type: "school" }, makeImgAuthor());
    const { ui: u6 } = fixtureWithMarkers([img]);
    expect(buildMarkerColorRow(u6, "overlay1")).toBeNull();
  });

  it("shows the author preset hex as the default value", () => {
    const row = buildMarkerColorRow(ui, "overlay1")!;
    const input = row.querySelector("input[type=color]") as HTMLInputElement;
    expect(input.value).toBe("#38aadd");
  });

  it("short-circuits on the first painted leaf for a multi-leaf layer", () => {
    const blue = makeMarker(
      { type: "school" },
      makeAuthorIcon({ markerColor: "blue" }),
    );
    const red = makeMarker(
      { type: "hospital" },
      makeAuthorIcon({ markerColor: "red" }),
    );
    const { ui: u } = fixtureWithMarkers([blue, red]);
    const row = buildMarkerColorRow(u, "overlay1")!;
    const input = row.querySelector("input[type=color]") as HTMLInputElement;
    expect(input.value).toBe("#38aadd");
  });

  it("falls through to the blue default when the author markerColor is empty", () => {
    const empty = makeMarker({ type: "school" }, makeAuthorIcon({ markerColor: "" }));
    const { ui: u } = fixtureWithMarkers([empty]);
    const row = buildMarkerColorRow(u, "overlay1")!;
    const input = row.querySelector("input[type=color]") as HTMLInputElement;
    expect(input.value).toBe("#38aadd");
  });

  it("shows the user's stored hex when one is set", () => {
    writeIntentKeys(ui, "overlay1", [[INTENT.MARKER_COLOR, "#d63e2a"]]);
    const row = buildMarkerColorRow(ui, "overlay1")!;
    const input = row.querySelector("input[type=color]") as HTMLInputElement;
    expect(input.value).toBe("#d63e2a");
  });

  it("commits a hex from the swatch input event", () => {
    const row = buildMarkerColorRow(ui, "overlay1")!;
    const input = row.querySelector("input[type=color]") as HTMLInputElement;
    input.value = "#72b026";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    expect(getIntent(ui, "overlay1", INTENT.MARKER_COLOR)).toBe("#72b026");
  });

  it("commits a 0-100 opacity from the number field", () => {
    const row = buildMarkerColorRow(ui, "overlay1")!;
    const input = row.querySelector("input[type=number]") as HTMLInputElement;
    input.value = "50";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    expect(getIntent(ui, "overlay1", INTENT.MARKER_COLOR_OPACITY)).toBe(50);
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
    commitMarkerColor(ui, "overlay1", "#d63e2a");
    const intent = getIntent(ui, "overlay1", INTENT.MARKER_COLOR);
    expect(intent).toBe("#d63e2a");
    flushMarkerColor("overlay1");
    expect(school.setIcon).toHaveBeenCalled();
    const written = school.options.icon;
    expect(written).not.toBe(authorIcon);
    const div = written.createIcon();
    expect(div.className).toContain("awesome-marker-icon-red");
    const inner = div.querySelector("i") as HTMLElement;
    expect(inner.className).toContain("foliplus-marker-glyph");
  });

  it("preset hex at alpha 100 keeps the library sprite class and NO chassis span", () => {
    commitMarkerColor(ui, "overlay1", "#38aadd");
    flushMarkerColor("overlay1");
    const div = school.options.icon.createIcon();
    expect(div.className).toContain("awesome-marker-icon-blue");
    expect(div.querySelector(".foliplus-marker-chassis")).toBeNull();
  });

  it("preset hex below 100 takes a chassis span with the sprite background and span opacity", () => {
    commitMarkerColor(ui, "overlay1", "#38aadd");
    commitMarkerColorOpacity(ui, "overlay1", 50);
    flushMarkerColor("overlay1");
    const div = school.options.icon.createIcon();
    const span = div.querySelector(".foliplus-marker-chassis") as HTMLElement;
    expect(span).not.toBeNull();
    expect(span.style.backgroundImage).toContain("url(");
    expect(span.style.opacity).toBe("0.5");
    expect(div.style.backgroundImage).toBe("none");
  });

  it("custom hex takes a chassis span with the sprite as a mask and background-color paint", () => {
    commitMarkerColor(ui, "overlay1", "#ff9900");
    flushMarkerColor("overlay1");
    const div = school.options.icon.createIcon();
    const span = div.querySelector(".foliplus-marker-chassis") as HTMLElement;
    expect(span).not.toBeNull();
    expect(span.style.maskImage).toContain("url(");
    expect(span.style.backgroundColor).toBe("rgb(255, 153, 0)");
  });

  it("chassis opacity does NOT fade the glyph (span carries only the pin)", () => {
    commitMarkerColor(ui, "overlay1", "#38aadd");
    commitMarkerColorOpacity(ui, "overlay1", 0);
    flushMarkerColor("overlay1");
    const div = school.options.icon.createIcon();
    const span = div.querySelector(".foliplus-marker-chassis") as HTMLElement;
    expect(span.style.opacity).toBe("0");
    const inner = div.querySelector("i") as HTMLElement;
    expect(inner).not.toBeNull();
  });

  it("apply is a no-op without a marker-color intent", () => {
    applyMarkerColorToLayer(ui, "overlay1");
    expect(school.setIcon).not.toHaveBeenCalled();
    expect(school.options.icon).toBe(authorIcon);
  });

  it("merged construction: setting a glyph then a chassis keeps both", () => {
    writeIntentKeys(ui, "overlay1", [[INTENT.ICON, { kind: "glyph", value: "star" }]]);
    commitMarkerColor(ui, "overlay1", "#72b026");
    flushMarkerColor("overlay1");
    const div = school.options.icon.createIcon();
    const inner = div.querySelector("i") as HTMLElement;
    expect(div.className).toContain("awesome-marker-icon-green");
    expect(inner.className).toContain("foliplus-marker-glyph");
    expect(inner.className).toContain("fa-star");
  });

  it("merged construction: a user icon color survives the chassis write", () => {
    writeIntentKeys(ui, "overlay1", [[INTENT.ICON_COLOR, "#ff0000"]]);
    commitMarkerColor(ui, "overlay1", "#d252b9");
    flushMarkerColor("overlay1");
    const div = school.options.icon.createIcon();
    const inner = div.querySelector("i") as HTMLElement;
    expect(div.className).toContain("awesome-marker-icon-purple");
    expect(inner.style.color).toBe("rgb(255, 0, 0)");
  });

  it("reset restores the author chassis and drops the intent", () => {
    commitMarkerColor(ui, "overlay1", "#d63e2a");
    flushMarkerColor("overlay1");
    expect(school.options.icon).not.toBe(authorIcon);
    resetLayerMarkerColor(ui, "overlay1");
    flushMarkerColor("overlay1");
    const div = school.options.icon.createIcon();
    expect(div.className).toContain("awesome-marker-icon-blue");
    expect(getIntent(ui, "overlay1", INTENT.MARKER_COLOR)).toBeUndefined();
  });

  it("reset with no author chassis, no glyph and no color skips the re-apply (both false arms)", () => {
    const plainAuthor = makePlainDivIconAuthor();
    const plainMarker = makeMarker({ type: "school" }, plainAuthor);
    ({ manager, ui } = fixtureWithMarkers([plainMarker]));
    window.localStorage.removeItem(CONST.STORAGE.KEY);
    writeIntentKeys(ui, "overlay1", [[INTENT.MARKER_COLOR, "#d63e2a"]]);
    commitMarkerColor(ui, "overlay1", "#d63e2a");
    flushMarkerColor("overlay1");
    resetLayerMarkerColor(ui, "overlay1");
    flushMarkerColor("overlay1");
    expect(plainMarker.options.icon).toBe(plainAuthor);
    expect(getIntent(ui, "overlay1", INTENT.MARKER_COLOR)).toBeUndefined();
  });

  it("reset with no author chassis and a glyph but no icon color keeps the glyph on blue", () => {
    const plainAuthor = makePlainDivIconAuthor();
    const plainMarker = makeMarker({ type: "school" }, plainAuthor);
    ({ manager, ui } = fixtureWithMarkers([plainMarker]));
    window.localStorage.removeItem(CONST.STORAGE.KEY);
    writeIntentKeys(ui, "overlay1", [
      [INTENT.ICON, { kind: "glyph", value: "star" }],
      [INTENT.MARKER_COLOR, "#d63e2a"],
    ]);
    commitMarkerColor(ui, "overlay1", "#d63e2a");
    flushMarkerColor("overlay1");
    resetLayerMarkerColor(ui, "overlay1");
    flushMarkerColor("overlay1");
    const div = plainMarker.options.icon.createIcon();
    expect(div.className).toContain("plain-div-icon");
    expect(getIntent(ui, "overlay1", INTENT.MARKER_COLOR)).toBeUndefined();
  });

  it("reset preserves a user-set glyph (orthogonal)", () => {
    writeIntentKeys(ui, "overlay1", [
      [INTENT.ICON, { kind: "glyph", value: "star" }],
      [INTENT.MARKER_COLOR, "#d63e2a"],
    ]);
    commitMarkerColor(ui, "overlay1", "#d63e2a");
    flushMarkerColor("overlay1");
    resetLayerMarkerColor(ui, "overlay1");
    flushMarkerColor("overlay1");
    const div = school.options.icon.createIcon();
    const inner = div.querySelector("i") as HTMLElement;
    expect(div.className).toContain("awesome-marker-icon-blue");
    expect(inner.className).toContain("foliplus-marker-glyph");
    expect(inner.className).toContain("fa-star");
  });

  it("reset preserves a user-set icon color (orthogonal)", () => {
    writeIntentKeys(ui, "overlay1", [
      [INTENT.ICON_COLOR, "#00ff00"],
      [INTENT.MARKER_COLOR, "#d63e2a"],
    ]);
    commitMarkerColor(ui, "overlay1", "#d63e2a");
    flushMarkerColor("overlay1");
    resetLayerMarkerColor(ui, "overlay1");
    flushMarkerColor("overlay1");
    const div = school.options.icon.createIcon();
    const inner = div.querySelector("i") as HTMLElement;
    expect(div.className).toContain("awesome-marker-icon-blue");
    expect(inner.style.color).toBe("rgb(0, 255, 0)");
  });

  it("reset with no author chassis re-applies the user glyph/color on blue (else arm)", () => {
    const plainAuthor = makePlainDivIconAuthor();
    const plainMarker = makeMarker({ type: "school" }, plainAuthor);
    ({ manager, ui } = fixtureWithMarkers([plainMarker]));
    window.localStorage.removeItem(CONST.STORAGE.KEY);
    writeIntentKeys(ui, "overlay1", [
      [INTENT.ICON, { kind: "glyph", value: "star" }],
      [INTENT.ICON_COLOR, "#00ff00"],
      [INTENT.MARKER_COLOR, "#d63e2a"],
    ]);
    commitMarkerColor(ui, "overlay1", "#d63e2a");
    flushMarkerColor("overlay1");
    resetLayerMarkerColor(ui, "overlay1");
    flushMarkerColor("overlay1");
    const div = plainMarker.options.icon.createIcon();
    expect(div.className).toContain("plain-div-icon");
    expect(plainMarker.options.icon).not.toBe(plainAuthor);
    expect(getIntent(ui, "overlay1", INTENT.MARKER_COLOR)).toBeUndefined();
  });

  it("reset skips a missing layer without throwing", () => {
    expect(() => resetLayerMarkerColor(ui, "nope")).not.toThrow();
  });

  it("reset is a no-op when the layer left the map", () => {
    commitMarkerColor(ui, "overlay1", "#d63e2a");
    flushMarkerColor("overlay1");
    vi.spyOn(ui.c, "findLayer").mockReturnValue(null as never);
    expect(() => resetLayerMarkerColor(ui, "overlay1")).not.toThrow();
    expect(getIntent(ui, "overlay1", INTENT.MARKER_COLOR)).toBeUndefined();
    vi.restoreAllMocks();
  });

  it("set Marker Color changes the chassis only, NOT the glyph color", () => {
    commitMarkerColor(ui, "overlay1", "#d63e2a");
    flushMarkerColor("overlay1");
    const div = school.options.icon.createIcon();
    const inner = div.querySelector("i") as HTMLElement;
    expect(div.className).toContain("awesome-marker-icon-red");
    expect(inner.style.color).toBe("blue");
  });

  it("commit on a multi-leaf layer walks every marker in one construction", () => {
    const a = makeMarker({ type: "school" }, makeAuthorIcon({ markerColor: "blue" }));
    const b = makeMarker({ type: "hospital" }, makeAuthorIcon({ markerColor: "red" }));
    const { ui: uMulti, manager: mgr } = fixtureWithMarkers([a, b]);
    commitMarkerColor(uMulti, "overlay1", "#72b026");
    flushMarkerColor("overlay1");
    expect(a.setIcon).toHaveBeenCalled();
    expect(b.setIcon).toHaveBeenCalled();
    const divA = a.options.icon.createIcon();
    const divB = b.options.icon.createIcon();
    expect(divA.className).toContain("awesome-marker-icon-green");
    expect(divB.className).toContain("awesome-marker-icon-green");
    mgr?.debouncedEnforce?.cancel?.();
    document.body.innerHTML = "";
    vi.clearAllMocks();
    vi.useRealTimers();
  });
});

describe("markerColor dimension — surface integration", () => {
  it("registers the dimension with its own markerColor face", () => {
    expect(MARKER_COLOR_DIMENSION).toBeDefined();
    expect(MARKER_COLOR_DIMENSION.contentChange).toMatchObject({
      kind: "frame",
      face: FACE.MARKER_COLOR,
    });
  });
});

describe("markerColor dimension descriptor", () => {
  let manager: LayerController;
  let ui: LayerUI;
  let school: any;
  beforeEach(() => {
    school = makeMarker({ type: "school" }, makeAuthorIcon({ markerColor: "blue" }));
    ({ manager, ui } = fixtureWithMarkers([school]));
    window.localStorage.removeItem(CONST.STORAGE.KEY);
  });
  afterEach(() => {
    manager?.debouncedEnforce?.cancel?.();
    document.body.innerHTML = "";
    vi.clearAllMocks();
    vi.useRealTimers();
  });
  it("value returns the stored user value, else undefined", () => {
    expect(MARKER_COLOR_DIMENSION.value(ui, "overlay1")).toBeUndefined();
    writeIntentKeys(ui, "overlay1", [[INTENT.MARKER_COLOR, "#d63e2a"]]);
    expect(MARKER_COLOR_DIMENSION.value(ui, "overlay1")).toEqual({ value: "#d63e2a" });
  });
  it("value returns the stored opacity when only the opacity is set", () => {
    writeIntentKeys(ui, "overlay1", [[INTENT.MARKER_COLOR_OPACITY, 50]]);
    expect(MARKER_COLOR_DIMENSION.value(ui, "overlay1")).toEqual({ opacity: 50 });
  });
  it("write stores the value and schedules an apply", () => {
    MARKER_COLOR_DIMENSION.write!(ui, "overlay1", { value: "#72b026" });
    expect(getIntent(ui, "overlay1", INTENT.MARKER_COLOR)).toBe("#72b026");
    flushMarkerColor("overlay1");
    expect(school.setIcon).toHaveBeenCalled();
  });
  it("write stores the opacity and schedules an apply", () => {
    MARKER_COLOR_DIMENSION.write!(ui, "overlay1", { opacity: 40 });
    expect(getIntent(ui, "overlay1", INTENT.MARKER_COLOR_OPACITY)).toBe(40);
    flushMarkerColor("overlay1");
    expect(school.setIcon).toHaveBeenCalled();
  });
  it("write ignores a non-string value", () => {
    MARKER_COLOR_DIMENSION.write!(ui, "overlay1", { value: undefined });
    expect(getIntent(ui, "overlay1", INTENT.MARKER_COLOR)).toBeUndefined();
  });
  it("write ignores an out-of-range opacity", () => {
    MARKER_COLOR_DIMENSION.write!(ui, "overlay1", { opacity: 150 });
    expect(getIntent(ui, "overlay1", INTENT.MARKER_COLOR_OPACITY)).toBeUndefined();
  });
  it("reset clears the persisted value", () => {
    writeIntentKeys(ui, "overlay1", [[INTENT.MARKER_COLOR, "#d63e2a"]]);
    MARKER_COLOR_DIMENSION.reset!(ui, "overlay1");
    flushMarkerColor("overlay1");
    expect(getIntent(ui, "overlay1", INTENT.MARKER_COLOR)).toBeUndefined();
  });
  it("valueSource reports user after a write, author before", () => {
    expect(MARKER_COLOR_DIMENSION.valueSource!(ui, "overlay1")).toBe("author");
    writeIntentKeys(ui, "overlay1", [[INTENT.MARKER_COLOR, "#d63e2a"]]);
    expect(MARKER_COLOR_DIMENSION.valueSource!(ui, "overlay1")).toBe("user");
  });
  it("valueSource reports user when only the opacity is set", () => {
    writeIntentKeys(ui, "overlay1", [[INTENT.MARKER_COLOR_OPACITY, 30]]);
    expect(MARKER_COLOR_DIMENSION.valueSource!(ui, "overlay1")).toBe("user");
  });
  it("contentChange when is true only once a marker-color intent exists", () => {
    const policy = MARKER_COLOR_DIMENSION.contentChange;
    if (policy.kind !== "frame") throw new Error("expected a frame policy");
    expect(policy.when!(ui, "overlay1")).toBe(false);
    writeIntentKeys(ui, "overlay1", [[INTENT.MARKER_COLOR, "#d63e2a"]]);
    expect(policy.when!(ui, "overlay1")).toBe(true);
  });
  it("contentChange when is true for an opacity-only intent", () => {
    const policy = MARKER_COLOR_DIMENSION.contentChange;
    if (policy.kind !== "frame") throw new Error("expected a frame policy");
    writeIntentKeys(ui, "overlay1", [[INTENT.MARKER_COLOR_OPACITY, 50]]);
    expect(policy.when!(ui, "overlay1")).toBe(true);
  });
  it("row builds the color row for a capable carrier", () => {
    const row = MARKER_COLOR_DIMENSION.row(ui, "overlay1") as HTMLElement;
    expect(row.classList.contains(CONST.CLASSES.STYLE_MARKER_COLOR_ROW)).toBe(true);
  });
  it("contentChange run applies the stored value", () => {
    writeIntentKeys(ui, "overlay1", [[INTENT.MARKER_COLOR, "#d252b9"]]);
    const policy = MARKER_COLOR_DIMENSION.contentChange;
    if (policy.kind !== "frame") throw new Error("expected a frame policy");
    policy.run!(ui, "overlay1");
    flushMarkerColor("overlay1");
    expect(school.setIcon).toHaveBeenCalled();
    const div = school.options.icon.createIcon();
    expect(div.className).toContain("awesome-marker-icon-purple");
  });
  it("apply is a no-op when findLayer returns null", () => {
    writeIntentKeys(ui, "overlay1", [[INTENT.MARKER_COLOR, "#d63e2a"]]);
    vi.spyOn(ui.c, "findLayer").mockReturnValue(null as never);
    applyMarkerColorToLayer(ui, "overlay1");
    expect(school.setIcon).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });
  it("valueSource reports none for an incapable carrier", () => {
    const img = makeMarker({ type: "school" }, makeImgAuthor());
    const { ui: uImg } = fixtureWithMarkers([img]);
    expect(MARKER_COLOR_DIMENSION.valueSource!(uImg, "overlay1")).toBe("none");
  });
});
