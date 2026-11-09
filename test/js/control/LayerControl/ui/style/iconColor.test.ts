// control/LayerControl/ui/style/iconColor — the per-layer icon
// color dimension (awesome-markers `iconColor` face), orthogonal to the
// glyph. This file pins the DOM/panel-level contract: the gate's positive
// and negative carriers, the merged single-construction derive (color and
// glyph never split across two writes), Reset restoring the author paint
// without clearing a user glyph, and the persistence parser.
import { initFixture } from "../fixture.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as CONST from "#control/LayerControl/const.js";
import type { LayerController } from "#control/LayerControl/controller.js";
import type { LayerUI } from "#control/LayerControl/ui/index.js";
import { INTENT, getIntent } from "#control/LayerControl/ui/intent.js";
import { applyIconToLayer } from "#control/LayerControl/ui/style/icon.js";
import {
  ICON_COLOR_DIMENSION,
  applyIconColorToLayer,
  buildIconColorRow,
  commitIconColor,
  layerCanIconColor,
  resetLayerIconColor,
} from "#control/LayerControl/ui/style/iconColor.js";
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

// A marker leaf: the layer type the color dimension owns. It carries a
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

const flushIconColor = (id: string) => flushStyleDimApply(FACE.ICON_COLOR, id);

// A realistic awesome-markers author icon. Its `options` declares a
// `iconColor` face (the capability probe keys on this), and its
// `createIcon` returns an <i> with the author's inline color.
const makeAuthorIcon = (opts: { iconColor?: string; innerColor?: string } = {}) => {
  const author: any = {
    options: {
      iconColor: opts.iconColor ?? "blue",
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
        ? `<i class="fa fa-map-marker" style="color:${opts.innerColor}"></i>`
        : '<i class="fa fa-map-marker"></i>';
      return div;
    }),
    _setIconStyles: vi.fn((div: HTMLElement, name: string) => {
      div.className = `${name} awesome-marker`.trim();
    }),
    createShadow: vi.fn(() => {
      const sh = document.createElement("div");
      sh.className = "awesome-marker-shadow";
      return sh;
    }),
  };
  return author;
};

// A plain divIcon author: NO iconColor face. The capability probe must
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

// An <img>-based author (Icon.Default / iconUrl): the glyph capability probe
// must answer "none" — an <img> has no children, so no glyph can be inserted.
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

describe("layerCanIconColor", () => {
  let manager: LayerController;
  let ui: LayerUI;

  beforeEach(() => {
    ({ manager, ui } = fixtureWithMarkers([
      makeMarker({ type: "school" }, makeAuthorIcon({ iconColor: "blue" })),
    ]));
    window.localStorage.removeItem(CONST.STORAGE.KEY);
  });

  afterEach(() => {
    manager?.debouncedEnforce?.cancel?.();
    vi.useRealTimers();
  });

  it("accepts an awesome-markers carrier (iconColor face declared)", () => {
    expect(layerCanIconColor(ui, "overlay1")).toBe(true);
  });

  it("authorIconColor short-circuits after the first painted leaf", () => {
    const a = makeMarker({ type: "school" }, makeAuthorIcon({ iconColor: "#3366ff" }));
    const b = makeMarker({ type: "school" }, makeAuthorIcon({ iconColor: "#ff0000" }));
    const { ui: u2 } = fixtureWithMarkers([a, b]);
    const row = buildIconColorRow(u2, "overlay1")!;
    const input = row.querySelector("input[type=color]") as HTMLInputElement;
    expect(input.value).toBe("#3366ff");
  });

  it("accepts a plain divIcon carrier (div-based, glyph insertable)", () => {
    // Lead decision 1: a div-type icon (plain DivIcon / awesome-markers) can
    // hold a glyph node even if the author drew none — the probe is "native".
    const plain = makeMarker({ type: "school" }, makePlainDivIconAuthor());
    const { ui: u2 } = fixtureWithMarkers([plain]);
    expect(layerCanIconColor(u2, "overlay1")).toBe(true);
  });

  it("declines an <img>-based icon (Icon.Default / iconUrl)", () => {
    // The negative carrier: an <img> has no children, so no glyph node can
    // be inserted — the probe reads "none" and the row never renders.
    const img = makeMarker({ type: "school" }, makeImgAuthor());
    const { ui: u5 } = fixtureWithMarkers([img]);
    expect(layerCanIconColor(u5, "overlay1")).toBe(false);
  });

  it("declines a leaf with no icon at all", () => {
    const bare = makeMarker({ type: "school" });
    const { ui: u3 } = fixtureWithMarkers([bare]);
    expect(layerCanIconColor(u3, "overlay1")).toBe(false);
  });

  it("declines a non-marker layer (polygon)", () => {
    const layer = makeMarkerGroup(makePoly() as any);
    const { ui: u4 } = initFixture({
      data: [{ id: "overlay1", name: "CM", role: "overlay", layer }, BASE_LAYER],
    });
    expect(layerCanIconColor(u4, "overlay1")).toBe(false);
  });

  it("declines a layer not in the registry", () => {
    expect(layerCanIconColor(ui, "nope")).toBe(false);
  });

  it("authorIconColor walks past a layer that left the map", () => {
    vi.spyOn(ui.c, "findLayer").mockReturnValue(null as never);
    const row = buildIconColorRow(ui, "overlay1");
    expect(row).not.toBeNull();
    const input = row!.querySelector("input[type=color]") as HTMLInputElement;
    expect(input.value).toBe("#ffffff");
    vi.restoreAllMocks();
  });
});

