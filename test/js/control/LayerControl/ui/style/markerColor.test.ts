// control/LayerControl/ui/style/markerColor — the per-layer marker
// chassis color dimension (awesome-markers `markerColor` preset enum face),
// orthogonal to the glyph and the glyph color. This file pins the
// DOM/panel-level contract: the gate's positive and negative carriers, the
// merged single-construction derive (chassis and glyph/color never split
// across two writes), Reset restoring the author chassis without clearing a
// user glyph or icon color, and the persistence parser.
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
  layerCanMarkerColor,
  resetLayerMarkerColor,
} from "#control/LayerControl/ui/style/markerColor.js";
import { writeIntentKeys } from "#control/LayerControl/ui/style/registry.js";
import { FACE, flushStyleDimApply } from "#control/LayerControl/ui/style/styleBag.js";

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

// A marker leaf: the layer type the chassis dimension owns. It carries a
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
// `markerColor` face (the capability probe keys on this) — the preset enum
// name the sprite class is built from — and its `createIcon` paints the
// preset chassis through the author's own `_setIconStyles`, exactly the way
// the real awesome-markers library builds the sprite background.
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
      div.style.backgroundImage = "url(icon.png) -24px 0";
      div.style.backgroundPosition = "-24px 0";
      div.style.width = "36px";
      div.style.height = "46px";
      div.innerHTML = opts.innerColor
        ? `<i class="fa fa-map-marker" style="color:${opts.innerColor}"></i>`
        : '<i class="fa fa-map-marker"></i>';
      // The real awesome-markers createIcon paints the preset sprite class
      // from the CURRENT options.markerColor (the derived icon overrides
      // options before calling this, so a chassis edit re-paints the class).
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

// A plain divIcon author: NO markerColor face. The capability probe must
// answer "none" so the marker-color row never renders for this carrier.
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

