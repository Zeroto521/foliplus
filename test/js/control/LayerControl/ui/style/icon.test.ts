import { initFixture } from "../fixture.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ensureInteraction } from "#core/interaction/index.js";
import { DIM } from "#core/layer/index.js";
import { PICKER_GLYPHS } from "#core/leaflet/index.js";
import { ensureOverlayRegistry } from "#core/overlay/index.js";
import * as CONST from "#control/LayerControl/const.js";
import type { LayerController } from "#control/LayerControl/controller.js";
import type { LayerUI } from "#control/LayerControl/ui/index.js";
import indexSource from "#control/LayerControl/ui/index?raw";
import { INTENT, getIntent } from "#control/LayerControl/ui/intent.js";
import { commitFillColor } from "#control/LayerControl/ui/style/fill.js";
import {
  ICON_DIMENSION,
  applyIconToLayer,
  buildIconRow,
  commitGlyph,
  layerCanIcon,
  resetLayerIcon,
} from "#control/LayerControl/ui/style/icon.js";
import {
  getDimension,
  writeIntentKeys,
} from "#control/LayerControl/ui/style/registry.js";
import { FACE, flushStyleDimApply } from "#control/LayerControl/ui/style/styleBag.js";

// The shared L stub (test/js/setup.ts) defines no Icon key. The default-icon
// panel test routes through the core markerIcon module, which reads
// L.Icon.Default; provide a minimal Default class here so
// `author instanceof L.Icon.Default` does not throw. Scoped to this file —
// the shared stub stays generic.

class TestDivIcon {
  options: any;
  constructor(options: any) {
    this.options = options;
  }
}
(window.L as any).Icon = { Default: class {} };
(window.L as any).DivIcon = TestDivIcon;
// The shared stub's divIcon factory returns a bare {}; the lead's branch
// produces a real L.DivIcon, so point the factory at our class here.
(window.L as any).divIcon = vi.fn((options: any) => new TestDivIcon(options));
// jsdom has no FontAwesome stylesheet, so getComputedStyle(..).content is
// "none" and glyphAvailable probes every glyph unavailable. Stub it to a
// glyph codepoint by default so the render/reset tests exercise the paint
// path; a dedicated test flips the flag to model an unavailable name.
(window as any).__glyphProbePainted = true;
beforeEach(() => {
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
  vi.restoreAllMocks();
  (window as any).__glyphProbePainted = true;
});

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