describe("buildIconColorRow", () => {
  let manager: LayerController;
  let ui: LayerUI;

  beforeEach(() => {
    ({ manager, ui } = fixtureWithMarkers([
      makeMarker({ type: "school" }, makeAuthorIcon({ iconColor: "blue" })),
    ]));
    window.localStorage.removeItem(CONST.STORAGE.KEY);
  });

  afterEach(() => {
    manager?.debouncedEnforce?.cancel?.();
    document.body.innerHTML = "";
    vi.useRealTimers();
  });

  it("renders the row for an awesome-markers carrier", () => {
    const row = buildIconColorRow(ui, "overlay1");
    expect(row).not.toBeNull();
    expect(row!.classList.contains(CONST.CLASSES.STYLE_ICON_COLOR_ROW)).toBe(true);
    expect(row!.querySelector("input[type=color]")).not.toBeNull();
  });

  it("wraps the swatch in the shared inline flex shell", () => {
    const row = buildIconColorRow(ui, "overlay1")!;
    const input = row.querySelector("input[type=color]")!;
    expect(input.parentElement!.classList.contains("foliplus-form-inline")).toBe(true);
    expect(
      input.parentElement!.parentElement!.classList.contains("foliplus-form-control"),
    ).toBe(true);
  });

  it("returns null for an <img>-based icon (capability gate negative)", () => {
    const img = makeMarker({ type: "school" }, makeImgAuthor());
    const { ui: u6 } = fixtureWithMarkers([img]);
    expect(buildIconColorRow(u6, "overlay1")).toBeNull();
  });

  it("shows the author color as the default value", () => {
    // A hex author color survives the row's color-input normalisation.
    const hex = makeMarker(
      { type: "school" },
      makeAuthorIcon({ iconColor: "#3366ff" }),
    );
    const { ui: uHex } = fixtureWithMarkers([hex]);
    const row = buildIconColorRow(uHex, "overlay1")!;
    const input = row.querySelector("input[type=color]") as HTMLInputElement;
    expect(input.value).toBe("#3366ff");
  });

  it("shows the user's stored color when one is set", () => {
    writeIntentKeys(ui, "overlay1", [[INTENT.ICON_COLOR, "#ff0000"]]);
    const row = buildIconColorRow(ui, "overlay1")!;
    const input = row.querySelector("input[type=color]") as HTMLInputElement;
    expect(input.value).toBe("#ff0000");
  });
  it("commits a valid color from the swatch input event", () => {
    const row = buildIconColorRow(ui, "overlay1")!;
    const input = row.querySelector("input[type=color]") as HTMLInputElement;
    input.value = "#12abef";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    expect(getIntent(ui, "overlay1", INTENT.ICON_COLOR)).toBe("#12abef");
  });
  it("ignores an invalid hex from the swatch input event", () => {
    const row = buildIconColorRow(ui, "overlay1")!;
    const input = row.querySelector("input[type=color]") as HTMLInputElement;
    // A color input coerces any value to a valid hex (or #000000), so the
    // guard's invalid arm is only reachable when the input carries a
    // non-hex string — exercise it by switching the input to text so the
    // handler's /^#[0-9a-f]{6}$/ guard fires and the write is skipped.
    input.type = "text";
    input.value = "red";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    expect(getIntent(ui, "overlay1", INTENT.ICON_COLOR)).toBeUndefined();
  });
});

