import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as CONST from "#foliplus/LayerControl/const.js";
import { LayerManager } from "#foliplus/LayerControl/manager.js";
import { LayerUI } from "#foliplus/LayerControl/ui.js";

// ═══════════════════════════════════════════════════════════════════════════
// Fold via keyboard.
//
// The chevron button lives inside the toggle-all row, so focus on it resolves
// up to that row. Enter/Space over it must fold the group — not flip the
// row's select-all checkbox, which is what resolveActiveIdx() +
// toggleFocusedLayer() do when the button is not special-cased.
// ═══════════════════════════════════════════════════════════════════════════

const makePane = () => {
  const el = document.createElement("div");
  el.style.zIndex = "0";
  return el;
};

/** True when every group child row carries the folded class, i.e. the group is
 *  folded. The toggle-all row itself never gets this class — only its
 *  children do — so the fold assertion goes on them. */
const allFolded = (rows: HTMLElement[]) =>
  rows.length > 0 &&
  rows.every(el => el.classList.contains(CONST.CLASSES.GROUP_FOLDED));

/** Attach a LayerUI whose panel contains a real toggle-all row, and return the
 *  row plus its chevron button. */
const attachWithGroup = () => {
  window.CONF.name = "LayerControl";
  window.CONF.locale_code = "en";
  localStorage.clear();

  // manager.enforceOrder() instanceof-checks L.GridLayer / L.TileLayer.
  class TileLayerClass {
    options = { attribution: "© OpenStreetMap" };
    setZIndex = vi.fn();
  }
  class GridLayerClass {
    options = {};
  }
  class Path {
    options = {};
  }
  window.L.TileLayer = TileLayerClass;
  window.L.GridLayer = GridLayerClass;
  window.L.Renderer = class {};
  window.L.layerGroup = vi.fn(() => ({
    addLayer: vi.fn(),
    removeLayer: vi.fn(),
    hasLayer: vi.fn(() => false),
    getLayers: vi.fn(() => []),
    clearLayers: vi.fn(),
    options: {},
  }));
  window.L.Path = Path;
  window.L.Polygon = class {
    options = {};
  };
  window.L.Polyline = class {
    options = {};
  };
  window.L.Marker = class {};
  window.L.CircleMarker = class {
    constructor(_l: any, _o: any) {}
  };
  window.L.stamp = (() => {
    let id = 0;
    return vi.fn(() => ++id);
  })();
  window.L.svg = vi.fn(() => ({ addTo: vi.fn() }));
  window.L.polygon = vi.fn(
    (rings: any, opts: any) => ({ options: opts, _rings: rings }) as any,
  );
  window.L.rectangle = vi.fn(
    (_b: any, opts: any) =>
      ({
        _options: opts,
        getClassName: () => opts?.className ?? "",
        on: vi.fn(),
        eachLayer: vi.fn(),
      }) as any,
  );

  const container = document.createElement("div");
  document.body.appendChild(container);

  const polyBounds = {
    isValid: vi.fn(() => true),
    getSouthWest: () => ({ lat: 30, lng: 100 }),
    getNorthEast: () => ({ lat: 40, lng: 110 }),
  };
  const polygonLayer = {
    options: {},
    eachLayer: vi.fn(),
    getBounds: vi.fn(() => polyBounds),
  };

  const map: any = {
    on: vi.fn(),
    off: vi.fn(),
    eachLayer: vi.fn(),
    invalidateSize: vi.fn(),
    hasLayer: vi.fn(() => true),
    addLayer: vi.fn(),
    removeLayer: vi.fn(),
    fitBounds: vi.fn(),
    flyTo: vi.fn(),
    getZoom: vi.fn(() => 5),
    getMaxZoom: vi.fn(() => 18),
    getBounds: vi.fn(() => {
      const view = {
        pad: vi.fn(() => view),
        getSouthWest: () => ({ lat: 20, lng: 90 }),
        getNorthWest: () => ({ lat: 50, lng: 90 }),
        getNorthEast: () => ({ lat: 50, lng: 120 }),
        getSouthEast: () => ({ lat: 20, lng: 120 }),
      };
      return view;
    }),
    getContainer: vi.fn(() => container),
    getPane: vi.fn(() => makePane()),
    createPane: vi.fn(() => {
      const p = makePane();
      p.classList.add("foliplus-layer-pane");
      return p;
    }),
    _container: container,
    _layers: {},
    attributionControl: { _attributions: {}, _update: vi.fn() },
    foliplus: { showHint: vi.fn(), hideHint: vi.fn() },
  };

  // Groups are fixed to overlay/base; overlay1 + overlay2 share the overlay
  // group, which is the toggle-all row under test.
  const manager = new LayerManager(map, [
    { id: "overlay1", name: "Polygons", isBase: false, layer: polygonLayer },
    { id: "overlay2", name: "Circles", isBase: false, layer: polygonLayer },
    {
      id: "base1",
      name: "OSM",
      isBase: true,
      layer: new (window.L.TileLayer as any)(),
      paneName: "tilePane",
    },
  ]);
  manager.enforceOrder();
  manager.ui = new LayerUI(manager);

  vi.useFakeTimers();
  manager.attachUI(container);
  const ui = manager.ui!;
  vi.advanceTimersByTime(350);
  vi.useRealTimers();

  const row = ui.uiContainer.querySelector(
    `.${CONST.CLASSES.TOGGLE_ALL}[data-group="${CONST.GROUP.OVERLAY}"]`,
  ) as HTMLElement;
  const foldBtn = row.querySelector(`.${CONST.CLASSES.FOLD_BTN}`) as HTMLElement;
  const children = () =>
    Array.from(
      ui.uiContainer.querySelectorAll<HTMLElement>(
        `${CONST.SEL.LAYER_ITEM}[data-layer-type="${CONST.GROUP.OVERLAY}"]`,
      ),
    );

  return { ui, manager, row, foldBtn, children };
};