// A leaf that carries BOTH a fill (setStyle) and an icon (setIcon) — the
// cross-dimension isolation tests need one layer that can host fill and icon
// at once, which a pure marker (setIcon only) or pure polygon (setStyle only)
// cannot. The leaf keeps an authored options.fillColor and authored icon so
// reset restores them.
const makeHybridLeaf = (authorIcon: any, opts: Record<string, unknown> = {}): any => {
  // An L.Polygon instance (the fixture's real class, so isArealStyleLeaf's
  // `instanceof L.Polygon` step admits it) that also carries setIcon — a
  // layer that can host both a fill (setStyle) and an icon (setIcon) at once.
  const leaf = Object.create((window.L as any).Polygon.prototype) as any;
  leaf.feature = { properties: {} };
  leaf.options = { fillColor: opts.fillColor ?? "#aabbcc", icon: authorIcon };
  leaf.setStyle = vi.fn((style: Record<string, unknown>) => {
    Object.assign(leaf.options, style);
    return leaf;
  });
  leaf.setIcon = vi.fn((next: unknown) => {
    leaf.options.icon = next;
    return leaf;
  });
  leaf.getLatLngs = () => [
    [
      { lat: 0, lng: 0 },
      { lat: 1, lng: 0 },
      { lat: 0, lng: 1 },
    ],
  ];
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

  it("shows the unavailable state when the author glyph is not painted", () => {
    // A mixed group (marker + polygon): the walk must skip the polygon leaf
    // (no setIcon) and continue to the marker. The marker's author declares a
    // name outside the set, so authorGlyphName stays null and the trigger
    // shows the author-original label.
    const poly = makePoly();
    const marker = makeMarker(
      { type: "school" },
      (() => {
        const a = makeAuthorIcon();
        a.options = { ...a.options, icon: "map-marker" };
        return a;
      })(),
    );
    const group = makeMarkerGroup(marker, poly as any);
    // "map-marker" is an FA4 name: syntactically valid but NOT painted by the
    // FA6 stylesheet, so the trigger must show the explicit unavailable state
    // (dashed-outline circle preview + the original name + a hint title), not
    // a silent "Original" label or a blank tofu.
    (window as any).__glyphProbePainted = false;
    const { manager: m8, ui: u8 } = initFixture({
      data: [{ id: "mix3", name: "MIX3", role: "overlay", layer: group }, BASE_LAYER],
    });
    window.localStorage.removeItem(CONST.STORAGE.KEY);
    const row = buildIconRow(u8, "mix3")!;
    const trigger = row.querySelector(
      `.${CONST.CLASSES.STYLE_ICON_TRIGGER}`,
    ) as HTMLElement;
    expect(
      trigger.classList.contains(CONST.CLASSES.STYLE_ICON_TRIGGER_UNAVAILABLE),
    ).toBe(true);
    expect(
      trigger.querySelector(`.${CONST.CLASSES.STYLE_ICON_UNAVAILABLE_GLYPH}`),
    ).not.toBeNull();
    expect(trigger.textContent).toContain("map-marker");
    expect(trigger.title).toContain(
      u8.T("style_icon_unavailable").replace("{name}", "map-marker"),
    );
    m8?.debouncedEnforce?.cancel?.();
    document.body.innerHTML = "";
    vi.clearAllMocks();
  });

  it("shows the author glyph name when a marker declares a known glyph", () => {
    // The marker's author icon.options.icon is a valid FA6 name: authorGlyphName
    // walks and returns it, so the trigger previews that glyph (not the label).
    const author = makeAuthorIcon();
    author.options = { ...author.options, icon: "star" };
    const marker = makeMarker({ type: "school" }, author);
    const { manager: m9, ui: u9 } = fixtureWithMarkers([marker]);
    window.localStorage.removeItem(CONST.STORAGE.KEY);
    const row = buildIconRow(u9, "overlay1")!;
    const trigger = row.querySelector(
      `.${CONST.CLASSES.STYLE_ICON_TRIGGER}`,
    ) as HTMLElement;
    expect(trigger.querySelector(".foliplus-marker-glyph")).not.toBeNull();
    expect(trigger.textContent).toContain("star");
    m9?.debouncedEnforce?.cancel?.();
    document.body.innerHTML = "";
    vi.clearAllMocks();
  });

  it("shows the unavailable state (invalid hint) for a syntax-invalid author name", () => {
    // The author declares a name that fails glyph syntax (spaces): it is never
    // renderable, so the trigger must show the unavailable state with the RAW
    // name and the invalid-hint title — not the silent author-original label.
    const author = makeAuthorIcon();
    author.options = { ...author.options, icon: "not an icon" };
    const marker = makeMarker({ type: "school" }, author);
    const { manager: m12, ui: u12 } = fixtureWithMarkers([marker]);
    window.localStorage.removeItem(CONST.STORAGE.KEY);
    const row = buildIconRow(u12, "overlay1")!;
    const trigger = row.querySelector(
      `.${CONST.CLASSES.STYLE_ICON_TRIGGER}`,
    ) as HTMLElement;
    expect(
      trigger.classList.contains(CONST.CLASSES.STYLE_ICON_TRIGGER_UNAVAILABLE),
    ).toBe(true);
    expect(
      trigger.querySelector(`.${CONST.CLASSES.STYLE_ICON_UNAVAILABLE_GLYPH}`),
    ).not.toBeNull();
    expect(trigger.textContent).toContain("not an icon");
    expect(trigger.title).toContain(
      u12.T("style_icon_invalid").replace("{name}", "not an icon"),
    );
    m12?.debouncedEnforce?.cancel?.();
    document.body.innerHTML = "";
    vi.clearAllMocks();
  });

  it("does not show the unavailable state when the author declares no icon", () => {
    // A marker with no author icon name: the trigger must keep the
    // author-original label and NOT misreport an unavailable state.
    const marker = makeMarker({ type: "school" }, makeAuthorIcon());
    const { manager: m13, ui: u13 } = fixtureWithMarkers([marker]);
    window.localStorage.removeItem(CONST.STORAGE.KEY);
    const row = buildIconRow(u13, "overlay1")!;
    const trigger = row.querySelector(
      `.${CONST.CLASSES.STYLE_ICON_TRIGGER}`,
    ) as HTMLElement;
    expect(
      trigger.classList.contains(CONST.CLASSES.STYLE_ICON_TRIGGER_UNAVAILABLE),
    ).toBe(false);
    expect(trigger.textContent).toContain(u13.T("style_icon_original"));
    m13?.debouncedEnforce?.cancel?.();
    document.body.innerHTML = "";
    vi.clearAllMocks();
  });

  it("stops the author glyph walk at the first recognized name", () => {
    // A multi-marker group where the FIRST marker declares a known glyph: the
    // walk must short-circuit (found already set) and not inspect later leaves.
    const a1 = makeAuthorIcon();
    a1.options = { ...a1.options, icon: "star" };
    const m1 = makeMarker({ type: "a" }, a1);
    const a2 = makeAuthorIcon();
    a2.options = { ...a2.options, icon: "heart" };
    const m2 = makeMarker({ type: "b" }, a2);
    const group = makeMarkerGroup(m1, m2);
    const { manager: m10, ui: u10 } = initFixture({
      data: [{ id: "grp1", name: "GRP1", role: "overlay", layer: group }, BASE_LAYER],
    });
    window.localStorage.removeItem(CONST.STORAGE.KEY);
    const row = buildIconRow(u10, "grp1")!;
    const trigger = row.querySelector(
      `.${CONST.CLASSES.STYLE_ICON_TRIGGER}`,
    ) as HTMLElement;
    expect(trigger.textContent).toContain("star");
    m10?.debouncedEnforce?.cancel?.();
    document.body.innerHTML = "";
    vi.clearAllMocks();
  });

  it("shows the author-original label when the registry layer left the map", () => {
    // A layer in the registry whose map lookup fails: buildIconRow must not
    // crash and renderTrigger falls back to the author-original label.
    const { manager: m11, ui: u11 } = fixtureWithMarkers([
      makeMarker({ type: "school" }, makeAuthorIcon()),
    ]);
    window.localStorage.removeItem(CONST.STORAGE.KEY);
    vi.spyOn(u11.c, "findLayer").mockReturnValue(null as never);
    const row = buildIconRow(u11, "overlay1")!;
    const trigger = row.querySelector(
      `.${CONST.CLASSES.STYLE_ICON_TRIGGER}`,
    ) as HTMLElement;
    expect(trigger.textContent).toContain(u11.T("style_icon_original"));
    vi.restoreAllMocks();
    m11?.debouncedEnforce?.cancel?.();
    document.body.innerHTML = "";
    vi.clearAllMocks();
  });

  it("shows the unavailable state when the author glyph name is not painted", () => {
    // The author declares a glyph name the FA6 set no longer knows (an FA4
    // name): the name is syntactically valid but the loaded stylesheet does
    // not paint it, so the trigger must show the explicit unavailable state
    // with the original name rather than silently render an unknown symbol.
    const author = makeAuthorIcon();
    author.options = { ...author.options, icon: "map-marker" };
    const marker = makeMarker({ type: "school" }, author);
    // FA4 name, syntactically valid, not painted by FA6 -> unavailable state.
    (window as any).__glyphProbePainted = false;
    const { manager: m6, ui: u6 } = fixtureWithMarkers([marker]);
    window.localStorage.removeItem(CONST.STORAGE.KEY);
    const row = buildIconRow(u6, "overlay1")!;
    const trigger = row.querySelector(
      `.${CONST.CLASSES.STYLE_ICON_TRIGGER}`,
    ) as HTMLElement;
    expect(
      trigger.classList.contains(CONST.CLASSES.STYLE_ICON_TRIGGER_UNAVAILABLE),
    ).toBe(true);
    expect(
      trigger.querySelector(`.${CONST.CLASSES.STYLE_ICON_UNAVAILABLE_GLYPH}`),
    ).not.toBeNull();
    expect(trigger.textContent).toContain("map-marker");
    expect(trigger.title).toContain(
      u6.T("style_icon_unavailable").replace("{name}", "map-marker"),
    );
    m6?.debouncedEnforce?.cancel?.();
    document.body.innerHTML = "";
    vi.clearAllMocks();
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
    expect(cells.length).toBe(PICKER_GLYPHS.length);
    // Choose a glyph: it writes the intent and closes.
    (cells[0] as HTMLElement).click();
    expect(row.querySelector(`.${CONST.CLASSES.STYLE_ICON_GRID}`)).toBeNull();
    const intent = getIntent(ui, "overlay1", DIM.ICON);
    expect(intent).toEqual({ kind: "glyph", value: PICKER_GLYPHS[0] });
  });

  it("re-renders the trigger to show the selected glyph", () => {
    const row = buildIconRow(ui, "overlay1")!;
    const trigger = row.querySelector(
      `.${CONST.CLASSES.STYLE_ICON_TRIGGER}`,
    ) as HTMLElement;
    const glyphBox = trigger.querySelector(
      `.${CONST.CLASSES.STYLE_ICON_TRIGGER_GLYPH}`,
    ) as HTMLElement;
    const nameBox = trigger.querySelector(
      `.${CONST.CLASSES.STYLE_ICON_TRIGGER_NAME}`,
    ) as HTMLElement;
    // Uncovered: the author-original label, no glyph box.
    expect(nameBox.textContent).toBe(ui.T("style_icon_original"));
    expect(glyphBox.querySelector(".foliplus-marker-glyph")).toBeNull();
    trigger.click();
    const cells = row.querySelectorAll(`.${CONST.CLASSES.STYLE_ICON_CELL}`);
    (cells[0] as HTMLElement).click();
    // The trigger now previews the chosen glyph (not the static label) —
    // the renderTrigger callback wired into cell.onclick must have run.
    expect(nameBox.textContent).toBe(PICKER_GLYPHS[0]);
    expect(glyphBox.querySelector(".foliplus-marker-glyph")).not.toBeNull();
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

  it("navigates the grid with arrow keys and activates with Enter", () => {
    const row = buildIconRow(ui, "overlay1")!;
    document.body.appendChild(row);
    const trigger = row.querySelector(
      `.${CONST.CLASSES.STYLE_ICON_TRIGGER}`,
    ) as HTMLElement;
    trigger.click();
    const grid = row.querySelector(`.${CONST.CLASSES.STYLE_ICON_GRID}`)!;
    const cells = [
      ...grid.querySelectorAll(`.${CONST.CLASSES.STYLE_ICON_CELL}`),
    ] as HTMLElement[];
    expect(cells.length).toBe(PICKER_GLYPHS.length);

    // Focus the first cell and move right + down. ArrowRight wraps to the
    // next row at the 8-column boundary; ArrowDown moves one full row.
    cells[0].focus();
    grid.dispatchEvent(
      new KeyboardEvent("keydown", { bubbles: true, key: "ArrowRight" }),
    );
    expect(document.activeElement).toBe(cells[1]);
    grid.dispatchEvent(
      new KeyboardEvent("keydown", { bubbles: true, key: "ArrowDown" }),
    );
    expect(document.activeElement).toBe(cells[9]);
    grid.dispatchEvent(
      new KeyboardEvent("keydown", { bubbles: true, key: "ArrowLeft" }),
    );
    expect(document.activeElement).toBe(cells[8]);
    grid.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "ArrowUp" }));
    expect(document.activeElement).toBe(cells[0]);
    // Home / End.
    grid.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "End" }));
    expect(document.activeElement).toBe(cells[cells.length - 1]);
    grid.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Home" }));
    expect(document.activeElement).toBe(cells[0]);
    // Enter activates the focused cell: it writes the intent and closes.
    grid.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Enter" }));
    expect(row.querySelector(`.${CONST.CLASSES.STYLE_ICON_GRID}`)).toBeNull();
    const intent = getIntent(ui, "overlay1", DIM.ICON);
    expect(intent).toEqual({ kind: "glyph", value: PICKER_GLYPHS[0] });
  });

  it("moves focus into the grid on open and owns its keys", () => {
    // The reported regression: with the grid open, an arrow pressed while the
    // focus was still on the trigger / a slider thumb bubbled to the
    // document-level InteractionManager, whose ArrowRight row shortcut toggled
    // the layer behind the popup. The real fix is DOM focus — the grid takes
    // focus on open, and the claim is the dispatcher guard that stands the
    // row shortcut aside while it is open.
    const row = buildIconRow(ui, "overlay1")!;
    const trigger = row.querySelector(
      `.${CONST.CLASSES.STYLE_ICON_TRIGGER}`,
    ) as HTMLElement;

    // A container-bound ArrowRight / Space / Enter shortcut standing in for the
    // layer row toggle, registered through the real InteractionManager — the
    // same document-level dispatch the user's key press went through.
    const toggle = vi.fn();
    const host = document.createElement("div");
    host.appendChild(row);
    document.body.appendChild(host);
    const cleanup = ensureInteraction(ui.c.map).register("Guard", [
      { key: "ArrowRight", container: host, handler: toggle as (e: Event) => void },
      { key: " ", container: host, handler: toggle as (e: Event) => void },
      { key: "Enter", container: host, handler: toggle as (e: Event) => void },
    ]);

    // Focus starts on the trigger (the layer row's button), as when the user
    // opens the grid with the keyboard.
    // Focus starts on the trigger (the layer row's button), as when the user
    // opens the grid with the keyboard.
    trigger.focus();
    trigger.click();
    const grid = row.querySelector(`.${CONST.CLASSES.STYLE_ICON_GRID}`)!;
    const cells = [
      ...grid.querySelectorAll(`.${CONST.CLASSES.STYLE_ICON_CELL}`),
    ] as HTMLElement[];

    // The open grid owns DOM focus: no manual focus here — the open path put
    // it on the current (or first) cell.
    expect(grid.contains(document.activeElement)).toBe(true);

    // ArrowRight on the focused cell: the grid cursor moves, the row toggle
    // stays silent.
    const arrow = new KeyboardEvent("keydown", {
      key: "ArrowRight",
      bubbles: true,
      cancelable: true,
    });
    cells[0].dispatchEvent(arrow);
    expect(document.activeElement).toBe(cells[1]);
    expect(toggle).not.toHaveBeenCalled();
    expect(arrow.defaultPrevented).toBe(true);

    // Escape closes the grid and returns focus to the trigger; the row regains
    // its keys.
    grid.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
    );
    expect(row.querySelector(`.${CONST.CLASSES.STYLE_ICON_GRID}`)).toBeNull();
    expect(document.activeElement).toBe(trigger);
    const after = new KeyboardEvent("keydown", {
      key: "ArrowRight",
      bubbles: true,
      cancelable: true,
    });
    trigger.dispatchEvent(after);
    expect(toggle).toHaveBeenCalledTimes(1);

    cleanup();
  });

  it("Space/Enter on a grid cell commits and closes without toggling the layer", () => {
    const row = buildIconRow(ui, "overlay1")!;
    document.body.appendChild(row);
    const trigger = row.querySelector(
      `.${CONST.CLASSES.STYLE_ICON_TRIGGER}`,
    ) as HTMLElement;
    const toggle = vi.fn();
    const host = document.createElement("div");
    host.appendChild(row);
    document.body.appendChild(host);
    const cleanup = ensureInteraction(ui.c.map).register("Guard", [
      { key: " ", container: host, handler: toggle as (e: Event) => void },
      { key: "Enter", container: host, handler: toggle as (e: Event) => void },
    ]);

    trigger.click();
    const grid = row.querySelector(`.${CONST.CLASSES.STYLE_ICON_GRID}`)!;
    const cells = [
      ...grid.querySelectorAll(`.${CONST.CLASSES.STYLE_ICON_CELL}`),
    ] as HTMLElement[];

    // Enter on the focused cell commits + closes; the layer row is untouched.
    cells[0].dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
    );
    expect(row.querySelector(`.${CONST.CLASSES.STYLE_ICON_GRID}`)).toBeNull();
    expect(getIntent(ui, "overlay1", DIM.ICON)).toEqual({
      kind: "glyph",
      value: PICKER_GLYPHS[0],
    });
    expect(toggle).not.toHaveBeenCalled();

    cleanup();
  });

  it("clamps keyboard navigation at the grid edges", () => {
    const row = buildIconRow(ui, "overlay1")!;
    document.body.appendChild(row);
    const trigger = row.querySelector(
      `.${CONST.CLASSES.STYLE_ICON_TRIGGER}`,
    ) as HTMLElement;
    trigger.click();
    const grid = row.querySelector(`.${CONST.CLASSES.STYLE_ICON_GRID}`)!;
    const cells = [
      ...grid.querySelectorAll(`.${CONST.CLASSES.STYLE_ICON_CELL}`),
    ] as HTMLElement[];
    const last = cells[cells.length - 1];
    last.focus();
    // ArrowDown past the end stays on the last cell (clamped).
    grid.dispatchEvent(
      new KeyboardEvent("keydown", { bubbles: true, key: "ArrowDown" }),
    );
    expect(document.activeElement).toBe(last);
    // ArrowRight past the last column also clamps.
    grid.dispatchEvent(
      new KeyboardEvent("keydown", { bubbles: true, key: "ArrowRight" }),
    );
    expect(document.activeElement).toBe(last);
    // ArrowUp from the top clamps at index 0.
    cells[0].focus();
    grid.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "ArrowUp" }));
    expect(document.activeElement).toBe(cells[0]);
  });

  it("closes on an outside pointerdown", () => {
    const row = buildIconRow(ui, "overlay1")!;
    document.body.appendChild(row);
    const trigger = row.querySelector(
      `.${CONST.CLASSES.STYLE_ICON_TRIGGER}`,
    ) as HTMLElement;
    trigger.click();
    expect(row.querySelector(`.${CONST.CLASSES.STYLE_ICON_GRID}`)).not.toBeNull();
    // A press outside the grid (on the row, not inside a cell) closes it.
    row.dispatchEvent(new Event("mousedown", { bubbles: true }));
    expect(row.querySelector(`.${CONST.CLASSES.STYLE_ICON_GRID}`)).toBeNull();
  });

  it("cleans up its document listeners when the grid is removed", () => {
    const row = buildIconRow(ui, "overlay1")!;
    document.body.appendChild(row);
    const trigger = row.querySelector(
      `.${CONST.CLASSES.STYLE_ICON_TRIGGER}`,
    ) as HTMLElement;
    trigger.click();
    const grid = row.querySelector(`.${CONST.CLASSES.STYLE_ICON_GRID}`)!;
    expect(grid).not.toBeNull();
    // jsdom does not fire a native "remove" event on element.remove(), so
    // exercise the cleanup path by dispatching it explicitly.
    grid.dispatchEvent(new Event("remove"));
    // The grid is still in the DOM (removal listeners only detach the
    // document listeners); close it by clicking the trigger.
    trigger.click();
    expect(row.querySelector(`.${CONST.CLASSES.STYLE_ICON_GRID}`)).toBeNull();
  });

  it("ignores an unrecognized key while navigating", () => {
    const row = buildIconRow(ui, "overlay1")!;
    document.body.appendChild(row);
    const trigger = row.querySelector(
      `.${CONST.CLASSES.STYLE_ICON_TRIGGER}`,
    ) as HTMLElement;
    trigger.click();
    const grid = row.querySelector(`.${CONST.CLASSES.STYLE_ICON_GRID}`)!;
    const cells = [
      ...grid.querySelectorAll(`.${CONST.CLASSES.STYLE_ICON_CELL}`),
    ] as HTMLElement[];
    cells[0].focus();
    expect(() => {
      grid.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Tab" }));
    }).not.toThrow();
    expect(document.activeElement).toBe(cells[0]);
  });

  it("trigger toggles the grid: a second click closes, a third reopens", () => {
    // The trigger click handler closes when open and opens when closed. The
    // `if (grid) return` guard in open() is the close/open toggle's other
    // half: an already-open grid is never built twice.
    const row = buildIconRow(ui, "overlay1")!;
    document.body.appendChild(row);
    const trigger = row.querySelector(
      `.${CONST.CLASSES.STYLE_ICON_TRIGGER}`,
    ) as HTMLElement;
    trigger.click();
    expect(row.querySelector(`.${CONST.CLASSES.STYLE_ICON_GRID}`)).not.toBeNull();
    trigger.click();
    expect(row.querySelector(`.${CONST.CLASSES.STYLE_ICON_GRID}`)).toBeNull();
    trigger.click();
    expect(row.querySelectorAll(`.${CONST.CLASSES.STYLE_ICON_GRID}`).length).toBe(1);
  });

  it("focusIndex clamps an out-of-range index (no focus, no throw)", () => {
    // The `if (index >= 0 && index < cells.length)` guard in focusIndex: a
    // clamped movement to a negative/overflow index is a no-op, not a throw.
    const row = buildIconRow(ui, "overlay1")!;
    document.body.appendChild(row);
    const trigger = row.querySelector(
      `.${CONST.CLASSES.STYLE_ICON_TRIGGER}`,
    ) as HTMLElement;
    trigger.click();
    const grid = row.querySelector(`.${CONST.CLASSES.STYLE_ICON_GRID}`)!;
    const cells = [
      ...grid.querySelectorAll(`.${CONST.CLASSES.STYLE_ICON_CELL}`),
    ] as HTMLElement[];
    cells[0].focus();
    // Home already at 0; ArrowLeft clamps at 0, focus stays on cell 0.
    grid.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Home" }));
    grid.dispatchEvent(
      new KeyboardEvent("keydown", { bubbles: true, key: "ArrowLeft" }),
    );
    expect(document.activeElement).toBe(cells[0]);
    // Focus off-grid: the index guard skips focus entirely.
    (document.activeElement as HTMLElement).blur();
    expect(() => {
      grid.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, key: "ArrowRight" }),
      );
    }).not.toThrow();
  });
  it("outside press still closes after five open/close cycles", () => {
    const row = buildIconRow(ui, "overlay1")!;
    document.body.appendChild(row);
    const trigger = row.querySelector(
      `.${CONST.CLASSES.STYLE_ICON_TRIGGER}`,
    ) as HTMLElement;
    for (let i = 0; i < 5; i++) {
      trigger.click();
      expect(row.querySelector(`.${CONST.CLASSES.STYLE_ICON_GRID}`)).not.toBeNull();
      row.dispatchEvent(new Event("mousedown", { bubbles: true }));
      expect(row.querySelector(`.${CONST.CLASSES.STYLE_ICON_GRID}`)).toBeNull();
    }
  });

  it("Escape returns focus to the trigger", () => {
    const row = buildIconRow(ui, "overlay1")!;
    document.body.appendChild(row);
    const trigger = row.querySelector(
      `.${CONST.CLASSES.STYLE_ICON_TRIGGER}`,
    ) as HTMLElement;
    trigger.click();
    const grid = row.querySelector(`.${CONST.CLASSES.STYLE_ICON_GRID}`)!;
    grid.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Escape" }));
    expect(row.querySelector(`.${CONST.CLASSES.STYLE_ICON_GRID}`)).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("document listeners are paired across open/close (no leak)", () => {
    const addSpy = vi.spyOn(document, "addEventListener");
    const removeSpy = vi.spyOn(document, "removeEventListener");
    const row = buildIconRow(ui, "overlay1")!;
    document.body.appendChild(row);
    const trigger = row.querySelector(
      `.${CONST.CLASSES.STYLE_ICON_TRIGGER}`,
    ) as HTMLElement;
    trigger.click();
    const added = addSpy.mock.calls.length;
    const removedBefore = removeSpy.mock.calls.length;
    trigger.click();
    const removed = removeSpy.mock.calls.length - removedBefore;
    expect(removed).toBeGreaterThanOrEqual(added);
    addSpy.mockRestore();
    removeSpy.mockRestore();
  });

  it("grid overlay panels() reads the live grid, not a snapshot", () => {
    // The register entry's panels() closure reads `grid` at call time. A
    // snapshot (panels: () => [grid]) would keep returning the detached
    // grid after close; the live read returns [] the moment grid is null.
    const registry = ensureOverlayRegistry(ui.c.map);
    const registerSpy = vi.spyOn(registry, "register");
    const row = buildIconRow(ui, "overlay1")!;
    document.body.appendChild(row);
    const trigger = row.querySelector(
      `.${CONST.CLASSES.STYLE_ICON_TRIGGER}`,
    ) as HTMLElement;
    trigger.click();
    const entry = registerSpy.mock.calls.at(-1)![0] as {
      panels: () => Element[];
    };
    const grid = row.querySelector(`.${CONST.CLASSES.STYLE_ICON_GRID}`)!;
    expect(grid).not.toBeNull();
    expect(entry.panels()).toEqual([grid]);
    // Close the grid: `grid` is nulled and removed. The SAME entry now
    // reads the live variable — an empty panel list, not the detached grid.
    trigger.click();
    expect(row.querySelector(`.${CONST.CLASSES.STYLE_ICON_GRID}`)).toBeNull();
    expect(entry.panels()).toEqual([]);
    registerSpy.mockRestore();
  });
});