describe("applyIconColorToLayer / commitIconColor / resetLayerIconColor", () => {
  let manager: LayerController;
  let ui: LayerUI;
  let school: any;
  let authorIcon: any;

  beforeEach(() => {
    authorIcon = makeAuthorIcon({ iconColor: "blue" });
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
    commitIconColor(ui, "overlay1", "#00ff00");
    const intent = getIntent(ui, "overlay1", INTENT.ICON_COLOR);
    expect(intent).toBe("#00ff00");
    flushIconColor("overlay1");
    expect(school.setIcon).toHaveBeenCalled();
    const written = school.options.icon;
    expect(written).not.toBe(authorIcon);
    // The derived icon carries the color in ONE construction with the glyph.
    const div = written.createIcon();
    const inner = div.querySelector("i") as HTMLElement;
    expect(inner.style.color).toBe("rgb(0, 255, 0)");
    expect(inner.className).toContain("foliplus-marker-glyph");
  });

  it("apply is a no-op without a color intent", () => {
    applyIconColorToLayer(ui, "overlay1");
    expect(school.setIcon).not.toHaveBeenCalled();
    expect(school.options.icon).toBe(authorIcon);
  });

  it("merged construction: setting a glyph then a color keeps both", () => {
    // Simulate the glyph dimension having already written its intent.
    writeIntentKeys(ui, "overlay1", [[INTENT.ICON, { kind: "glyph", value: "star" }]]);
    commitIconColor(ui, "overlay1", "#ff0000");
    flushIconColor("overlay1");
    const div = school.options.icon.createIcon();
    const inner = div.querySelector("i") as HTMLElement;
    // The glyph survived the color write (single construction merged both).
    expect(inner.className).toContain("foliplus-marker-glyph");
    expect(inner.className).toContain("fa-star");
    expect(inner.style.color).toBe("rgb(255, 0, 0)");
  });

  it("merged construction: setting a color then a glyph keeps both", () => {
    commitIconColor(ui, "overlay1", "#00ff00");
    flushIconColor("overlay1");
    // Now the glyph dimension writes its intent and applies (applyIconToLayer
    // merges the current color into the same derived construction).
    writeIntentKeys(ui, "overlay1", [[INTENT.ICON, { kind: "glyph", value: "star" }]]);
    applyIconToLayer(ui, "overlay1");
    flushStyleDimApply(FACE.ICON, "overlay1");
    const div = school.options.icon.createIcon();
    const inner = div.querySelector("i") as HTMLElement;
    // The color survived the glyph write.
    expect(inner.className).toContain("fa-star");
    expect(inner.style.color).toBe("rgb(0, 255, 0)");
  });

  it("reset restores the author paint and drops the intent", () => {
    commitIconColor(ui, "overlay1", "#ff0000");
    flushIconColor("overlay1");
    expect(school.options.icon).not.toBe(authorIcon);
    resetLayerIconColor(ui, "overlay1");
    flushIconColor("overlay1");
    const div = school.options.icon.createIcon();
    const inner = div.querySelector("i") as HTMLElement;
    // Reset restored the author paint: the author declares iconColor "blue",
    // so the derived icon paints blue (white is only the no-author-color
    // fallback). The glyph is re-derived in the SAME construction.
    expect(inner.style.color).toBe("blue");
    expect(getIntent(ui, "overlay1", INTENT.ICON_COLOR)).toBeUndefined();
  });

  it("reset preserves a user-set glyph (orthogonal)", () => {
    // User set both a glyph and a color.
    writeIntentKeys(ui, "overlay1", [
      [INTENT.ICON, { kind: "glyph", value: "star" }],
      [INTENT.ICON_COLOR, "#ff0000"],
    ]);
    commitIconColor(ui, "overlay1", "#ff0000");
    flushIconColor("overlay1");
    // Reset the color only — the glyph must survive.
    resetLayerIconColor(ui, "overlay1");
    flushIconColor("overlay1");
    const div = school.options.icon.createIcon();
    const inner = div.querySelector("i") as HTMLElement;
    expect(inner.className).toContain("foliplus-marker-glyph");
    expect(inner.className).toContain("fa-star");
  });

  it("reset skips a missing layer without throwing", () => {
    expect(() => resetLayerIconColor(ui, "nope")).not.toThrow();
  });

  it("reset is a no-op when the layer left the map", () => {
    commitIconColor(ui, "overlay1", "#ff0000");
    flushIconColor("overlay1");
    vi.spyOn(ui.c, "findLayer").mockReturnValue(null as never);
    expect(() => resetLayerIconColor(ui, "overlay1")).not.toThrow();
    expect(getIntent(ui, "overlay1", INTENT.ICON_COLOR)).toBeUndefined();
    vi.restoreAllMocks();
  });

  it("reset with no author paint re-applies the user glyph", () => {
    // An author that declares no iconColor (empty = no paint): reset must
    // restore the author icon and re-apply the current user glyph so the
    // glyph survives (the no-author-paint branch).
    const noPaint = makeMarker({ type: "school" }, makeAuthorIcon({ iconColor: "" }));
    const { ui: uNoPaint, manager: mgr } = fixtureWithMarkers([noPaint]);
    writeIntentKeys(uNoPaint, "overlay1", [
      [INTENT.ICON, { kind: "glyph", value: "star" }],
    ]);
    commitIconColor(uNoPaint, "overlay1", "#ff0000");
    flushIconColor("overlay1");
    resetLayerIconColor(uNoPaint, "overlay1");
    flushIconColor("overlay1");
    const div = noPaint.options.icon.createIcon();
    const inner = div.querySelector("i") as HTMLElement;
    expect(inner.className).toContain("fa-star");
    mgr?.debouncedEnforce?.cancel?.();
    document.body.innerHTML = "";
    vi.clearAllMocks();
    vi.useRealTimers();
  });
  it("reset with no author paint and no user glyph restores the author icon", () => {
    const noPaint = makeMarker({ type: "school" }, makeAuthorIcon({ iconColor: "" }));
    const { ui: uNoPaint, manager: mgr } = fixtureWithMarkers([noPaint]);
    const authorBefore = noPaint.options.icon;
    commitIconColor(uNoPaint, "overlay1", "#ff0000");
    flushIconColor("overlay1");
    expect(noPaint.options.icon).not.toBe(authorBefore);
    resetLayerIconColor(uNoPaint, "overlay1");
    flushIconColor("overlay1");
    expect(noPaint.options.icon).toBe(authorBefore);
    mgr?.debouncedEnforce?.cancel?.();
    document.body.innerHTML = "";
    vi.clearAllMocks();
    vi.useRealTimers();
  });
  it("set Icon Color changes the glyph color only, NOT the chassis", () => {
    // Lead decision 3: the icon color dimension must NOT touch the pin chassis.
    // The derived icon's outer div (chassis) keeps the author's paint
    // (className, backgroundImage, backgroundPosition, size, anchor),
    // while the inner <i> (glyph) carries the new color.
    const authorDiv = authorIcon.createIcon();
    const before = {
      className: authorDiv.className,
      backgroundImage: authorDiv.style.backgroundImage,
      backgroundPosition: authorDiv.style.backgroundPosition,
      width: authorDiv.style.width,
      height: authorDiv.style.height,
    };
    commitIconColor(ui, "overlay1", "#00ff00");
    flushIconColor("overlay1");
    const div = school.options.icon.createIcon();
    const inner = div.querySelector("i") as HTMLElement;
    // Chassis unchanged.
    expect(div.className).toBe(before.className);
    expect(div.style.backgroundImage).toBe(before.backgroundImage);
    expect(div.style.backgroundPosition).toBe(before.backgroundPosition);
    expect(div.style.width).toBe(before.width);
    expect(div.style.height).toBe(before.height);
    // Glyph changed.
    expect(inner.style.color).toBe("rgb(0, 255, 0)");
  });
});

