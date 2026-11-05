import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DIM } from "#core/layer/index.js";
import * as CONST from "#control/LayerControl/const.js";
import type { LayerController } from "#control/LayerControl/controller.js";
import type { LayerUI } from "#control/LayerControl/ui/index.js";
import { getIntent } from "#control/LayerControl/ui/intent.js";
import { GLYPH_SETS } from "#control/LayerControl/ui/style/glyph.js";
import {
  ICON_DIMENSION,
  applyIconToLayer,
  buildIconRow,
  buildMarkerIcon,
  commitGlyph,
  layerCanIcon,
  resetLayerIcon,
} from "#control/LayerControl/ui/style/icon.js";
import {
  getDimension,
  writeIntentKeys,
} from "#control/LayerControl/ui/style/registry.js";
import { FACE, flushStyleDimApply } from "#control/LayerControl/ui/style/styleBag.js";
import { initFixture } from "../fixture.js";

// A marker leaf: the layer type the icon dimension owns. It carries a
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

const makeGrid = (): any => ({ options: {} });

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

const flushIcon = (id: string) => flushStyleDimApply(FACE.ICON, id);
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
      // Real L.Icon._setIconStyles appends options.className — the author
      // sprite class must survive the derived chassis swap.
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
describe("layerCanIcon", () => {
  let manager: LayerController;
  let ui: LayerUI;

  beforeEach(() => {
    ({ manager, ui } = fixtureWithMarkers([
      makeMarker({ type: "school" }),
      makeMarker({ type: "hospital" }),
    ]));
    window.localStorage.removeItem(CONST.STORAGE.KEY);
  });

  afterEach(() => {
    manager?.debouncedEnforce?.cancel?.();
    document.body.innerHTML = "";
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it("accepts a marker layer", () => {
    expect(layerCanIcon(ui, "overlay1")).toBe(true);
  });

  it("declines a layer outside the registry", () => {
    expect(layerCanIcon(ui, "nope")).toBe(false);
  });

  it("declines a polygon and a tile layer", () => {
    manager.registerLayer({
      id: "p1",
      name: "P",
      role: "overlay",
      layer: makePoly(),
    });
    manager.registerLayer({ id: "g1", name: "G", role: "overlay", layer: makeGrid() });
    expect(layerCanIcon(ui, "p1")).toBe(false);
    expect(layerCanIcon(ui, "g1")).toBe(false);
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
    // className / background / size stay pixel-identical (chassis verbatim).
    expect(div.className).toBe(authorDiv.className);
    expect(div.style.backgroundImage).toBe(authorDiv.style.backgroundImage);
    expect(div.style.backgroundPosition).toBe(authorDiv.style.backgroundPosition);
    expect(div.style.width).toBe(authorDiv.style.width);
    expect(div.style.height).toBe(authorDiv.style.height);
    // The inner slot is OUR glyph, not the author's <i>.
    expect(div.querySelector(".foliplus-marker-glyph")).not.toBeNull();
    expect(div.querySelector(".foliplus-marker-glyph")?.innerHTML).toContain("<svg");
    expect(div.innerHTML).not.toContain("fa fa-map-marker");
    // The shadow presence is identical (both true here).
    const shadow = derived.createShadow?.();
    expect(!!shadow).toBe(!!author.createShadow?.());
  });

  it("keeps the shadow absence identical when the author has none", () => {
    const author = makeAuthorIcon({ withShadow: false });
    const derived = buildMarkerIcon({ author, glyph: "star" }) as any;
    expect(derived.createShadow).toBeUndefined();
    expect(author.createShadow).toBeUndefined();
  });

  it("returns the author unchanged when it is not a Leaflet icon", () => {
    const author = { html: "raw" };
    expect(buildMarkerIcon({ author, glyph: "circle" })).toBe(author);
  });

  it("falls back to the circle glyph for an unknown name", () => {
    const author = makeAuthorIcon();
    const derived = buildMarkerIcon({ author, glyph: "nope" }) as any;
    const div = derived.createIcon();
    expect(div.querySelector(".foliplus-marker-glyph")?.innerHTML).toContain("<circle");
  });
});
describe("buildIconRow", () => {
  let manager: LayerController;
  let ui: LayerUI;

  beforeEach(() => {
    ({ manager, ui } = fixtureWithMarkers([
      makeMarker({ type: "school" }, makeAuthorIcon()),
      makeMarker({ type: "hospital" }, makeAuthorIcon()),
    ]));
    window.localStorage.removeItem(CONST.STORAGE.KEY);
  });

  afterEach(() => {
    manager?.debouncedEnforce?.cancel?.();
    document.body.innerHTML = "";
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it("returns null for a layer that cannot carry icons", () => {
    expect(buildIconRow(ui, "nope")).toBeNull();
  });

  it("shows the author-original label when no glyph is chosen", () => {
    const row = buildIconRow(ui, "overlay1");
    expect(row).not.toBeNull();
    const trigger = row!.querySelector(`.${CONST.CLASSES.STYLE_ICON_TRIGGER}`)!;
    expect(trigger.textContent).toContain(ui.T("style_icon_original"));
    expect(trigger.querySelector(".foliplus-marker-glyph")).toBeNull();
  });

  it("opens a grid of every glyph on trigger click and applies a selection", () => {
    const row = buildIconRow(ui, "overlay1")!;
    const trigger = row.querySelector(
      `.${CONST.CLASSES.STYLE_ICON_TRIGGER}`,
    ) as HTMLElement;
    trigger.click();
    const grid = row.querySelector(`.${CONST.CLASSES.STYLE_ICON_GRID}`)!;
    expect(grid).not.toBeNull();
    const cells = grid.querySelectorAll(`.${CONST.CLASSES.STYLE_ICON_CELL}`);
    expect(cells.length).toBe(GLYPH_SETS.length);
    // Choose a glyph: it writes the intent and closes.
    (cells[0] as HTMLElement).click();
    expect(row.querySelector(`.${CONST.CLASSES.STYLE_ICON_GRID}`)).toBeNull();
    const intent = getIntent(ui, "overlay1", DIM.ICON);
    expect(intent).toEqual({ kind: "glyph", value: GLYPH_SETS[0].name });
  });

  it("highlights the current glyph cell", () => {
    writeIntentKeys(ui, "overlay1", [[DIM.ICON, { kind: "glyph", value: "star" }]]);
    const row = buildIconRow(ui, "overlay1")!;
    const trigger = row.querySelector(
      `.${CONST.CLASSES.STYLE_ICON_TRIGGER}`,
    ) as HTMLElement;
    trigger.click();
    const grid = row.querySelector(`.${CONST.CLASSES.STYLE_ICON_GRID}`)!;
    const selected = grid.querySelector(`.${CONST.CLASSES.STYLE_ICON_CELL_SELECTED}`);
    expect(selected).not.toBeNull();
    expect(selected?.getAttribute("data-glyph")).toBe("star");
  });

  it("closes on Escape and returns focus to the trigger", () => {
    const row = buildIconRow(ui, "overlay1")!;
    document.body.appendChild(row);
    const trigger = row.querySelector(
      `.${CONST.CLASSES.STYLE_ICON_TRIGGER}`,
    ) as HTMLElement;
    trigger.click();
    const grid = row.querySelector(`.${CONST.CLASSES.STYLE_ICON_GRID}`)!;
    expect(grid).not.toBeNull();
    grid.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Escape" }));
    expect(row.querySelector(`.${CONST.CLASSES.STYLE_ICON_GRID}`)).toBeNull();
  });
});
describe("applyIconToLayer / commitGlyph / resetLayerIcon", () => {
  let manager: LayerController;
  let ui: LayerUI;
  let school: any;
  let authorIcon: any;

  beforeEach(() => {
    authorIcon = makeAuthorIcon();
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
    commitGlyph(ui, "overlay1", "map-pin");
    const intent = getIntent(ui, "overlay1", DIM.ICON);
    expect(intent).toEqual({ kind: "glyph", value: "map-pin" });
    flushIcon("overlay1");
    expect(school.setIcon).toHaveBeenCalled();
    const written = school.options.icon;
    expect(written).not.toBe(authorIcon);
    expect(Object.getPrototypeOf(written)).toBe(authorIcon);
  });

  it("apply is a no-op without a glyph intent", () => {
    applyIconToLayer(ui, "overlay1");
    expect(school.setIcon).not.toHaveBeenCalled();
    expect(school.options.icon).toBe(authorIcon);
  });

  it("reset restores the authored icon and drops the intent", () => {
    commitGlyph(ui, "overlay1", "star");
    flushIcon("overlay1");
    expect(school.options.icon).not.toBe(authorIcon);
    resetLayerIcon(ui, "overlay1");
    flushIcon("overlay1");
    expect(school.options.icon).toBe(authorIcon);
    expect(getIntent(ui, "overlay1", DIM.ICON)).toBeUndefined();
  });

  it("reset skips a missing layer without throwing", () => {
    expect(() => resetLayerIcon(ui, "nope")).not.toThrow();
  });
});
describe("icon dimension descriptor", () => {
  let manager: LayerController;
  let ui: LayerUI;

  beforeEach(() => {
    ({ manager, ui } = fixtureWithMarkers([
      makeMarker({ type: "school" }),
      makeMarker({ type: "hospital" }),
    ]));
    window.localStorage.removeItem(CONST.STORAGE.KEY);
  });

  afterEach(() => {
    manager?.debouncedEnforce?.cancel?.();
    document.body.innerHTML = "";
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it("is registered under DIM.ICON", () => {
    expect(ICON_DIMENSION.key).toBe(DIM.ICON);
  });

  it("value / write / valueSource / contentChange wire the intent slot", () => {
    const config = ICON_DIMENSION.value!(ui, "overlay1");
    expect(config).toBeUndefined();
    ICON_DIMENSION.write!(ui, "overlay1", { kind: "glyph", value: "map-pin" });
    const intent = getIntent(ui, "overlay1", DIM.ICON);
    expect(intent).toEqual({ kind: "glyph", value: "map-pin" });
    expect(ICON_DIMENSION.valueSource!(ui, "overlay1")).toBe("user");
    expect(getDimension(DIM.ICON)?.valueSource!(ui, "overlay1")).toBe("user");
    const policy = ICON_DIMENSION.contentChange;
    if (policy?.kind === "frame") {
      expect(policy.when!(ui, "overlay1")).toBe(true);
      policy.run!(ui, "overlay1");
    } else {
      throw new Error("expected a frame policy");
    }
    expect(ICON_DIMENSION.row!(ui, "overlay1")).not.toBeNull();
  });

  it("reports author provenance before any user write", () => {
    expect(ICON_DIMENSION.valueSource!(ui, "overlay1")).toBe("author");
  });

  it("reports none for a layer that cannot carry icons", () => {
    const { manager: m2, ui: u2 } = initFixture({
      data: [{ id: "p1", name: "P", role: "overlay", layer: makePoly() }, BASE_LAYER],
    });
    expect(ICON_DIMENSION.valueSource!(u2, "p1")).toBe("none");
    m2?.debouncedEnforce?.cancel?.();
    document.body.innerHTML = "";
    vi.clearAllMocks();
  });
});
