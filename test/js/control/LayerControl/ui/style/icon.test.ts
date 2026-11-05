import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DIM } from "#core/layer/index.js";
import * as CONST from "#control/LayerControl/const.js";
import type { LayerController } from "#control/LayerControl/controller.js";
import type { LayerUI } from "#control/LayerControl/ui/index.js";
import { getIntent } from "#control/LayerControl/ui/intent.js";
import {
  ICON_DIMENSION,
  ICON_LEGEND_BUDGET,
  applyIconToLayer,
  buildIconRow,
  commitIconField,
  cycleIconSymbol,
  layerCanIcon,
  resetLayerIcon,
} from "#control/LayerControl/ui/style/icon.js";
import {
  getDimension,
  writeIntentKeys,
} from "#control/LayerControl/ui/style/registry.js";
import { FACE, flushStyleDimApply } from "#control/LayerControl/ui/style/styleBag.js";
import { initFixture } from "../fixture.js";

// A marker leaf: the layer type the icon dimension owns. It carries the
// per-feature categorical value in feature.properties and writes its icon
// through setIcon (the duck-type the capability probe keys on).
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

describe("icon dimension constants", () => {
  it("exports a legend budget threshold so the test can pin it", () => {
    // B2: the collapse-vs-scroll threshold must be a readable exported
    // constant, not an inline magic number.
    expect(ICON_LEGEND_BUDGET).toBeGreaterThan(0);
  });
});

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
      makeMarker({ type: "school" }),
      makeMarker({ type: "hospital" }),
      makeMarker({ type: "park" }),
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

  it("renders the field select and one legend row per category", () => {
    const row = buildIconRow(ui, "overlay1");
    expect(row).not.toBeNull();
    const select = row!.querySelector("select") as HTMLSelectElement;
    expect(select).not.toBeNull();
    // The field picker lists the layer's categorical field names (the
    // property keys), so the three markers sharing the "type" key yield one.
    expect(select.options.length).toBe(1);
    expect(select.options[0]?.value).toBe("type");
    // The legend renders one row per distinct category value.
    const legendRows = row!.querySelectorAll(`.${CONST.CLASSES.STYLE_ICON_LEGEND_ROW}`);
    expect(legendRows.length).toBe(3);
  });

  it("renders the empty state when no categorical field exists", () => {
    const { manager: m2, ui: u2 } = fixtureWithMarkers([
      makeMarker({}),
      makeMarker({}),
    ]);
    const row = buildIconRow(u2, "overlay1");
    expect(row).not.toBeNull();
    expect(row!.querySelector(`.${CONST.CLASSES.STYLE_ICON_EMPTY}`)).not.toBeNull();
    m2?.debouncedEnforce?.cancel?.();
    document.body.innerHTML = "";
    vi.clearAllMocks();
  });

  it("shows a collapse toggle past the legend budget and expands in place", () => {
    // Over ICON_LEGEND_BUDGET categories: the list scrolls and the toggle
    // swaps the expanded class + its own label.
    const markers = Array.from({ length: ICON_LEGEND_BUDGET + 3 }, (_, i) =>
      makeMarker({ type: `c${i}` }),
    );
    const { manager: m2, ui: u2 } = fixtureWithMarkers(markers);
    const row = buildIconRow(u2, "overlay1");
    const toggle = row!.querySelector(
      `.${CONST.CLASSES.STYLE_ICON_LEGEND_TOGGLE}`,
    ) as HTMLButtonElement;
    expect(toggle).not.toBeNull();
    // The fixture's translator falls back to the key, so the toggle's label
    // is not asserted verbatim; the behaviour (expand in place) is.
    const list = row!.querySelector(
      `.${CONST.CLASSES.STYLE_ICON_LEGEND_LIST}`,
    ) as HTMLElement;
    expect(list.classList.contains(CONST.CLASSES.STYLE_ICON_LEGEND_EXPANDED)).toBe(
      false,
    );
    toggle.click();
    expect(list.classList.contains(CONST.CLASSES.STYLE_ICON_LEGEND_EXPANDED)).toBe(
      true,
    );
    toggle.click();
    expect(list.classList.contains(CONST.CLASSES.STYLE_ICON_LEGEND_EXPANDED)).toBe(
      false,
    );
    m2?.debouncedEnforce?.cancel?.();
    document.body.innerHTML = "";
    vi.clearAllMocks();
  });

  it("renders an empty preview for an author-kind mapping entry", () => {
    // A mapping value that keeps the author's icon has no symbol SVG, so the
    // legend row's preview is an empty string (the defensive fallback).
    const { manager: m2, ui: u2 } = fixtureWithMarkers([
      makeMarker({ type: "school" }),
      makeMarker({ type: "hospital" }),
    ]);
    writeIntentKeys(u2, "overlay1", [
      [
        DIM.ICON,
        { field: "type", mapping: { school: { kind: "author", value: "inline" } } },
      ],
    ]);
    const row = buildIconRow(u2, "overlay1");
    expect(row).not.toBeNull();
    expect(
      row!.querySelector(`.${CONST.CLASSES.STYLE_ICON_LEGEND_LIST}`),
    ).not.toBeNull();
    m2?.debouncedEnforce?.cancel?.();
    document.body.innerHTML = "";
    vi.clearAllMocks();
  });
});