describe("iconColor dimension — surface integration", () => {
  it("registers the dimension with the iconColor face", () => {
    // The dimension must declare its own face so it never fights the icon
    // dimension over one coalescer slot (registry.test pins the faces set).
    expect(ICON_COLOR_DIMENSION).toBeDefined();
    expect(ICON_COLOR_DIMENSION.contentChange).toMatchObject({
      kind: "frame",
      face: FACE.ICON_COLOR,
    });
  });
});
describe("iconColor dimension descriptor", () => {
  let manager: LayerController;
  let ui: LayerUI;
  let school: any;
  beforeEach(() => {
    school = makeMarker({ type: "school" }, makeAuthorIcon({ iconColor: "blue" }));
    ({ manager, ui } = fixtureWithMarkers([school]));
    window.localStorage.removeItem(CONST.STORAGE.KEY);
  });
  afterEach(() => {
    manager?.debouncedEnforce?.cancel?.();
    document.body.innerHTML = "";
    vi.clearAllMocks();
    vi.useRealTimers();
  });
  it("value returns the stored user color, else undefined", () => {
    expect(ICON_COLOR_DIMENSION.value(ui, "overlay1")).toBeUndefined();
    writeIntentKeys(ui, "overlay1", [[INTENT.ICON_COLOR, "#ff0000"]]);
    expect(ICON_COLOR_DIMENSION.value(ui, "overlay1")).toEqual({ value: "#ff0000" });
  });
  it("write stores the color and schedules an apply", () => {
    ICON_COLOR_DIMENSION.write!(ui, "overlay1", { value: "#00ff00" });
    expect(getIntent(ui, "overlay1", INTENT.ICON_COLOR)).toBe("#00ff00");
    flushIconColor("overlay1");
    expect(school.setIcon).toHaveBeenCalled();
  });
  it("write ignores a non-string value", () => {
    ICON_COLOR_DIMENSION.write!(ui, "overlay1", { value: undefined });
    expect(getIntent(ui, "overlay1", INTENT.ICON_COLOR)).toBeUndefined();
  });
  it("reset clears the persisted color", () => {
    writeIntentKeys(ui, "overlay1", [[INTENT.ICON_COLOR, "#ff0000"]]);
    ICON_COLOR_DIMENSION.reset!(ui, "overlay1");
    flushIconColor("overlay1");
    expect(getIntent(ui, "overlay1", INTENT.ICON_COLOR)).toBeUndefined();
  });
  it("valueSource reports user after a write, author before", () => {
    expect(ICON_COLOR_DIMENSION.valueSource!(ui, "overlay1")).toBe("author");
    writeIntentKeys(ui, "overlay1", [[INTENT.ICON_COLOR, "#ff0000"]]);
    expect(ICON_COLOR_DIMENSION.valueSource!(ui, "overlay1")).toBe("user");
  });
  it("contentChange when is true only once a color intent exists", () => {
    const policy = ICON_COLOR_DIMENSION.contentChange;
    if (policy.kind !== "frame") throw new Error("expected a frame policy");
    expect(policy.when!(ui, "overlay1")).toBe(false);
    writeIntentKeys(ui, "overlay1", [[INTENT.ICON_COLOR, "#ff0000"]]);
    expect(policy.when!(ui, "overlay1")).toBe(true);
  });
  it("row builds the swatch row for a capable carrier", () => {
    const row = ICON_COLOR_DIMENSION.row(ui, "overlay1") as HTMLElement;
    expect(row.classList.contains(CONST.CLASSES.STYLE_ICON_COLOR_ROW)).toBe(true);
  });
  it("contentChange run applies the stored color", () => {
    writeIntentKeys(ui, "overlay1", [[INTENT.ICON_COLOR, "#00ff00"]]);
    const policy = ICON_COLOR_DIMENSION.contentChange;
    if (policy.kind !== "frame") throw new Error("expected a frame policy");
    policy.run!(ui, "overlay1");
    flushIconColor("overlay1");
    expect(school.setIcon).toHaveBeenCalled();
    const div = school.options.icon.createIcon();
    const inner = div.querySelector("i") as HTMLElement;
    expect(inner.style.color).toBe("rgb(0, 255, 0)");
  });
  it("apply is a no-op when findLayer returns null", () => {
    writeIntentKeys(ui, "overlay1", [[INTENT.ICON_COLOR, "#ff0000"]]);
    vi.spyOn(ui.c, "findLayer").mockReturnValue(null as never);
    applyIconColorToLayer(ui, "overlay1");
    expect(school.setIcon).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });
  it("valueSource reports none for an incapable carrier", () => {
    const img = makeMarker({ type: "school" }, makeImgAuthor());
    const { ui: uImg } = fixtureWithMarkers([img]);
    expect(ICON_COLOR_DIMENSION.valueSource!(uImg, "overlay1")).toBe("none");
  });
  it("row falls back to #ffffff when neither the user nor author paints", () => {
    const noPaint = makeMarker({ type: "school" }, makeAuthorIcon({ iconColor: "" }));
    const { ui: uNoPaint } = fixtureWithMarkers([noPaint]);
    const row = buildIconColorRow(uNoPaint, "overlay1")!;
    const input = row.querySelector("input[type=color]") as HTMLInputElement;
    expect(input.value).toBe("#ffffff");
  });
  it("commit on a multi-leaf layer walks every marker in one construction", () => {
    const a = makeMarker({ type: "school" }, makeAuthorIcon({ iconColor: "blue" }));
    const b = makeMarker({ type: "hospital" }, makeAuthorIcon({ iconColor: "red" }));
    const { ui: uMulti, manager: mgr } = fixtureWithMarkers([a, b]);
    commitIconColor(uMulti, "overlay1", "#00ff00");
    flushIconColor("overlay1");
    expect(a.setIcon).toHaveBeenCalled();
    expect(b.setIcon).toHaveBeenCalled();
    mgr?.debouncedEnforce?.cancel?.();
    document.body.innerHTML = "";
    vi.clearAllMocks();
    vi.useRealTimers();
  });
});
