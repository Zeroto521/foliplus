import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as CONST from "#foliplus/LayerControl/const.js";
import { LayerManager } from "#foliplus/LayerControl/manager.js";
import { LayerUI } from "#foliplus/LayerControl/ui/index.js";
import {
  applyVisibility,
  getLayerItems,
  handleChange,
  handleInput,
  syncToggleAll,
  toggleAll,
} from "#foliplus/LayerControl/ui/visibility.js";
import { initFixture, installLeafletGlobals } from "./fixture.js";

// ===========================================================================
// ui/visibility.ts — checkbox, group toggle, and the shared visibility
// transition.
//
// Two entry points drive `applyVisibility`: the panel's checkbox and
// `LayerAPI.setVisible`, which a host page calls to hide a layer by id.
// `handleChange` is the original caller and was the only one when the
// transition had a body — the bottom half pins the checkbox side, so the
// delegation cannot regress silently.
//
// The map mock is inlined rather than taken from ui/fixture.ts because the
// shared one returns `hasLayer: () => true` — `syncVisibility()` derives
// `LayerInfo.visible` from `hasLayer()`, so a static true makes every hide
// read back as visible. Membership is tracked here instead, the same way real
// Leaflet tracks it.
// ===========================================================================

const layerFixture = () => ({ options: {} as Record<string, unknown> });

interface FixtureMap {
  _layers: Map<unknown, unknown>;
  hasLayer: ReturnType<typeof vi.fn>;
  addLayer: ReturnType<typeof vi.fn>;
  removeLayer: ReturnType<typeof vi.fn>;
  getContainer: ReturnType<typeof vi.fn>;
  getPane: ReturnType<typeof vi.fn>;
  createPane: ReturnType<typeof vi.fn>;
  invalidateSize: ReturnType<typeof vi.fn>;
  attributionControl: { _attributions: Record<string, number>; _update: () => void };
}

const fixture = () => {
  const map = {
    on: vi.fn(),
    off: vi.fn(),
    invalidateSize: vi.fn(),
    getContainer: vi.fn(() => document.createElement("div")),
    getPane: vi.fn(() => document.createElement("div")),
    createPane: vi.fn(() => {
      const p = document.createElement("div");
      p.classList.add("foliplus-layer-pane");
      return p;
    }),
    // Keyed on the layer object itself. installLeafletGlobals gives L.stamp a
    // fresh id on every call rather than one per layer, so a stamp-keyed map
    // could never match — addLayer and hasLayer would stamp the same layer to
    // different ids and every hide would read back as visible. Real Leaflet
    // stamps once at layer construction.
    _layers: new Map<unknown, unknown>(),
    hasLayer: vi.fn((layer: unknown) => map._layers.has(layer)),
    addLayer: vi.fn((layer: unknown) => {
      map._layers.set(layer, layer);
    }),
    removeLayer: vi.fn((layer: unknown) => {
      map._layers.delete(layer);
    }),
    // Read by `inZoomRange` only when a layer carries a stored zoom range.
    getZoom: vi.fn(() => 5),
    getMinZoom: vi.fn(() => 0),
    getMaxZoom: vi.fn(() => 18),
    _paneRenderers: {},
    attributionControl: { _attributions: {}, _update: vi.fn() },
  } as FixtureMap & Record<string, unknown>;

  const layers = [
    { id: "overlay1", name: "Points", isBase: false, layer: layerFixture() },
    { id: "overlay2", name: "Circles", isBase: false, layer: layerFixture() },
  ];
  // Simulate folium adding the show=True layers to the map before LayerControl
  // attaches: the snapshotAuthorVisible pass reads map.hasLayer to capture the
  // author's declared default, so the fixture must leave the map in the state
  // folium would have left it in.
  for (const li of layers) map._layers.set(li.layer, li.layer);

  const manager = new LayerManager(map, layers);
  manager.ui = new LayerUI(manager);
  manager.attachUI(document.createElement("div"));
  return { map, manager, ui: manager.ui as LayerUI };
};

const allToggle = (ui: LayerUI, group = CONST.GROUP.OVERLAY) =>
  ui.uiContainer.querySelector(
    `${CONST.SEL.TOGGLE_ALL}[data-group="${group}"] [data-role="toggle-all"]`,
  ) as HTMLInputElement;

const makeUi = (
  map: FixtureMap,
  layers: ConstructorParameters<typeof LayerManager>[1],
) => {
  const m = new LayerManager(map, layers);
  m.ui = new LayerUI(m);
  m.attachUI(document.createElement("div"));
  return m;
};