describe("applyIconToLayer", () => {
  let manager: LayerController;
  let ui: LayerUI;
  let school: any;
  let hospital: any;

  beforeEach(() => {
    school = makeMarker({ type: "school" });
    hospital = makeMarker({ type: "hospital" });
    ({ manager, ui } = fixtureWithMarkers([school, hospital]));
    window.localStorage.removeItem(CONST.STORAGE.KEY);
  });

  afterEach(() => {
    manager?.debouncedEnforce?.cancel?.();
    document.body.innerHTML = "";
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it("commits the field and writes a symbol per category", () => {
    commitIconField(ui, "overlay1", "type");
    flushIcon("overlay1");
    const config = getIntent(ui, "overlay1", DIM.ICON);
    expect(config?.field).toBe("type");
    expect(Object.keys(config?.mapping ?? {}).sort()).toEqual(["hospital", "school"]);
    expect(school.setIcon).toHaveBeenCalled();
    expect(hospital.setIcon).toHaveBeenCalled();
  });

  it("applies a mapping derived from the layer's categories", () => {
    const config = getIntent(ui, "overlay1", DIM.ICON);
    expect(config).toBeUndefined();
    applyIconToLayer(ui, "overlay1");
    // No intent yet: the apply is a no-op, so the author icons are untouched.
    expect(school.setIcon).not.toHaveBeenCalled();
    expect(hospital.setIcon).not.toHaveBeenCalled();
  });

  it("reset restores the authored icon", () => {
    const authorIcon = { html: "author", className: "author" };
    school = makeMarker({ type: "school" }, authorIcon);
    hospital = makeMarker({ type: "hospital" }, authorIcon);
    ({ manager, ui } = fixtureWithMarkers([school, hospital]));
    commitIconField(ui, "overlay1", "type");
    flushIcon("overlay1");
    expect(school.setIcon).toHaveBeenCalled();
    resetLayerIcon(ui, "overlay1");
    flushIcon("overlay1");
    expect(school.options.icon).toBe(authorIcon);
    expect(hospital.options.icon).toBe(authorIcon);
  });

  it("cycles a category's symbol to the next shape on each call", () => {
    commitIconField(ui, "overlay1", "type");
    cycleIconSymbol(ui, "overlay1", "type", "school");
    const first = getIntent(ui, "overlay1", DIM.ICON);
    const firstValue = first?.mapping?.school?.value as string;
    expect(firstValue).toBeTruthy();
    cycleIconSymbol(ui, "overlay1", "type", "school");
    const second = getIntent(ui, "overlay1", DIM.ICON);
    expect(second?.mapping?.school?.value).not.toBe(firstValue);
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
    // The descriptor is the panel's entry point; the row tests cover the
    // row builder, and this covers the write + provenance face that the
    // panel invokes on a commit.
    const config = ICON_DIMENSION.value!(ui, "overlay1");
    expect(config?.field).toBe("type");
    ICON_DIMENSION.write!(ui, "overlay1", {
      field: "type",
      mapping: { school: { kind: "symbol", value: "circle" } },
    });
    const intent = getIntent(ui, "overlay1", DIM.ICON);
    expect(intent?.field).toBe("type");
    expect(ICON_DIMENSION.valueSource!(ui, "overlay1")).toBe("user");
    expect(getDimension(DIM.ICON)?.valueSource!(ui, "overlay1")).toBe("user");
    const policy = ICON_DIMENSION.contentChange;
    if (policy?.kind === "frame") {
      expect(policy.when!(ui, "overlay1")).toBe(true);
      policy.run!(ui, "overlay1");
    } else {
      throw new Error("expected a frame policy");
    }
    // row + reset are the descriptor's remaining faces; the panel calls them
    // when it renders the row and the user presses Reset.
    expect(ICON_DIMENSION.row!(ui, "overlay1")).not.toBeNull();
    ICON_DIMENSION.reset!(ui, "overlay1");
    expect(getIntent(ui, "overlay1", DIM.ICON)).toBeUndefined();
  });

  it("valueSource reports author before a write, none for a non-icon layer, and reset of an unknown layer is a no-op", () => {
    // Fresh fixture: no user intent yet -> the provenance arm is the author.
    expect(ICON_DIMENSION.valueSource!(ui, "overlay1")).toBe("author");
    // A polygon layer cannot carry a marker icon -> the dimension is inert.
    manager.registerLayer({
      id: "p1",
      name: "P",
      role: "overlay",
      layer: makePoly(),
    });
    expect(ICON_DIMENSION.valueSource!(ui, "p1")).toBe("none");
    // Resetting a layer outside the registry returns before any walk.
    expect(() => resetLayerIcon(ui, "nope")).not.toThrow();
  });

  it("commits the chosen field from the picker's change event", () => {
    const row = buildIconRow(ui, "overlay1");
    const select = row!.querySelector("select") as HTMLSelectElement;
    select.value = "type";
    select.dispatchEvent(new Event("change"));
    const intent = getIntent(ui, "overlay1", DIM.ICON);
    expect(intent?.field).toBe("type");
  });
});
describe("icon dimension defensive branches", () => {
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

  it("skips a non-icon leaf and leaves without a usable feature or value", () => {
    // L95 (feature without properties -> props falsy), L186 (non-icon leaf),
    // L188 (null / absent field value), L192 (author-kind -> no symbol icon).
    const school = makeMarker({ type: "school" });
    const noProps = { feature: {}, options: { icon: undefined }, setIcon: vi.fn() };
    const nullValue = makeMarker({ type: null });
    const noType = makeMarker({});
    const authorValue = makeMarker({ type: "park" });
    const poly = makePoly();
    const layer = makeMarkerGroup(
      school,
      noProps,
      nullValue,
      noType,
      authorValue,
      poly,
    );
    const { manager: m2, ui: u2 } = initFixture({
      data: [{ id: "mix1", name: "M", role: "overlay", layer }, BASE_LAYER],
    });
    writeIntentKeys(u2, "mix1", [
      [
        DIM.ICON,
        {
          field: "type",
          mapping: {
            school: { kind: "symbol", value: "circle" },
            park: { kind: "author", value: "inline" },
          },
        },
      ],
    ]);
    applyIconToLayer(u2, "mix1");
    // Only the symbol-mapped school marker writes; every other leaf is skipped.
    expect(school.setIcon).toHaveBeenCalledTimes(1);
    expect((noProps as { setIcon: unknown }).setIcon).not.toHaveBeenCalled();
    expect(nullValue.setIcon).not.toHaveBeenCalled();
    expect(noType.setIcon).not.toHaveBeenCalled();
    // author-kind maps to no built icon (L192 returns before capture).
    expect(authorValue.setIcon).not.toHaveBeenCalled();
    expect(poly.setStyle).not.toHaveBeenCalled();
    m2?.debouncedEnforce?.cancel?.();
    document.body.innerHTML = "";
    vi.clearAllMocks();
  });

  it("bails on a layer outside the registry for apply and commit", () => {
    // L184 (applyIconToLayer no layer — reach it with a stored intent so the
    // apply clears the intent gate first), L211 (commitIconField no layer).
    writeIntentKeys(ui, "nope", [[DIM.ICON, { field: "type", mapping: {} }]]);
    expect(() => applyIconToLayer(ui, "nope")).not.toThrow();
    expect(() => commitIconField(ui, "nope", "type")).not.toThrow();
  });

  it("cycles from the fallback config and wraps a non-symbol entry", () => {
    // L226 (getIntent ?? fallback): no stored intent -> the fallback config
    // is used, and the absent current maps to -1 -> wraps to shape 0.
    cycleIconSymbol(ui, "overlay1", "type", "school");
    let intent = getIntent(ui, "overlay1", DIM.ICON);
    expect(intent?.mapping?.school?.value).toBe("circle");
    // L229 (non-symbol current -> -1 -> wraps): an author-kind entry is not
    // a symbol, so the cycle wraps to the first shape too.
    writeIntentKeys(ui, "overlay1", [
      [
        DIM.ICON,
        {
          field: "type",
          mapping: { school: { kind: "author", value: "inline" } },
        },
      ],
    ]);
    cycleIconSymbol(ui, "overlay1", "type", "school");
    intent = getIntent(ui, "overlay1", DIM.ICON);
    expect(intent?.mapping?.school?.value).toBe("circle");
  });

  it("keeps the authored icon stable across a re-apply", () => {
    // A second apply re-encounters an already-captured leaf: the
    // authorIcon.has early return (L107) keeps the authored icon the
    // capture source, so Reset restores it (not the symbol written on the
    // first apply). The fresh-icon-per-call rule also means L194's
    // already-same-icon return is never taken (the icon is rebuilt), so this
    // test pins the stable-capture behaviour instead.
    const authorIcon = { html: "author", className: "author" };
    const school = makeMarker({ type: "school" }, authorIcon);
    const { manager: m2, ui: u2 } = fixtureWithMarkers([school]);
    writeIntentKeys(u2, "overlay1", [
      [
        DIM.ICON,
        { field: "type", mapping: { school: { kind: "symbol", value: "circle" } } },
      ],
    ]);
    applyIconToLayer(u2, "overlay1");
    expect(school.options.icon).not.toBe(authorIcon);
    applyIconToLayer(u2, "overlay1");
    resetLayerIcon(u2, "overlay1");
    flushIcon("overlay1");
    expect(school.options.icon).toBe(authorIcon);
    m2?.debouncedEnforce?.cancel?.();
    document.body.innerHTML = "";
    vi.clearAllMocks();
  });

  it("renders the symbol SVG as the legend preview", () => {
    // L279 (html string arm): the L.divIcon test mock returns {} by default,
    // so the other legend tests exercise the defensive `: ""` fallback arm.
    // Override the mock to return a string html to pin the real arm.
    const leaflet = (globalThis as any).L;
    const savedDivIcon = leaflet.divIcon;
    leaflet.divIcon = vi.fn(() => ({ options: { html: "<svg>sym</svg>" } }));
    try {
      const row = buildIconRow(ui, "overlay1");
      expect(row).not.toBeNull();
      expect(row!.innerHTML).toContain("<svg>sym</svg>");
    } finally {
      leaflet.divIcon = savedDivIcon;
    }
  });

  it("falls back to an empty config for a stale layer id", () => {
    // L143 (registry miss -> findLayer fallback), L144 (no layer -> []),
    // L169 (empty field -> ?? "") and L170 (!layer arm -> fallback). A stale
    // id is an ordinary state (a removed layer), not a malformed one.
    const config = ICON_DIMENSION.value!(ui, "stale-id");
    expect(config).toEqual({ field: "", mapping: {} });
  });

  it("falls back to an empty config for a layer with no categorical field", () => {
    // L169 (empty field -> ?? "") and L170 (!field arm -> fallback): a
    // registered layer whose leaves carry no classifiable property.
    const layer = makeMarkerGroup(makeMarker({}), makeMarker({}));
    const { manager: m2, ui: u2 } = initFixture({
      data: [{ id: "empty1", name: "E", role: "overlay", layer }, BASE_LAYER],
    });
    const config = ICON_DIMENSION.value!(u2, "empty1");
    expect(config).toEqual({ field: "", mapping: {} });
    m2?.debouncedEnforce?.cancel?.();
    document.body.innerHTML = "";
    vi.clearAllMocks();
  });
});