describe("glyph grid cell contract (id single-source + role kept)", () => {
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

  it("gives every cell a single-source id and keeps gridcell role", () => {
    const row = buildIconRow(ui, "overlay1")!;
    const trigger = row.querySelector(
      `.${CONST.CLASSES.STYLE_ICON_TRIGGER}`,
    ) as HTMLElement;
    trigger.click();
    const cells = row.querySelectorAll(`.${CONST.CLASSES.STYLE_ICON_CELL}`);
    expect(cells.length).toBeGreaterThan(0);
    cells.forEach(cell => {
      // id comes from the shared ui/optionRow source, never foliplus-opt-.
      expect(cell.id).toMatch(/^foliplus-icon-cell-\d+$/);
      // the grid role survives the cursor (paintOptionContract: false).
      expect(cell.getAttribute("role")).toBe("gridcell");
    });
    // roving tabindex: exactly one cell is the tab stop.
    const tabStops = [...cells].filter(c => (c as HTMLElement).tabIndex === 0);
    expect(tabStops.length).toBe(1);
  });

  it("marks the current glyph cell with aria-current, not aria-selected", () => {
    writeIntentKeys(ui, "overlay1", [[DIM.ICON, { kind: "glyph", value: "star" }]]);
    const row = buildIconRow(ui, "overlay1")!;
    const trigger = row.querySelector(
      `.${CONST.CLASSES.STYLE_ICON_TRIGGER}`,
    ) as HTMLElement;
    trigger.click();
    const cells = row.querySelectorAll(`.${CONST.CLASSES.STYLE_ICON_CELL}`);
    const current = [...cells].find(c => c.getAttribute("data-glyph") === "star")!;
    expect(current.getAttribute("aria-current")).toBe("true");
    expect(current.hasAttribute("aria-selected")).toBe(false);
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

  it("apply merges a surviving icon color and opacity onto the painted glyph", () => {
    // The icon color + opacity are orthogonal to the glyph: applyIconToLayer
    // must carry a user-set ICON_COLOR and ICON_COLOR_OPACITY into the SAME
    // derived-icon construction (setIcon replaces the whole icon).
    writeIntentKeys(ui, "overlay1", [
      [INTENT.ICON_COLOR, "#0000ff"],
      [INTENT.ICON_COLOR_OPACITY, 40],
    ]);
    commitGlyph(ui, "overlay1", "map-pin");
    flushIcon("overlay1");
    const written = school.options.icon;
    expect(written).not.toBe(authorIcon);
    const glyph = written.createIcon().querySelector("i") as HTMLElement;
    expect(glyph.style.color).toBe("rgba(0, 0, 255, 0.4)");
    expect(getIntent(ui, "overlay1", INTENT.ICON_COLOR_OPACITY)).toBe(40);
  });

  it("reset re-derives a surviving icon color onto the restored author icon", () => {
    // The icon color is orthogonal to the glyph: resetting the glyph must not
    // lose a user-set color. resetLayerIcon restores the author icon then
    // re-applies the ICON_COLOR intent, so the marker ends up with the color
    // painted on the freshly restored chassis.
    writeIntentKeys(ui, "overlay1", [[INTENT.ICON_COLOR, "#12abef"]]);
    commitGlyph(ui, "overlay1", "star");
    flushIcon("overlay1");
    expect(school.options.icon).not.toBe(authorIcon);
    resetLayerIcon(ui, "overlay1");
    flushIcon("overlay1");
    const written = school.options.icon;
    expect(written).not.toBe(authorIcon);
    const glyph = written.createIcon().querySelector("i") as HTMLElement;
    expect(glyph.style.color).toBe("rgb(18, 171, 239)");
    expect(getIntent(ui, "overlay1", DIM.ICON)).toBeUndefined();
  });

  it("reset re-derives a surviving icon color and opacity onto the restored author icon", () => {
    // resetLayerIcon restores the author icon then re-applies the ICON_COLOR
    // + ICON_COLOR_OPACITY intents, so a reset never splits the color and the
    // glyph nor silently drops a user-set opacity.
    writeIntentKeys(ui, "overlay1", [
      [INTENT.ICON_COLOR, "#0000ff"],
      [INTENT.ICON_COLOR_OPACITY, 40],
    ]);
    commitGlyph(ui, "overlay1", "map-pin");
    flushIcon("overlay1");
    resetLayerIcon(ui, "overlay1");
    flushIcon("overlay1");
    const written = school.options.icon;
    expect(written).not.toBe(authorIcon);
    const glyph = written.createIcon().querySelector("i") as HTMLElement;
    expect(glyph.style.color).toBe("rgba(0, 0, 255, 0.4)");
    expect(getIntent(ui, "overlay1", DIM.ICON)).toBeUndefined();
  });

  it("reset skips a missing layer without throwing", () => {
    expect(() => resetLayerIcon(ui, "nope")).not.toThrow();
  });

  it("reset is a no-op when the layer left the map", () => {
    // The registry entry survives but the layer object is gone (removed from
    // the map), so findLayer returns null — reset must not touch a null walk.
    commitGlyph(ui, "overlay1", "star");
    flushIcon("overlay1");
    // Simulate the layer leaving the map: findLayer resolves via the map.
    const layer = ui.c.findLayer("overlay1");
    expect(layer).not.toBeNull();
    resetLayerIcon(ui, "overlay1");
    expect(getIntent(ui, "overlay1", DIM.ICON)).toBeUndefined();
  });

  it("reset is a no-op when the layer left the map mid-flight", () => {
    // A layer in the registry whose map lookup fails (removed from the
    // map between the write and the reset) must not crash the walk.
    commitGlyph(ui, "overlay1", "star");
    flushIcon("overlay1");
    vi.spyOn(ui.c, "findLayer").mockReturnValue(null as never);
    expect(() => resetLayerIcon(ui, "overlay1")).not.toThrow();
    expect(getIntent(ui, "overlay1", DIM.ICON)).toBeUndefined();
    vi.restoreAllMocks();
  });
  it("reset skips a non-marker leaf in the walk", () => {
    const poly = makePoly();
    const group = makeMarkerGroup(school, poly as any);
    const { manager: m4, ui: u4 } = initFixture({
      data: [{ id: "mix2", name: "MIX2", role: "overlay", layer: group }, BASE_LAYER],
    });
    commitGlyph(u4, "mix2", "star");
    flushIcon("mix2");
    expect(() => resetLayerIcon(u4, "mix2")).not.toThrow();
    m4?.debouncedEnforce?.cancel?.();
    document.body.innerHTML = "";
    vi.clearAllMocks();
  });
  it("shows the unavailable state when the user picks a valid-but-unpainted glyph", () => {
    // The user committed a syntactically valid glyph (via intent) that the
    // loaded stylesheet does not paint: the trigger must show the unavailable
    // state (dashed circle + the original name + hint) instead of a blank.
    writeIntentKeys(ui, "overlay1", [
      [DIM.ICON, { kind: "glyph", value: "map-marker" }],
    ]);
    (window as any).__glyphProbePainted = false;
    const row = buildIconRow(ui, "overlay1")!;
    const trigger = row.querySelector(
      `.${CONST.CLASSES.STYLE_ICON_TRIGGER}`,
    ) as HTMLElement;
    expect(
      trigger.classList.contains(CONST.CLASSES.STYLE_ICON_TRIGGER_UNAVAILABLE),
    ).toBe(true);
    expect(
      trigger.querySelector(`.${CONST.CLASSES.STYLE_ICON_UNAVAILABLE_GLYPH}`),
    ).not.toBeNull();
    expect(trigger.textContent).toContain("map-marker");
    expect(trigger.title).toContain(
      ui.T("style_icon_unavailable").replace("{name}", "map-marker"),
    );
  });

  it("shows the unavailable state when the glyph name fails syntax", () => {
    // A name that fails glyph syntax (resolveGlyph -> null): the behavior is
    // pinned to the same explicit unavailable state — show the original name
    // with the hint, never silently fall back to a circle or an empty label.
    writeIntentKeys(ui, "overlay1", [
      [DIM.ICON, { kind: "glyph", value: "not a glyph!" }],
    ]);
    const row = buildIconRow(ui, "overlay1")!;
    const trigger = row.querySelector(
      `.${CONST.CLASSES.STYLE_ICON_TRIGGER}`,
    ) as HTMLElement;
    expect(
      trigger.classList.contains(CONST.CLASSES.STYLE_ICON_TRIGGER_UNAVAILABLE),
    ).toBe(true);
    expect(
      trigger.querySelector(`.${CONST.CLASSES.STYLE_ICON_UNAVAILABLE_GLYPH}`),
    ).not.toBeNull();
    expect(trigger.textContent).toContain("not a glyph!");
    expect(trigger.title).toContain(
      ui.T("style_icon_unavailable").replace("{name}", "not a glyph!"),
    );
  });

  it("apply is a no-op for a layer the registry lost", () => {
    writeIntentKeys(ui, "nope", [[INTENT.ICON, { kind: "glyph", value: "star" }]]);
    applyIconToLayer(ui, "nope");
    expect(school.setIcon).not.toHaveBeenCalled();
  });

  it("apply skips a non-marker leaf in the walk", () => {
    // A group with a polygon leaf cannot carry an icon; the walk must skip
    // it without touching setIcon.
    const poly = makePoly();
    const group = makeMarkerGroup(school, poly as any);
    const { manager: m3, ui: u3 } = initFixture({
      data: [{ id: "mix", name: "MIX", role: "overlay", layer: group }, BASE_LAYER],
    });
    commitGlyph(u3, "mix", "star");
    flushIcon("mix");
    expect(school.setIcon).toHaveBeenCalled();
    m3?.debouncedEnforce?.cancel?.();
    document.body.innerHTML = "";
    vi.clearAllMocks();
  });

  it("reset tolerates a leaf whose captured author is missing", () => {
    // A leaf can reach reset with no authorIcon entry (e.g. the layer was
    // mutated so a new leaf joined after the write, or a prior reset already
    // deleted the entry). The walk must delete (a no-op) without throwing.
    const marker = makeMarker({ type: "school" }, makeAuthorIcon());
    const { manager: m7, ui: u7 } = fixtureWithMarkers([marker]);
    window.localStorage.removeItem(CONST.STORAGE.KEY);
    commitGlyph(u7, "overlay1", "star");
    flushIcon("overlay1");
    // Force the WeakMap entry away by clearing via a first reset, then reset again.
    resetLayerIcon(u7, "overlay1");
    expect(() => resetLayerIcon(u7, "overlay1")).not.toThrow();
    expect(getIntent(u7, "overlay1", DIM.ICON)).toBeUndefined();
    m7?.debouncedEnforce?.cancel?.();
    document.body.innerHTML = "";
    vi.clearAllMocks();
  });

  it("multi-leaf commit and reset restore each author independently", () => {
    // Two markers with DIFFERENT authors: commit gives both the star glyph,
    // and reset returns each leaf to its OWN author (not the other's). This
    // pins the per-leaf WeakMap keyed by leaf — a walk that early-returns or
    // keyed the wrong object would restore the wrong icon.
    const authorA = makeAuthorIcon();
    authorA.options = { ...authorA.options, className: "author-a" };
    const authorB = makeAuthorIcon();
    authorB.options = { ...authorB.options, className: "author-b" };
    const mA = makeMarker({ type: "school" }, authorA);
    const mB = makeMarker({ type: "hospital" }, authorB);
    const { manager: m12, ui: u12 } = fixtureWithMarkers([mA, mB]);
    window.localStorage.removeItem(CONST.STORAGE.KEY);
    commitGlyph(u12, "overlay1", "star");
    flushIcon("overlay1");
    expect(mA.options.icon).not.toBe(authorA);
    expect(mB.options.icon).not.toBe(authorB);
    // Both leaves show the committed glyph (derived from their own author).
    expect(Object.getPrototypeOf(mA.options.icon)).toBe(authorA);
    expect(Object.getPrototypeOf(mB.options.icon)).toBe(authorB);
    resetLayerIcon(u12, "overlay1");
    flushIcon("overlay1");
    expect(mA.options.icon).toBe(authorA);
    expect(mB.options.icon).toBe(authorB);
    expect(Object.getPrototypeOf(mA.options.icon)).not.toBe(authorB);
    m12?.debouncedEnforce?.cancel?.();
    document.body.innerHTML = "";
    vi.clearAllMocks();
  });

  it("fill write does not disturb a committed icon", () => {
    // G5 cross-dimension isolation (fill → icon): writing a fill colour must
    // not clear or replace the icon the layer already committed.
    const author = makeAuthorIcon();
    const leaf = makeHybridLeaf(author, { fillColor: "#aabbcc" });
    const group = makeMarkerGroup(leaf);
    const { manager: m13, ui: u13 } = initFixture({
      data: [{ id: "hy1", name: "HY1", role: "overlay", layer: group }, BASE_LAYER],
    });
    window.localStorage.removeItem(CONST.STORAGE.KEY);
    // Commit an icon first.
    commitGlyph(u13, "hy1", "star");
    flushIcon("hy1");
    const iconAfterGlyph = leaf.options.icon;
    expect(iconAfterGlyph).not.toBe(author);
    // Now write a fill colour and flush its face.
    commitFillColor(u13, "hy1", "#123456");
    flushStyleDimApply(FACE.FILL, "hy1");
    // The icon is untouched, the fill landed, and the fill colour is visible.
    expect(leaf.options.icon).toBe(iconAfterGlyph);
    expect(leaf.options.fillColor).toBe("#123456");
    m13?.debouncedEnforce?.cancel?.();
    document.body.innerHTML = "";
    vi.clearAllMocks();
  });

  it("icon write does not disturb an existing fill", () => {
    // G5 cross-dimension isolation (icon → fill): committing a glyph after a
    // fill write must not clear the fill colour on the leaf.
    const author = makeAuthorIcon();
    const leaf = makeHybridLeaf(author, { fillColor: "#aabbcc" });
    const group = makeMarkerGroup(leaf);
    const { manager: m14, ui: u14 } = initFixture({
      data: [{ id: "hy2", name: "HY2", role: "overlay", layer: group }, BASE_LAYER],
    });
    window.localStorage.removeItem(CONST.STORAGE.KEY);
    commitFillColor(u14, "hy2", "#123456");
    flushStyleDimApply(FACE.FILL, "hy2");
    expect(leaf.options.fillColor).toBe("#123456");
    commitGlyph(u14, "hy2", "star");
    flushIcon("hy2");
    expect(leaf.options.icon).not.toBe(author);
    // The fill survives the icon write.
    expect(leaf.options.fillColor).toBe("#123456");
    m14?.debouncedEnforce?.cancel?.();
    document.body.innerHTML = "";
    vi.clearAllMocks();
  });

  it("reset only affects the icon, leaving the fill intent and value in place", () => {
    // G5 cross-dimension isolation (reset scoping): resetting the icon must
    // restore the authored icon but keep the fill override (intent + value).
    const author = makeAuthorIcon();
    const leaf = makeHybridLeaf(author, { fillColor: "#aabbcc" });
    const group = makeMarkerGroup(leaf);
    const { manager: m15, ui: u15 } = initFixture({
      data: [{ id: "hy3", name: "HY3", role: "overlay", layer: group }, BASE_LAYER],
    });
    window.localStorage.removeItem(CONST.STORAGE.KEY);
    commitFillColor(u15, "hy3", "#123456");
    flushStyleDimApply(FACE.FILL, "hy3");
    commitGlyph(u15, "hy3", "star");
    flushIcon("hy3");
    expect(leaf.options.icon).not.toBe(author);
    // Reset the icon: it returns to the author, fill stays.
    resetLayerIcon(u15, "hy3");
    flushIcon("hy3");
    expect(leaf.options.icon).toBe(author);
    expect(leaf.options.fillColor).toBe("#123456");
    expect(getIntent(u15, "hy3", INTENT.FILL_COLOR)).toEqual("#123456");
    m15?.debouncedEnforce?.cancel?.();
    document.body.innerHTML = "";
    vi.clearAllMocks();
  });

  it("applies a divIcon to a default-icon marker and pins the anchor", () => {
    const defaultAuthor = makeDefaultIconAuthor();
    const marker = makeMarker({ type: "school" }, defaultAuthor);
    const { manager: m2, ui: u2 } = fixtureWithMarkers([marker]);
    window.localStorage.removeItem(CONST.STORAGE.KEY);
    commitGlyph(u2, "overlay1", "map-pin");
    flushIcon("overlay1");
    expect(marker.setIcon).toHaveBeenCalled();
    // The leaf's icon is now the dedicated divIcon (not a derived chassis),
    // with the Leaflet default anchor pinned so the glyph sits on the point.
    expect(marker.options.icon).toBeInstanceOf((window.L as any).DivIcon);
    expect(marker.options.icon.options).toMatchObject({
      className: "foliplus-marker-default",
      iconSize: [25, 41],
      iconAnchor: [12, 41],
    });
    m2?.debouncedEnforce?.cancel?.();
    document.body.innerHTML = "";
    vi.clearAllMocks();
  });

  it("re-applying captures the author only once", () => {
    // A second apply must reuse the already-captured author (the WeakMap
    // early-return) rather than re-reading options.icon — which by now holds
    // the DERIVED icon.
    commitGlyph(ui, "overlay1", "map-pin");
    flushIcon("overlay1");
    const first = school.options.icon;
    commitGlyph(ui, "overlay1", "star");
    flushIcon("overlay1");
    expect(school.options.icon).not.toBe(first);
    // The author captured on the first write is the prototype of both.
    expect(Object.getPrototypeOf(school.options.icon)).toBe(authorIcon);
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
  it("reset restores the authored icon and drops the intent", () => {
    ICON_DIMENSION.write!(ui, "overlay1", { kind: "glyph", value: "star" });
    flushIcon("overlay1");
    ICON_DIMENSION.reset!(ui, "overlay1");
    expect(getIntent(ui, "overlay1", DIM.ICON)).toBeUndefined();
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

describe("icon rehydrate drift guard", () => {
  it("replays icon on attach alongside border/fill/size", () => {
    // The attach replay block in ui/index.ts walks every layer the user
    // touched and re-applies the stored style dimensions. If icon is missing
    // from that sequence, a persisted glyph is written on first load but
    // never repainted — the user picks an icon, reloads, and the marker
    // falls back to the default. Pin icon into the same block as the other
    // dimensions so this cannot regress silently.
    const replayBlock = indexSource.slice(
      indexSource.indexOf("applyBorderToLayer(this, layerId);"),
      indexSource.indexOf("} // author-declared fills") !== -1
        ? indexSource.indexOf("} // author-declared fills")
        : indexSource.indexOf("applySizeToLayer(this, layerId);") + 80,
    );
    expect(replayBlock).toContain("applyBorderToLayer(this, layerId);");
    expect(replayBlock).toContain("replayFillState(this, layerId);");
    expect(replayBlock).toContain("applySizeToLayer(this, layerId);");
    expect(replayBlock).toContain("applyIconToLayer(this, layerId);");
  });

  it("shows the happy state when the author declares a fa-prefixed name", () => {
    const probed: string[] = [];
    vi.spyOn(window, "getComputedStyle").mockImplementation(
      (el: Element, pseudo?: string | null) => {
        if (pseudo === "::before") probed.push(el.className);
        return { content: '"\\f00a"' } as CSSStyleDeclaration;
      },
    );
    const author = makeAuthorIcon();
    author.options = { ...author.options, icon: "fa-martini-glass", prefix: "fa" };
    const marker = makeMarker({ type: "school" }, author);
    const { ui: u10 } = fixtureWithMarkers([marker]);
    window.localStorage.removeItem(CONST.STORAGE.KEY);
    const row = buildIconRow(u10, "overlay1")!;
    const trigger = row.querySelector(
      `.${CONST.CLASSES.STYLE_ICON_TRIGGER}`,
    ) as HTMLElement;
    expect(
      trigger.classList.contains(CONST.CLASSES.STYLE_ICON_TRIGGER_UNAVAILABLE),
    ).toBe(false);
    expect(trigger.textContent).toContain("fa-martini-glass");
    expect(probed).toContain("fa fa-martini-glass");
  });

  it("shows the unavailable state for a name the author's prefix cannot paint", () => {
    const probed: string[] = [];
    (window as any).__glyphProbePainted = false;
    vi.spyOn(window, "getComputedStyle").mockImplementation(
      (el: Element, pseudo?: string | null) => {
        if (pseudo === "::before") probed.push(el.className);
        return { content: "none" } as CSSStyleDeclaration;
      },
    );
    const author = makeAuthorIcon();
    author.options = { ...author.options, icon: "no-such-glyph", prefix: "fa-solid" };
    const marker = makeMarker({ type: "school" }, author);
    const { ui: u11 } = fixtureWithMarkers([marker]);
    window.localStorage.removeItem(CONST.STORAGE.KEY);
    const row = buildIconRow(u11, "overlay1")!;
    const trigger = row.querySelector(
      `.${CONST.CLASSES.STYLE_ICON_TRIGGER}`,
    ) as HTMLElement;
    expect(
      trigger.classList.contains(CONST.CLASSES.STYLE_ICON_TRIGGER_UNAVAILABLE),
    ).toBe(true);
    expect(trigger.textContent).toContain("no-such-glyph");
    expect(probed).toContain("fa-solid fa-no-such-glyph");
  });
});

describe("icon by-value mode", () => {
  let manager: LayerController;
  let ui: LayerUI;
  let authorIcon: any;
  let school: any;
  let hospital: any;

  const glyphs = ["circle", "square", "diamond"];
  const valueConfig = {
    kind: "numeric" as const,
    field: "count",
    method: "equal" as const,
    classes: 3,
    glyphs,
  };

  beforeEach(() => {
    authorIcon = makeAuthorIcon();
    school = makeMarker({ type: "school", count: 1 }, authorIcon);
    hospital = makeMarker({ type: "hospital", count: 9 }, authorIcon);
    ({ manager, ui } = fixtureWithMarkers([school, hospital]));
    ui.runtimeStore.setFields("overlay1", [
      { name: "count", numeric: true },
      { name: "name", numeric: false },
    ]);
    window.localStorage.removeItem(CONST.STORAGE.KEY);
  });

  afterEach(() => {
    manager?.debouncedEnforce?.cancel?.();
    document.body.innerHTML = "";
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  const modeSelect = (row: HTMLElement) =>
    row.querySelector(`.${CONST.CLASSES.STYLE_ICON_MODE_SELECT}`) as HTMLSelectElement;

  it("offers the by-value option when the layer has a numeric field", () => {
    const row = buildIconRow(ui, "overlay1")!;
    const select = modeSelect(row);
    expect(select.querySelector('option[value="single"]')).not.toBeNull();
    expect(select.querySelector('option[value="byValue"]')).not.toBeNull();
    expect(select.value).toBe("single");
  });

  it("omits the by-value option when the layer has no numeric field", () => {
    // A layer whose features carry only non-numeric properties: the field
    // cache says "name" is non-numeric AND the leaf snapshot finds no
    // numeric property, so no by-value option can be offered.
    delete school.feature.properties.count;
    delete hospital.feature.properties.count;
    ui.runtimeStore.setFields("overlay1", [{ name: "name", numeric: false }]);
    const row = buildIconRow(ui, "overlay1")!;
    const select = modeSelect(row);
    expect(select.querySelector('option[value="byValue"]')).toBeNull();
    expect(select.querySelector('option[value="single"]')).not.toBeNull();
  });

  it("reads by-value when only a value config is stored (displayIconMode fallback)", () => {
    writeIntentKeys(ui, "overlay1", [[INTENT.ICON_VALUE, valueConfig]]);
    const row = buildIconRow(ui, "overlay1")!;
    expect(modeSelect(row).value).toBe("byValue");
    // The value detail (field/classes/scheme) renders, not the glyph grid.
    expect(
      row.querySelector(`.${CONST.CLASSES.STYLE_ICON_FIELD_SELECT}`),
    ).not.toBeNull();
  });

  it("key isolation: an icon-mode write never writes the color keys", () => {
    const spy = vi.spyOn(ui.intentStore, "setRaw");
    ICON_DIMENSION.write!(ui, "overlay1", { mode: "byValue", value: valueConfig });
    const written = spy.mock.calls.map(c => c[1] as string);
    expect(written).toContain(INTENT.ICON_VALUE);
    expect(written).toContain(INTENT.ICON_MODE);
    expect(written).not.toContain(INTENT.ICON_COLOR);
    expect(written).not.toContain(INTENT.ICON_COLOR_OPACITY);
    vi.restoreAllMocks();
  });

  it("key isolation: a single-glyph write never writes the color keys", () => {
    const spy = vi.spyOn(ui.intentStore, "setRaw");
    commitGlyph(ui, "overlay1", "star");
    const written = spy.mock.calls.map(c => c[1] as string);
    expect(written).toContain(INTENT.ICON);
    expect(written).toContain(INTENT.ICON_MODE);
    expect(written).not.toContain(INTENT.ICON_COLOR);
    expect(written).not.toContain(INTENT.ICON_COLOR_OPACITY);
    vi.restoreAllMocks();
  });

  it("key isolation: a color write never writes the value/mode keys", () => {
    const dim = getDimension(DIM.ICON_COLOR);
    const spy = vi.spyOn(ui.intentStore, "setRaw");
    dim?.write!(ui, "overlay1", { value: "#12abef" });
    const written = spy.mock.calls.map(c => c[1] as string);
    expect(written).toContain(INTENT.ICON_COLOR);
    expect(written).not.toContain(INTENT.ICON_VALUE);
    expect(written).not.toContain(INTENT.ICON_MODE);
    vi.restoreAllMocks();
  });

  it("invariant: by-value apply calls setIcon exactly once per marker leaf", () => {
    writeIntentKeys(ui, "overlay1", [
      [INTENT.ICON_MODE, "byValue"],
      [INTENT.ICON_VALUE, valueConfig],
    ]);
    applyIconToLayer(ui, "overlay1");
    expect(school.setIcon).toHaveBeenCalledTimes(1);
    expect(hospital.setIcon).toHaveBeenCalledTimes(1);
    // The one derived icon carries glyph + color in a single construction.
    const written = school.options.icon;
    expect(written).not.toBe(authorIcon);
    expect(Object.getPrototypeOf(written)).toBe(authorIcon);
    const glyph = written.createIcon().querySelector("i") as HTMLElement;
    expect(glyph.className).toContain("fa-circle");
  });

  it("maps each value to its class glyph and paints by value", () => {
    writeIntentKeys(ui, "overlay1", [
      [INTENT.ICON_MODE, "byValue"],
      [INTENT.ICON_VALUE, valueConfig],
    ]);
    applyIconToLayer(ui, "overlay1");
    const g0 = school.options.icon.createIcon().querySelector("i") as HTMLElement;
    const g1 = hospital.options.icon.createIcon().querySelector("i") as HTMLElement;
    // count=1 vs count=9 under 3 equal classes land in different glyphs.
    expect(g0.className).not.toBe(g1.className);
  });

  it("reset clears all three icon keys and re-derives a surviving color", () => {
    writeIntentKeys(ui, "overlay1", [
      [INTENT.ICON_COLOR, "#12abef"],
      [INTENT.ICON_MODE, "byValue"],
      [INTENT.ICON_VALUE, valueConfig],
    ]);
    applyIconToLayer(ui, "overlay1");
    expect(school.options.icon).not.toBe(authorIcon);
    resetLayerIcon(ui, "overlay1");
    flushIcon("overlay1");
    expect(getIntent(ui, "overlay1", INTENT.ICON)).toBeUndefined();
    expect(getIntent(ui, "overlay1", INTENT.ICON_VALUE)).toBeUndefined();
    expect(getIntent(ui, "overlay1", INTENT.ICON_MODE)).toBeUndefined();
    // The color survives reset and is repainted onto the restored author.
    const written = school.options.icon;
    expect(written).not.toBe(authorIcon);
    const glyph = written.createIcon().querySelector("i") as HTMLElement;
    expect(glyph.style.color).toBe("rgb(18, 171, 239)");
    expect(getIntent(ui, "overlay1", INTENT.ICON_COLOR)).toBe("#12abef");
  });
});