describe("applyVisibility", () => {
  let map: FixtureMap;
  let manager: LayerManager;
  let ui: LayerUI;

  beforeEach(() => {
    window.localStorage.clear();
    installLeafletGlobals();
    window.CONF = { ...window.CONF, name: "LayerControl", locale_code: "en" };
    ({ map, manager, ui } = fixture());
    document.body.innerHTML = "";
  });

  afterEach(() => {
    // Null `ui` first: `manager.ui` is a getter that rebuilds the manager, so
    // touching it inside `destroy()` would resurrect state.
    manager.ui = null;
    manager.destroy();
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  it("hides a visible layer and syncs the row, the flag, and the callback", () => {
    const onToggle = vi.fn();
    const layer = layerFixture();
    manager.registerLayer({
      id: "ov",
      name: "Overlay",
      isBase: false,
      layer,
      onToggle,
    });

    expect(applyVisibility(ui, "ov", false)).toBe(true);

    expect(map.removeLayer).toHaveBeenCalledWith(layer);
    expect(onToggle).toHaveBeenCalledWith(false);
    expect(manager.layerRegistry.get("ov")?.visible).toBe(false);
    expect(map.hasLayer(layer)).toBe(false);

    // The panel row must not disagree with the map: a programmatic hide that
    // leaves the checkbox checked is a UI that lies about state.
    const item = ui.uiContainer.querySelector(
      `[${CONST.DATA.LAYER_ID}="ov"]`,
    ) as HTMLElement;
    const checkbox = item.querySelector('input[type="checkbox"]') as HTMLInputElement;
    expect(checkbox.checked).toBe(false);
    // Untranslated keys fall back to `LayerControl.<key>`, so assert the key
    // rather than the whole string.
    expect(checkbox.title).toContain("select_tooltip");
    expect(item.classList.contains(CONST.CLASSES.ACTIVE)).toBe(false);
  });

  it("re-shows a hidden layer without touching its pane pin", () => {
    // The layer's `options.pane` was set when its surface was materialized, and
    // `map.addLayer` reads it back — so a re-show needs no "re-push" flag any
    // more (the retired `options.paneSet = false`).
    const layer = manager.layerRegistry.get("overlay1")!.layer as {
      options: Record<string, unknown>;
    };
    const paneSetBefore = layer.options.paneSet;
    expect(applyVisibility(ui, "overlay1", false)).toBe(true);
    expect(layer.options.paneSet).toBe(paneSetBefore);

    expect(applyVisibility(ui, "overlay1", true)).toBe(true);
    expect(map.addLayer).toHaveBeenCalledWith(layer);
    expect(layer.options.paneSet).toBe(paneSetBefore);
    expect(manager.layerRegistry.get("overlay1")?.visible).toBe(true);
    expect(map.hasLayer(layer)).toBe(true);
  });

  it("shows a layer that persistence hid on attach", () => {
    // Seed the hidden state the same way the attach sweep would, so the
    // precondition (hidden on the map) is built by the real funnel.
    window.localStorage.setItem(
      CONST.STORAGE.KEY,
      JSON.stringify({
        layers: { overlay1: { visible: false, overrides: ["visible"] } },
      }),
    );
    const seeded = makeUi(map, [
      { id: "overlay1", name: "Points", isBase: false, layer: layerFixture() },
    ]);
    expect(seeded.layerRegistry.get("overlay1")?.visible).toBe(false);
    expect(applyVisibility(seeded.ui as LayerUI, "overlay1", true)).toBe(true);
    expect(seeded.layerRegistry.get("overlay1")?.visible).toBe(true);
    expect(
      seeded.ui.uiContainer.querySelector(
        `[${CONST.DATA.LAYER_ID}="overlay1"] input[type="checkbox"]`,
      )?.checked,
    ).toBe(true);
    seeded.ui = null;
    seeded.destroy();
  });

  it("checking a layer outside its stored zoom range does not put it on the map", () => {
    // Behavior tightening over the old sweep. Checking the box records
    // `intent`; a stored zoom range that excludes the current zoom is a
    // policy suppression. `effectiveShown = intent && policy` is false, so
    // the executor writes nothing and the layer stays off the map until the
    // zoom re-enters the range. The old path applied `visible: true`
    // straight to map membership — added first, retracted on the next sweep.
    // A derived dimension may only suppress, never authorise.
    (map.getZoom as ReturnType<typeof vi.fn>).mockReturnValue(2);
    const layer = manager.layerRegistry.get("overlay1")!.layer as L.Layer;

    // The user hides the layer: it leaves the map and the intent is recorded.
    expect(applyVisibility(ui, "overlay1", false)).toBe(true);
    expect(map.hasLayer(layer)).toBe(false);

    // The user stores a zoom range that excludes the current zoom (2), then
    // checks the box again.
    ui.zoomRangeMap.overlay1 = [3, 12];
    ui.userOverrides.overlay1 = ["zoomRange"];
    (map.addLayer as ReturnType<typeof vi.fn>).mockClear();

    expect(applyVisibility(ui, "overlay1", true)).toBe(true);

    // Intent is recorded: the box is checked and the layer is no longer hidden.
    expect(ui.hiddenIds.has("overlay1")).toBe(false);
    expect(
      ui.uiContainer.querySelector(
        `[${CONST.DATA.LAYER_ID}="overlay1"] input[type="checkbox"]`,
      )?.checked,
    ).toBe(true);
    // ...but policy suppresses the display: no map write at all.
    expect(map.addLayer).not.toHaveBeenCalled();
    expect(map.hasLayer(layer)).toBe(false);
    expect(manager.layerRegistry.get("overlay1")?.visible).toBe(false);
  });

  it("fires the callback instead of touching the map for a canvas-only layer", () => {
    // No Leaflet layer: HeatmapControl's canvas registers onToggle only, so
    // there is nothing to add or remove and the callback is the whole
    // transition.
    const onToggle = vi.fn();
    manager.registerLayer({
      id: "canvas1",
      name: "Heat",
      isBase: false,
      onToggle,
    });

    expect(applyVisibility(ui, "canvas1", false)).toBe(true);
    expect(map.removeLayer).not.toHaveBeenCalled();
    expect(map.addLayer).not.toHaveBeenCalled();
    expect(onToggle).toHaveBeenCalledWith(false);
    expect(manager.layerRegistry.get("canvas1")?.visible).toBe(false);
  });

  it("returns false for an unknown id and reports it the same either way", () => {
    // The id is resolved before the panel check, so a typo does not read as a
    // missing-panel no-op.
    expect(applyVisibility(ui, "nope", false)).toBe(false);
    const bare = new LayerManager(map, []);
    expect(bare.setVisible("nope", false)).toBe(false);
    expect(map.addLayer).not.toHaveBeenCalled();
    expect(map.removeLayer).not.toHaveBeenCalled();
  });

  it("still applies the transition when the row is no longer on the panel", () => {
    // `setVisible` reaches in by id, so the row may be absent — a detached
    // panel, or one that has not rendered this layer yet. The map write and the
    // persisted choice must not depend on the row being there.
    const layer = layerFixture();
    manager.registerLayer({ id: "ov", name: "Overlay", isBase: false, layer });
    const row = ui.uiContainer.querySelector<HTMLElement>(
      `[${CONST.DATA.LAYER_ID}="ov"]`,
    );
    expect(row).not.toBeNull();
    row!.remove();

    expect(applyVisibility(ui, "ov", false)).toBe(true);

    expect(map.removeLayer).toHaveBeenCalledWith(layer);
    expect(ui.hiddenIds.has("ov")).toBe(true);
    expect(manager.layerRegistry.get("ov")?.visible).toBe(false);
  });

  it("persists the hidden set so the choice survives a reload", () => {
    expect(applyVisibility(ui, "overlay1", false)).toBe(true);
    // The write is debounced; flush the funnel and read the key back.
    manager.persistence.flushAll();
    const stored = window.localStorage.getItem(CONST.STORAGE.KEY);
    expect(stored).not.toBeNull();
    expect(JSON.parse(stored!).layers.overlay1).toEqual({
      visible: false,
      overrides: ["visible"],
    });

    // A fresh manager over the same storage replays the hide rather than
    // restoring the author's default.
    const fresh = makeUi(map, [
      { id: "overlay1", name: "Points", isBase: false, layer: layerFixture() },
    ]);
    expect(fresh.layerRegistry.get("overlay1")?.visible).toBe(false);
    fresh.ui = null;
    fresh.destroy();
  });

  it("keeps the entry when a layer is shown again, but records visible:true", () => {
    applyVisibility(ui, "overlay1", false);
    applyVisibility(ui, "overlay1", true);
    manager.persistence.flushAll();

    // Old assertion: the persisted hidden set was `[]` — "hidden" was an
    // absolute list, so re-showing deleted the id. The record cannot express
    // "the user showed it" versus "the author declared show=True", and the
    // entry's absence *is* the author's default. Keeping the id therefore
    // means re-showing an author-declared show=False layer would no longer be
    // undone on reload, which is exactly the point. The value records the
    // choice instead.
    const stored = window.localStorage.getItem(CONST.STORAGE.KEY);
    expect(JSON.parse(stored!).layers.overlay1).toEqual({
      visible: true,
      overrides: ["visible"],
    });

    const fresh = makeUi(map, [
      { id: "overlay1", name: "Points", isBase: false, layer: layerFixture() },
    ]);
    expect(fresh.layerRegistry.get("overlay1")?.visible).toBe(true);
    fresh.ui = null;
    fresh.destroy();
  });

  it("treats a base layer like an overlay, map membership included", () => {
    const layer = layerFixture();
    const fresh = makeUi(map, []);
    const ui2 = fresh.ui as LayerUI;
    // RegisterLayer adds the layer to the map (the constructor data path
    // does not), which is the precondition this test asserts against.
    fresh.registerLayer({
      id: "base1",
      name: "OSM",
      isBase: true,
      layer,
      paneName: "tilePane",
    });

    expect(applyVisibility(ui2, "base1", false)).toBe(true);
    expect(map.removeLayer).toHaveBeenCalledWith(layer);
    expect(map.hasLayer(layer)).toBe(false);
    expect(fresh.layerRegistry.get("base1")?.visible).toBe(false);
    expect(
      fresh.ui.uiContainer.querySelector(
        `[${CONST.DATA.LAYER_ID}="base1"] input[type="checkbox"]`,
      )?.checked,
    ).toBe(false);

    expect(applyVisibility(ui2, "base1", true)).toBe(true);
    expect(map.hasLayer(layer)).toBe(true);
    fresh.ui = null;
    fresh.destroy();
  });

  it("fires the callback only on a change, not on a repeated set", () => {
    // A programmatic caller may re-set the same value; the executor diffs
    // against its own last write, so a no-op set is a no-op — including for
    // the `onToggle` callback. The callback is the canvas layer's signal that
    // its own `HIDDEN` class needs toggling; firing it on a value it already
    // has would be redundant work the canvas would just ignore.
    const onToggle = vi.fn();
    const layer = layerFixture();
    manager.registerLayer({
      id: "repeat",
      name: "Repeat",
      isBase: false,
      layer,
      onToggle,
    });

    expect(applyVisibility(ui, "repeat", false)).toBe(true);
    expect(applyVisibility(ui, "repeat", false)).toBe(true);
    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(onToggle).toHaveBeenNthCalledWith(1, false);
    expect(map.removeLayer).toHaveBeenCalledWith(layer);
  });

  describe("toggle-all tri-state", () => {
    it("is false while the group is fully visible", () => {
      const all = allToggle(ui);
      expect(all.checked).toBe(true);
      expect(all.indeterminate).toBe(false);
    });

    it("is true when a group is partially hidden", () => {
      applyVisibility(ui, "overlay1", false);
      const all = allToggle(ui);
      expect(all.checked).toBe(false);
      expect(all.indeterminate).toBe(true);
      expect(all.title).toContain("toggle_all_deselect_tooltip");
    });

    it("is false when nothing in the group is checked", () => {
      const only = makeUi(map, [
        { id: "only", name: "Only", isBase: false, layer: layerFixture() },
      ]);
      const all = allToggle(only.ui as LayerUI);
      expect(all.checked).toBe(true);
      expect(all.indeterminate).toBe(false);

      applyVisibility(only.ui as LayerUI, "only", false);
      expect(all.checked).toBe(false);
      // `checkedCount === 0` makes `noneChecked` true, so `!allChecked &&
      // !noneChecked` is false. Nothing checked is not a partial state. Pinned
      // so a change to the tri-state rule shows up here.
      expect(all.indeterminate).toBe(false);
      only.ui = null;
      only.destroy();
    });
  });
});

// ---------------------------------------------------------------------------
// Manager façade
//
// `LayerManager.setVisible` is the `LayerAPI` entry point. It adds only the
// pre-flight checks — id resolution, panel presence, the registry warning —
// and then delegates, so a layer can be controlled from outside the panel.
// ---------------------------------------------------------------------------

describe("LayerManager.setVisible", () => {
  let map: FixtureMap;
  let manager: LayerManager;
  let ui: LayerUI;

  beforeEach(() => {
    window.localStorage.clear();
    installLeafletGlobals();
    window.CONF = { ...window.CONF, name: "LayerControl", locale_code: "en" };
    ({ map, manager, ui } = fixture());
    document.body.innerHTML = "";
  });

  afterEach(() => {
    manager.ui = null;
    manager.destroy();
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  it("delegates the whole transition and reports the id it resolved", () => {
    const onToggle = vi.fn();
    const layer = layerFixture();
    manager.registerLayer({
      id: "ov",
      name: "Overlay",
      isBase: false,
      layer,
      onToggle,
    });

    expect(manager.setVisible("ov", false)).toBe(true);

    expect(map.removeLayer).toHaveBeenCalledWith(layer);
    expect(onToggle).toHaveBeenCalledWith(false);
    expect(manager.layerRegistry.get("ov")?.visible).toBe(false);
    expect(map.hasLayer(layer)).toBe(false);
    expect(
      ui.uiContainer.querySelector(
        `[${CONST.DATA.LAYER_ID}="ov"] input[type="checkbox"]`,
      )?.checked,
    ).toBe(false);
  });

  it("returns false for an unknown id before checking for a panel", () => {
    // The id is resolved first, so a typo reports the same with or without a
    // panel attached — it cannot read as a missing-panel no-op.
    expect(manager.setVisible("nope", false)).toBe(false);
    const bare = new LayerManager(map, []);
    expect(bare.setVisible("nope", false)).toBe(false);
    expect(map.addLayer).not.toHaveBeenCalled();
    expect(map.removeLayer).not.toHaveBeenCalled();
  });

  it("refuses before the panel is attached rather than no-op-ing", () => {
    const bare = new LayerManager(map, [
      { id: "overlay1", name: "Points", isBase: false, layer: layerFixture() },
    ]);
    // No ui: nothing to sync the row with and no hidden-set funnel to write,
    // so a success return would be a lie the caller cannot detect.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(bare.setVisible("overlay1", false)).toBe(false);
    expect(warn).toHaveBeenCalled();
    expect(bare.layerRegistry.get("overlay1")?.visible).toBe(true);
    expect(map.addLayer).not.toHaveBeenCalled();
    expect(map.removeLayer).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// Checkbox path
//
// `handleChange` is the original caller of the shared transition, and it was
// the only one when the transition had a body. These cases pin that the
// delegation still takes the same path.
// ---------------------------------------------------------------------------

describe("LayerUI.handleChange", () => {
  const change = (ui: LayerUI, id: string, checked: boolean) => {
    const cb = ui.uiContainer.querySelector(
      `[${CONST.DATA.LAYER_ID}="${id}"] input[type="checkbox"]`,
    ) as HTMLInputElement | null;
    if (!cb) throw new Error(`no checkbox for ${id}`);
    cb.checked = checked;
    ui.handleChange({ target: cb } as Event);
  };

  let map: FixtureMap;
  let manager: LayerManager;
  let ui: LayerUI;

  beforeEach(() => {
    window.localStorage.clear();
    installLeafletGlobals();
    window.CONF = { ...window.CONF, name: "LayerControl", locale_code: "en" };
    ({ map, manager, ui } = fixture());
    document.body.innerHTML = "";
  });

  afterEach(() => {
    manager.ui = null;
    manager.destroy();
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  it("hides the layer the checkbox is off, through the map and the flag", () => {
    const layer = manager.layerRegistry.get("overlay1")!.layer as { options: object };
    change(ui, "overlay1", false);

    expect(map.removeLayer).toHaveBeenCalledWith(layer);
    expect(manager.layerRegistry.get("overlay1")?.visible).toBe(false);
    expect(map.hasLayer(layer)).toBe(false);
  });

  it("re-shows a hidden layer without touching its pane pin", () => {
    const layer = manager.layerRegistry.get("overlay1")!.layer as {
      options: Record<string, unknown>;
    };
    const paneSetBefore = layer.options.paneSet;
    change(ui, "overlay1", false);
    expect(layer.options.paneSet).toBe(paneSetBefore);

    change(ui, "overlay1", true);
    expect(map.addLayer).toHaveBeenCalledWith(layer);
    expect(layer.options.paneSet).toBe(paneSetBefore);
    expect(manager.layerRegistry.get("overlay1")?.visible).toBe(true);
  });

  it("ignores a checkbox with no row index rather than toggling the first layer", () => {
    const stray = document.createElement("input");
    stray.type = "checkbox";
    stray.checked = false;
    ui.handleChange({ target: stray } as Event);

    expect(map.addLayer).not.toHaveBeenCalled();
    expect(map.removeLayer).not.toHaveBeenCalled();
    expect(manager.layerRegistry.get("overlay1")?.visible).toBe(true);
  });

  it("fires the callback only, for a canvas-only layer", () => {
    const onToggle = vi.fn();
    manager.registerLayer({
      id: "canvas1",
      name: "Heat",
      isBase: false,
      onToggle,
    });
    change(ui, "canvas1", false);

    expect(onToggle).toHaveBeenCalledWith(false);
    expect(map.addLayer).not.toHaveBeenCalled();
    expect(map.removeLayer).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// DOM order ≠ registry order
//
// A late registration lands where its stored slot puts it, so the panel's row
// order can diverge from the registry's. These cases pin that the checkbox and
// group-toggle paths still act on the layer a row owns, not on whatever
// happens to sit at that DOM index.
// ---------------------------------------------------------------------------

describe("DOM order diverges from registry order", () => {
  const layerFixture = () => ({ options: {} as Record<string, unknown> });

  // The shared initFixture cannot serve this suite: its map.hasLayer always
  // answers true and addLayer/removeLayer are no-ops, while handleChange and
  // initLayerItem here decide each row's checkbox from real map membership
  // (and the pane touches need createPane + _paneRenderers). Keep the map
  // local so visibility transitions are asserted against actual state.
  const fixture3 = () => {
    const map = {
      on: vi.fn(),
      off: vi.fn(),
      invalidateSize: vi.fn(),
      getContainer: vi.fn(() => document.createElement("div")),
      getPane: vi.fn(() => document.createElement("div")),
      createPane: vi.fn(() => {
        const p = document.createElement("div");
        p.classList.add("foliplus-layer-pane");
        return p;
      }),
      _layers: new Map<unknown, unknown>(),
      hasLayer: vi.fn((layer: unknown) => map._layers.has(layer)),
      addLayer: vi.fn((layer: unknown) => {
        map._layers.set(layer, layer);
      }),
      removeLayer: vi.fn((layer: unknown) => {
        map._layers.delete(layer);
      }),
      _paneRenderers: {},
      attributionControl: { _attributions: {}, _update: vi.fn() },
    } as FixtureMap & Record<string, unknown>;

    const layers = [
      { id: "A", name: "Layer A", isBase: false, layer: layerFixture() },
      { id: "B", name: "Layer B", isBase: false, layer: layerFixture() },
      { id: "C", name: "Layer C", isBase: false, layer: layerFixture() },
    ];
    // Same folium simulation as fixture(): leave the map with the layers that
    // show=True would have added, so snapshotAuthorVisible reads true.
    for (const li of layers) map._layers.set(li.layer, li.layer);

    const manager = new LayerManager(map, layers);
    manager.ui = new LayerUI(manager);
    manager.attachUI(document.createElement("div"));
    return { map, manager, ui: manager.ui as LayerUI };
  };

  /** Rearrange the overlay rows so the DOM order is C-A-B (registry is A-B-C),
   *  then write dataset.index from DOM position: the stale offset the old
   *  positional lookup would have read. */
  const scrambleDomOrder = (ui: LayerUI) => {
    const rows = Array.from(
      ui.uiContainer.querySelectorAll<HTMLElement>(
        `${CONST.SEL.LAYER_ITEM}[data-layer-type="${CONST.GROUP.OVERLAY}"]`,
      ),
    );
    expect(rows.length).toBe(3);
    const container = rows[0].parentNode!;
    container.insertBefore(rows[2], rows[0]); // A,B,C -> C,A,B
    // dataset.index now carries DOM position while the registry is still A-B-C:
    // the stale offset the old positional lookup would have read. Simulating it
    // lets the assertion distinguish "looked up by id" from "looked up by
    // (now wrong) position". Re-query after the move so the loop sees DOM
    // order, not the pre-scramble array order.
    const reordered = Array.from(
      ui.uiContainer.querySelectorAll<HTMLElement>(
        `${CONST.SEL.LAYER_ITEM}[data-layer-type="${CONST.GROUP.OVERLAY}"]`,
      ),
    );
    reordered.forEach((row, i) => {
      row.dataset.index = String(i);
      const cb = row.querySelector('input[type="checkbox"]') as HTMLInputElement | null;
      if (cb) cb.dataset.index = String(i);
    });
  };

  let map: FixtureMap;
  let manager: LayerManager;
  let ui: LayerUI;

  beforeEach(() => {
    window.localStorage.clear();
    installLeafletGlobals();
    window.CONF = { ...window.CONF, name: "LayerControl", locale_code: "en" };
    ({ map, manager, ui } = fixture3());
    document.body.innerHTML = "";
  });

  afterEach(() => {
    manager.ui = null;
    manager.destroy();
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  it("handleChange toggles the layer its row owns, not the one at that DOM index", () => {
    scrambleDomOrder(ui);
    // After scrambling, the second overlay row in the DOM is A (registry idx 0),
    // but its dataset.index is "1" (DOM position). The old handler would read
    // that index and toggle B instead of A.
    const rows = Array.from(
      ui.uiContainer.querySelectorAll<HTMLElement>(
        `${CONST.SEL.LAYER_ITEM}[data-layer-type="${CONST.GROUP.OVERLAY}"]`,
      ),
    );
    const rowA = rows[1];
    expect(rowA.getAttribute(CONST.DATA.LAYER_ID)).toBe("A");
    expect(rowA.dataset.index).toBe("1");
    const cb = rowA.querySelector('input[type="checkbox"]') as HTMLInputElement;
    const layerA = manager.layerRegistry.get("A")!.layer as { options: object };

    cb.checked = false;
    ui.handleChange({ target: cb } as Event);

    expect(manager.layerRegistry.get("A")?.visible).toBe(false);
    expect(map.removeLayer).toHaveBeenCalledWith(layerA);
    // B must not have been toggled —the old handler would have read index 1
    // and hit B (registry idx 1) instead.
    expect(manager.layerRegistry.get("B")?.visible).toBe(true);
    expect(manager.layerRegistry.get("C")?.visible).toBe(true);
  });

  it("toggleAll hits every layer by id, not by DOM position", () => {
    scrambleDomOrder(ui);
    // The DOM order is C-A-B but toggleAll must hide all three regardless.
    ui.toggleAll(CONST.GROUP.OVERLAY, false);

    expect(manager.layerRegistry.get("A")?.visible).toBe(false);
    expect(manager.layerRegistry.get("B")?.visible).toBe(false);
    expect(manager.layerRegistry.get("C")?.visible).toBe(false);
  });

  it("toggleAll skips a row that names no registered layer", () => {
    // A row left behind without a data-layer-id: it names no layer, so it must
    // be skipped rather than dragging a neighbour into the sweep.
    const orphan = document.createElement("div");
    orphan.className = CONST.CLASSES.LAYER_ITEM;
    const box = document.createElement("input");
    box.type = "checkbox";
    box.checked = true;
    orphan.appendChild(box);
    ui.uiContainer.appendChild(orphan);

    ui.toggleAll(CONST.GROUP.OVERLAY, false);

    expect(box.checked).toBe(true);
    expect(manager.layerRegistry.get("A")?.visible).toBe(false);
    expect(manager.layerRegistry.get("B")?.visible).toBe(false);
    expect(manager.layerRegistry.get("C")?.visible).toBe(false);
  });

  it("handleChange takes the color branch for the basemap input, never a layer id", () => {
    scrambleDomOrder(ui);
    const colorInput = ui.uiContainer.querySelector<HTMLInputElement>(
      `.${CONST.CLASSES.COLOR_INPUT}`,
    )!;
    colorInput.value = "#00ff00";

    handleChange(ui, { target: colorInput } as Event);

    expect(ui.currentColor).toBe("#00ff00");
    expect(ui.isColorActive).toBe(true);
    // The color row is keyed by its class, so no data-layer-id lookup runs and
    // the scrambled overlay rows are left untouched.
    expect(manager.layerRegistry.get("A")?.visible).toBe(true);
    expect(manager.layerRegistry.get("B")?.visible).toBe(true);
    expect(manager.layerRegistry.get("C")?.visible).toBe(true);
  });

  it("handleInput repaints the basemap while the color picker is being used", () => {
    const colorInput = ui.uiContainer.querySelector<HTMLInputElement>(
      `.${CONST.CLASSES.COLOR_INPUT}`,
    )!;
    colorInput.value = "#0000ff";

    handleInput(ui, { target: colorInput } as Event);

    expect(ui.currentColor).toBe("#0000ff");
    expect(ui.isColorActive).toBe(true);
  });

  it("toggleAll does not activate the colour layer when the base group is cleared", () => {
    // First-class basemaps: the colour layer is one row like any other, not a
    // stand-in for the absence of a base. Clearing the base group leaves the
    // colour's own checkbox untouched (intent-only invariant).
    ui.toggleAll(CONST.GROUP.BASE, false);

    expect(ui.isColorActive).toBe(false);
  });
});

describe("toggleAll base group", () => {
  // The base group is the one case where getLayerItems also matches the color
  // row — it carries the layer-item class and data-layer-type="base" — so a
  // base sweep walks a row that holds a color input instead of a checkbox.
  const baseFixture = () => {
    const map = {
      on: vi.fn(),
      off: vi.fn(),
      invalidateSize: vi.fn(),
      getContainer: vi.fn(() => document.createElement("div")),
      getPane: vi.fn(() => document.createElement("div")),
      createPane: vi.fn(() => {
        const p = document.createElement("div");
        p.classList.add("foliplus-layer-pane");
        return p;
      }),
      _layers: new Map<unknown, unknown>(),
      hasLayer: vi.fn((layer: unknown) => map._layers.has(layer)),
      addLayer: vi.fn((layer: unknown) => {
        map._layers.set(layer, layer);
      }),
      removeLayer: vi.fn((layer: unknown) => {
        map._layers.delete(layer);
      }),
      _paneRenderers: {},
      attributionControl: { _attributions: {}, _update: vi.fn() },
    } as FixtureMap & Record<string, unknown>;

    const layers: ConstructorParameters<typeof LayerManager>[1] = [
      { id: "B1", name: "Base 1", isBase: true, layer: layerFixture() },
      // Canvas-style base: onToggle only, no Leaflet layer to add or remove.
      { id: "B2", name: "Base 2", isBase: true, onToggle: vi.fn() },
    ];
    const manager = new LayerManager(map, layers);
    manager.ui = new LayerUI(manager);
    manager.attachUI(document.createElement("div"));
    return { map, manager, ui: manager.ui as LayerUI };
  };

  let map: FixtureMap;
  let manager: LayerManager;
  let ui: LayerUI;

  beforeEach(() => {
    window.localStorage.clear();
    installLeafletGlobals();
    window.CONF = { ...window.CONF, name: "LayerControl", locale_code: "en" };
    ({ map, manager, ui } = baseFixture());
    document.body.innerHTML = "";
  });

  afterEach(() => {
    manager.ui = null;
    manager.destroy();
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  it("skips a row that carries no checkbox instead of dragging it into the sweep", () => {
    // The base query matches the color row too, and its only input is a color
    // picker. It is the row that has no checkbox — a bare null check is what
    // keeps the sweep from typing the whole panel row.
    const bare = document.createElement("div");
    bare.className = `${CONST.CLASSES.LAYER_ITEM} ${CONST.CLASSES.COLOR_ITEM}`;
    bare.setAttribute("data-layer-type", CONST.GROUP.BASE);
    ui.uiContainer.appendChild(bare);

    expect(() => toggleAll(ui, CONST.GROUP.BASE, true)).not.toThrow();
    expect(bare.querySelector("input")).toBeNull();
    expect(ui.hiddenIds.size).toBe(0);
  });

  it("runs every branch of the sweep: real layer, canvas-only base, and the callback", () => {
    const onToggle = manager.layerRegistry.get("B2")!.onToggle!;

    // Hide both first so the sweep has a visible→shown transition to fire.
    toggleAll(ui, CONST.GROUP.BASE, false);

    // Clear the mocks so we only count the un-hide call.
    onToggle.mockClear();
    map.addLayer.mockClear();
    map.removeLayer.mockClear();

    toggleAll(ui, CONST.GROUP.BASE, true);

    expect(map.addLayer).toHaveBeenCalledWith(manager.layerRegistry.get("B1")!.layer);
    // B2 has no Leaflet layer: the callback is its whole transition.
    expect(onToggle).toHaveBeenCalledWith(true);
    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(map.removeLayer).not.toHaveBeenCalled();
    expect(manager.layerRegistry.get("B1")?.visible).toBe(true);
    expect(manager.layerRegistry.get("B2")?.visible).toBe(true);
  });

  it("does not touch the colour layer when the base group is toggled", () => {
    // The colour layer coexists with tile basemaps: toggling the base group
    // must not hide or show the colour — each carries its own checkbox and
    // its own visibility.
    ui.toggleAll(CONST.GROUP.BASE, false);
    expect(ui.isColorActive).toBe(false);

    ui.toggleAll(CONST.GROUP.BASE, true);
    expect(ui.isColorActive).toBe(false);
  });
});

describe("unit helpers", () => {
  const makeUi = (): LayerUI => {
    const uiContainer = document.createElement("div");
    uiContainer.innerHTML = `
    <div class="foliplus-layer-item" data-layer-type="base"></div>
    <div class="foliplus-layer-item" data-layer-type="overlay">
      <input type="checkbox" data-index="0" />
    </div>
    <div class="foliplus-color-layer-item"></div>
  `;
    return { uiContainer } as unknown as LayerUI;
  };

  it("getLayerItems returns only base rows for the base group", () => {
    const ui = makeUi();
    const items = getLayerItems(ui, CONST.GROUP.BASE);
    expect(items.length).toBe(1);
    expect(items[0].getAttribute("data-layer-type")).toBe("base");
  });

  it("getLayerItems returns overlay rows and excludes the color basemap", () => {
    const ui = makeUi();
    const items = getLayerItems(ui, CONST.GROUP.OVERLAY);
    expect(items.length).toBe(1);
    expect(items[0].getAttribute("data-layer-type")).toBe("overlay");
  });

  // syncVisibility is gone: the executor's visible op is
  // the single writer of `layerInfo.visible`, so there is no mirror helper
  // to test.

  it("handleInput is a no-op for non-color inputs", () => {
    const ui = makeUi();
    const input = ui.uiContainer.querySelector(
      'input[type="checkbox"]',
    ) as HTMLInputElement;
    expect(() => handleInput(ui, { target: input } as unknown as Event)).not.toThrow();
  });

  it("toggleAll sets the row tooltips for both states", () => {
    const { ui } = initFixture();
    // Only overlay checkboxes: the colour basemap is a base row and is not
    // toggled by overlay group operations.
    const boxes = () =>
      Array.from(
        ui.uiContainer.querySelectorAll<HTMLInputElement>(
          `.${CONST.CLASSES.LAYER_ITEM}:not(${CONST.SEL.COLOR_ITEM}) input[type="checkbox"]`,
        ),
      );

    ui.toggleAll(CONST.GROUP.OVERLAY, true);
    expect(boxes().length).toBeGreaterThan(0);
    boxes().forEach(b => expect(b.title).toContain("deselect_tooltip"));

    ui.toggleAll(CONST.GROUP.OVERLAY, false);
    boxes().forEach(b => expect(b.title).toContain("select_tooltip"));
  });

  it("syncToggleAll bails when the group header has no toggle-all input", () => {
    // The header row resolves but carries no [data-role="toggle-all"] input:
    // there is nothing to paint, so the sync must bail rather than write into a
    // null element.
    const uiContainer = document.createElement("div");
    uiContainer.innerHTML = `<div class="foliplus-layer-toggle-all" data-group="${CONST.GROUP.OVERLAY}"></div>`;
    const ui = {
      uiContainer,
      m: { layerRegistry: { get: () => undefined } },
      T: (k: string) => k,
    } as unknown as LayerUI;

    expect(() => syncToggleAll(ui, CONST.GROUP.OVERLAY)).not.toThrow();
  });
});