const pressKey = (el: HTMLElement, key: string) => {
  el.focus();
  el.dispatchEvent(
    new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key }),
  );
};

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  document.body.innerHTML = "";
  vi.clearAllMocks();
  vi.useRealTimers();
  window.localStorage.clear();
});

describe("fold group via keyboard (chevron button)", () => {
  it("group starts expanded: both children are in the panel", () => {
    const { children } = attachWithGroup();
    expect(children()).toHaveLength(2);
    expect(allFolded(children())).toBe(false);
  });

  it("Enter on the chevron folds the group and hides its children", () => {
    const { ui, foldBtn, children } = attachWithGroup();
    const before = children().length;

    pressKey(foldBtn, "Enter");

    expect(allFolded(children())).toBe(true);
    expect(before).toBe(2);
    expect(ui.foldedGroups.has(CONST.GROUP.OVERLAY)).toBe(true);
  });

  it("Space on the chevron folds too, and Enter again unfolds", () => {
    const { ui, foldBtn, children } = attachWithGroup();

    pressKey(foldBtn, " ");
    expect(allFolded(children())).toBe(true);

    // Fold rebuilds the panel; re-fetch the button on the rebuilt row.
    const newRow = ui.uiContainer.querySelector(
      `.${CONST.CLASSES.TOGGLE_ALL}[data-group="${CONST.GROUP.OVERLAY}"]`,
    ) as HTMLElement;
    const newBtn = newRow.querySelector(`.${CONST.CLASSES.FOLD_BTN}`) as HTMLElement;
    pressKey(newBtn, "Enter");

    expect(allFolded(children())).toBe(false);
    expect(ui.foldedGroups.has(CONST.GROUP.OVERLAY)).toBe(false);
  });

  it("Enter on the chevron does NOT flip the select-all checkbox", () => {
    const { foldBtn, children } = attachWithGroup();
    const childBoxes = () =>
      Array.from(
        children().map(
          el => el.querySelector('input[type="checkbox"]') as HTMLInputElement,
        ),
      ).filter(Boolean);

    // All children start checked.
    expect(childBoxes().every(cb => cb.checked)).toBe(true);

    pressKey(foldBtn, "Enter");
    expect(allFolded(children())).toBe(true);

    // Unfold again and confirm nothing was deselected.
    const newRow = document.querySelector(
      `.${CONST.CLASSES.TOGGLE_ALL}[data-group="${CONST.GROUP.OVERLAY}"]`,
    ) as HTMLElement;
    pressKey(
      newRow.querySelector(`.${CONST.CLASSES.FOLD_BTN}`) as HTMLElement,
      "Enter",
    );
    expect(children()).toHaveLength(2);
    expect(childBoxes().every(cb => cb.checked)).toBe(true);
  });

  it("Enter on the toggle-all row itself still selects/deselects the group", () => {
    const { row, children } = attachWithGroup();
    const childBoxes = () =>
      Array.from(
        children().map(
          el => el.querySelector('input[type="checkbox"]') as HTMLInputElement,
        ),
      ).filter(Boolean);

    pressKey(row, "Enter");

    // The row stays expanded — Enter on the row itself toggles visibility,
    // not the fold.
    expect(row.classList.contains(CONST.CLASSES.GROUP_FOLDED)).toBe(false);
    expect(allFolded(children())).toBe(false);
    expect(children()).toHaveLength(2);
    expect(childBoxes().some(cb => !cb.checked)).toBe(true);
  });

  it("getNavigableItems lists rows by class, so a checkbox-less row is reachable", () => {
    const { ui } = attachWithGroup();
    const colorRow = ui.uiContainer.querySelector(
      `.${CONST.CLASSES.COLOR_ITEM}`,
    ) as HTMLElement | null;

    const items = ui.getNavigableItems();
    // The color row is a picker, not a layer, so it stays out of the list.
    if (colorRow) expect(items).not.toContain(colorRow);
    // Both toggle-all rows are present.
    expect(
      items.filter(el => el.classList.contains(CONST.CLASSES.TOGGLE_ALL)),
    ).toHaveLength(2);
    expect(items[0].classList.contains(CONST.CLASSES.TOGGLE_ALL)).toBe(true);
    expect(
      items.every(
        el =>
          el.classList.contains(CONST.CLASSES.LAYER_ITEM) ||
          el.classList.contains(CONST.CLASSES.TOGGLE_ALL),
      ),
    ).toBe(true);
  });

  it("a row with no checkbox is still returned by getNavigableItems", () => {
    const { ui } = attachWithGroup();
    // Simulate the divergence that made Tab and arrow keys disagree: a row that
    // the checkbox-first enumeration silently dropped.
    const bareRow = document.createElement("div");
    bareRow.className = CONST.CLASSES.LAYER_ITEM;
    bareRow.setAttribute(CONST.DATA.LAYER_ID, "no-checkbox");
    ui.uiContainer.appendChild(bareRow);

    expect(ui.getNavigableItems()).toContain(bareRow);
  });
});