// An <img>-based author (Icon.Default / iconUrl): the marker-color capability
// probe must answer "none" — an <img> has no awesome-markers sprite chassis.
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

  it("authorMarkerColor falls back to the blue default when the author paints none", () => {
    const noPaint = makeMarker({ type: "school" }, makeAuthorIcon({ markerColor: "" }));
    const { ui: uNoPaint } = fixtureWithMarkers([noPaint]);
    const row = buildMarkerColorRow(uNoPaint, "overlay1")!;
    const select = row.querySelector("select") as HTMLSelectElement;
    expect(select.value).toBe("blue");
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
    expect(row!.querySelector("select")).not.toBeNull();
  });

  it("wraps the dropdown in the shared inline flex shell", () => {
    const row = buildMarkerColorRow(ui, "overlay1")!;
    const select = row.querySelector("select")!;
    // The select lives inside the shared dropdown wrapper (trigger + hidden
    // native select); that wrapper sits in the shared inline flex shell.
    const dropdown = select.closest(".foliplus-dropdown");
    expect(dropdown).not.toBeNull();
    expect(dropdown!.parentElement!.classList.contains("foliplus-form-inline")).toBe(
      true,
    );
    expect(
      dropdown!.parentElement!.parentElement!.classList.contains(
        "foliplus-form-control",
      ),
    ).toBe(true);
  });

  it("returns null for an <img>-based icon (capability gate negative)", () => {
    const img = makeMarker({ type: "school" }, makeImgAuthor());
    const { ui: u6 } = fixtureWithMarkers([img]);
    expect(buildMarkerColorRow(u6, "overlay1")).toBeNull();
  });

  it("shows the author preset as the default value", () => {
    const row = buildMarkerColorRow(ui, "overlay1")!;
    const select = row.querySelector("select") as HTMLSelectElement;
    expect(select.value).toBe("blue");
  });

  it("shows the user's stored preset when one is set", () => {
    writeIntentKeys(ui, "overlay1", [[INTENT.MARKER_COLOR, "red"]]);
    const row = buildMarkerColorRow(ui, "overlay1")!;
    const select = row.querySelector("select") as HTMLSelectElement;
    expect(select.value).toBe("red");
  });

  it("commits a preset from the select change event", () => {
    const row = buildMarkerColorRow(ui, "overlay1")!;
    const select = row.querySelector("select") as HTMLSelectElement;
    select.value = "green";
    select.dispatchEvent(new Event("change", { bubbles: true }));
    expect(getIntent(ui, "overlay1", INTENT.MARKER_COLOR)).toBe("green");
  });

  it("offers every preset enum name as an option", () => {
    const row = buildMarkerColorRow(ui, "overlay1")!;
    const options = Array.from(row.querySelectorAll("option")).map(
      o => (o as HTMLOptionElement).value,
    );
    expect(options).toContain("red");
    expect(options).toContain("darkred");
    expect(options).toContain("black");
    expect(options.length).toBeGreaterThanOrEqual(19);
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
    commitMarkerColor(ui, "overlay1", "red");
    const intent = getIntent(ui, "overlay1", INTENT.MARKER_COLOR);
    expect(intent).toBe("red");
    flushMarkerColor("overlay1");
    expect(school.setIcon).toHaveBeenCalled();
    const written = school.options.icon;
    expect(written).not.toBe(authorIcon);
    // The derived icon carries the chassis in ONE construction with the glyph.
    const div = written.createIcon();
    expect(div.className).toContain("awesome-marker-icon-red");
    const inner = div.querySelector("i") as HTMLElement;
    expect(inner.className).toContain("foliplus-marker-glyph");
  });

  it("apply is a no-op without a marker-color intent", () => {
    applyMarkerColorToLayer(ui, "overlay1");
    expect(school.setIcon).not.toHaveBeenCalled();
    expect(school.options.icon).toBe(authorIcon);
  });

  it("merged construction: setting a glyph then a chassis keeps both", () => {
    writeIntentKeys(ui, "overlay1", [[INTENT.ICON, { kind: "glyph", value: "star" }]]);
    commitMarkerColor(ui, "overlay1", "green");
    flushMarkerColor("overlay1");
    const div = school.options.icon.createIcon();
    const inner = div.querySelector("i") as HTMLElement;
    // The glyph survived the chassis write (single construction merged both).
    expect(div.className).toContain("awesome-marker-icon-green");
    expect(inner.className).toContain("foliplus-marker-glyph");
    expect(inner.className).toContain("fa-star");
  });

  it("merged construction: a user icon color survives the chassis write", () => {
    writeIntentKeys(ui, "overlay1", [[INTENT.ICON_COLOR, "#ff0000"]]);
    commitMarkerColor(ui, "overlay1", "purple");
    flushMarkerColor("overlay1");
    const div = school.options.icon.createIcon();
    const inner = div.querySelector("i") as HTMLElement;
    expect(div.className).toContain("awesome-marker-icon-purple");
    expect(inner.style.color).toBe("rgb(255, 0, 0)");
  });

  it("reset restores the author chassis and drops the intent", () => {
    commitMarkerColor(ui, "overlay1", "red");
    flushMarkerColor("overlay1");
    expect(school.options.icon).not.toBe(authorIcon);
    resetLayerMarkerColor(ui, "overlay1");
    flushMarkerColor("overlay1");
    const div = school.options.icon.createIcon();
    expect(div.className).toContain("awesome-marker-icon-blue");
    expect(getIntent(ui, "overlay1", INTENT.MARKER_COLOR)).toBeUndefined();
  });

  it("reset preserves a user-set glyph (orthogonal)", () => {
    writeIntentKeys(ui, "overlay1", [
      [INTENT.ICON, { kind: "glyph", value: "star" }],
      [INTENT.MARKER_COLOR, "red"],
    ]);
    commitMarkerColor(ui, "overlay1", "red");
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
      [INTENT.MARKER_COLOR, "red"],
    ]);
    commitMarkerColor(ui, "overlay1", "red");
    flushMarkerColor("overlay1");
    resetLayerMarkerColor(ui, "overlay1");
    flushMarkerColor("overlay1");
    const div = school.options.icon.createIcon();
    const inner = div.querySelector("i") as HTMLElement;
    expect(div.className).toContain("awesome-marker-icon-blue");
    expect(inner.style.color).toBe("rgb(0, 255, 0)");
  });

  it("reset skips a missing layer without throwing", () => {
    expect(() => resetLayerMarkerColor(ui, "nope")).not.toThrow();
  });

  it("reset is a no-op when the layer left the map", () => {
    commitMarkerColor(ui, "overlay1", "red");
    flushMarkerColor("overlay1");
    vi.spyOn(ui.c, "findLayer").mockReturnValue(null as never);
    expect(() => resetLayerMarkerColor(ui, "overlay1")).not.toThrow();
    expect(getIntent(ui, "overlay1", INTENT.MARKER_COLOR)).toBeUndefined();
    vi.restoreAllMocks();
  });

  it("set Marker Color changes the chassis class only, NOT the glyph color", () => {
    // The marker color dimension must NOT touch the glyph paint. The derived
    // icon's outer div (chassis) carries the new preset sprite class while
    // the inner <i> (glyph) keeps the default white paint.
    commitMarkerColor(ui, "overlay1", "red");
    flushMarkerColor("overlay1");
    const div = school.options.icon.createIcon();
    const inner = div.querySelector("i") as HTMLElement;
    expect(div.className).toContain("awesome-marker-icon-red");
    // The glyph paint is the author's declared iconColor ("blue") — the
    // chassis change must NOT touch it.
    expect(inner.style.color).toBe("blue");
  });

  it("commit on a multi-leaf layer walks every marker in one construction", () => {
    const a = makeMarker({ type: "school" }, makeAuthorIcon({ markerColor: "blue" }));
    const b = makeMarker({ type: "hospital" }, makeAuthorIcon({ markerColor: "red" }));
    const { ui: uMulti, manager: mgr } = fixtureWithMarkers([a, b]);
    commitMarkerColor(uMulti, "overlay1", "green");
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
    // The dimension must declare its own face so it never fights the icon or
    // icon-color dimension over one coalescer slot (registry.test pins the
    // faces set).
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
  it("value returns the stored user preset, else undefined", () => {
    expect(MARKER_COLOR_DIMENSION.value(ui, "overlay1")).toBeUndefined();
    writeIntentKeys(ui, "overlay1", [[INTENT.MARKER_COLOR, "red"]]);
    expect(MARKER_COLOR_DIMENSION.value(ui, "overlay1")).toEqual({ value: "red" });
  });
  it("write stores the preset and schedules an apply", () => {
    MARKER_COLOR_DIMENSION.write!(ui, "overlay1", { value: "green" });
    expect(getIntent(ui, "overlay1", INTENT.MARKER_COLOR)).toBe("green");
    flushMarkerColor("overlay1");
    expect(school.setIcon).toHaveBeenCalled();
  });
  it("write ignores a non-string value", () => {
    MARKER_COLOR_DIMENSION.write!(ui, "overlay1", { value: undefined });
    expect(getIntent(ui, "overlay1", INTENT.MARKER_COLOR)).toBeUndefined();
  });
  it("reset clears the persisted preset", () => {
    writeIntentKeys(ui, "overlay1", [[INTENT.MARKER_COLOR, "red"]]);
    MARKER_COLOR_DIMENSION.reset!(ui, "overlay1");
    flushMarkerColor("overlay1");
    expect(getIntent(ui, "overlay1", INTENT.MARKER_COLOR)).toBeUndefined();
  });
  it("valueSource reports user after a write, author before", () => {
    expect(MARKER_COLOR_DIMENSION.valueSource!(ui, "overlay1")).toBe("author");
    writeIntentKeys(ui, "overlay1", [[INTENT.MARKER_COLOR, "red"]]);
    expect(MARKER_COLOR_DIMENSION.valueSource!(ui, "overlay1")).toBe("user");
  });
  it("contentChange when is true only once a marker-color intent exists", () => {
    const policy = MARKER_COLOR_DIMENSION.contentChange;
    if (policy.kind !== "frame") throw new Error("expected a frame policy");
    expect(policy.when!(ui, "overlay1")).toBe(false);
    writeIntentKeys(ui, "overlay1", [[INTENT.MARKER_COLOR, "red"]]);
    expect(policy.when!(ui, "overlay1")).toBe(true);
  });
  it("row builds the preset row for a capable carrier", () => {
    const row = MARKER_COLOR_DIMENSION.row(ui, "overlay1") as HTMLElement;
    expect(row.classList.contains(CONST.CLASSES.STYLE_MARKER_COLOR_ROW)).toBe(true);
  });
  it("contentChange run applies the stored preset", () => {
    writeIntentKeys(ui, "overlay1", [[INTENT.MARKER_COLOR, "purple"]]);
    const policy = MARKER_COLOR_DIMENSION.contentChange;
    if (policy.kind !== "frame") throw new Error("expected a frame policy");
    policy.run!(ui, "overlay1");
    flushMarkerColor("overlay1");
    expect(school.setIcon).toHaveBeenCalled();
    const div = school.options.icon.createIcon();
    expect(div.className).toContain("awesome-marker-icon-purple");
  });
  it("apply is a no-op when findLayer returns null", () => {
    writeIntentKeys(ui, "overlay1", [[INTENT.MARKER_COLOR, "red"]]);
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
