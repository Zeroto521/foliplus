import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as CONST from "#foliplus/LayerControl/const.js";
import { LayerManager } from "#foliplus/LayerControl/manager.js";
import { LayerUI } from "#foliplus/LayerControl/ui/index.js";
import {
  applyVisibility,
  getLayerItems,
  handleChange,
  handleInput,
  syncVisibility,
  toggleAll,
} from "#foliplus/LayerControl/ui/visibility.js";
import type { LayerInfo } from "#foliplus/core/layer/index.js";
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
    _paneRenderers: {},
    attributionControl: { _attributions: {}, _update: vi.fn() },
  } as FixtureMap & Record<string, unknown>;

  const manager = new LayerManager(map, [
    { id: "overlay1", name: "Points", isBase: false, layer: layerFixture() },
    { id: "overlay2", name: "Circles", isBase: false, layer: layerFixture() },
  ]);
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
    expect(applyVisibility(ui, "overlay1", false)).toBe(true);
    expect(layer.options.paneSet).toBeUndefined();

    expect(applyVisibility(ui, "overlay1", true)).toBe(true);
    expect(map.addLayer).toHaveBeenCalledWith(layer);
    expect(layer.options.paneSet).toBeUndefined();
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
    const fresh = makeUi(map, [
      { id: "base1", name: "OSM", isBase: true, layer, paneName: "tilePane" },
    ]);
    const ui2 = fresh.ui as LayerUI;

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

  it("fires the callback on every call, not only on change", () => {
    // A programmatic caller may re-set the same value; unlike the checkbox,
    // which the browser only fires on a flip, this path takes the transition
    // again. Documenting it so a dedupe added later is a deliberate change.
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
    expect(onToggle).toHaveBeenCalledTimes(2);
    expect(onToggle).toHaveBeenNthCalledWith(1, false);
    expect(onToggle).toHaveBeenNthCalledWith(2, false);
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
    change(ui, "overlay1", false);
    expect(layer.options.paneSet).toBeUndefined();

    change(ui, "overlay1", true);
    expect(map.addLayer).toHaveBeenCalledWith(layer);
    expect(layer.options.paneSet).toBeUndefined();
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

  it("syncVisibility falls back when the Leaflet layer is absent", () => {
    const layerInfo = { id: "a", visible: false } as LayerInfo;
    expect(syncVisibility(makeUi(), layerInfo, null, true)).toBe(true);
    expect(layerInfo.visible).toBe(true);
    expect(syncVisibility(makeUi(), layerInfo, null, false)).toBe(false);
    expect(layerInfo.visible).toBe(false);
  });

  it("handleInput is a no-op for non-color inputs", () => {
    const ui = makeUi();
    const input = ui.uiContainer.querySelector(
      'input[type="checkbox"]',
    ) as HTMLInputElement;
    expect(() => handleInput(ui, { target: input } as unknown as Event)).not.toThrow();
  });

  it("toggleAll sets the row tooltips for both states", () => {
    const { ui } = initFixture();
    const boxes = () =>
      Array.from(
        ui.uiContainer.querySelectorAll<HTMLInputElement>(
          `.${CONST.CLASSES.LAYER_ITEM} input[type="checkbox"]`,
        ),
      );

    ui.toggleAll(CONST.GROUP.OVERLAY, true);
    expect(boxes().length).toBeGreaterThan(0);
    boxes().forEach(b => expect(b.title).toContain("deselect_tooltip"));

    ui.toggleAll(CONST.GROUP.OVERLAY, false);
    boxes().forEach(b => expect(b.title).toContain("select_tooltip"));
  });
});
