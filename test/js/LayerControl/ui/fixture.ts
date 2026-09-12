import { vi } from "vitest";
import * as CONST from "#foliplus/LayerControl/const.js";
import { LayerManager } from "#foliplus/LayerControl/manager.js";
import { LayerUI } from "#foliplus/LayerControl/ui/index.js";

class TileLayer {
  options = { attribution: "© OpenStreetMap" };
  setZIndex = vi.fn();
}

class GridLayer {
  options = {};
}

const makePane = () => {
  const el = document.createElement("div");
  el.style.zIndex = "0";
  return el;
};

/** Populate window.L with the stubs LayerManager / PaneManager expect. */
const installLeafletGlobals = () => {
  class Renderer {}

  class Path {
    options = {};
  }

  class Polygon {
    options = {};
  }

  class Polyline {
    options = {};
  }

  class Marker {}

  class CircleMarker {
    constructor(_latlng: unknown, _opts: unknown) {}
    addTo(_map: unknown) {
      return this;
    }
  }
  const stamp = (() => {
    let id = 0;
    return vi.fn(() => ++id);
  })();

  window.L.TileLayer = TileLayer;
  window.L.GridLayer = GridLayer;
  window.L.Renderer = Renderer;
  window.L.layerGroup = vi.fn(() => ({
    addLayer: vi.fn(),
    removeLayer: vi.fn(),
    hasLayer: vi.fn(() => false),
    getLayers: vi.fn(() => []),
    clearLayers: vi.fn(),
    options: {},
  }));
  window.L.Path = Path;
  window.L.Polygon = Polygon;
  window.L.Polyline = Polyline;
  window.L.Marker = Marker;
  window.L.CircleMarker = CircleMarker;
  window.L.stamp = stamp;
  window.L.svg = vi.fn(() => ({ addTo: vi.fn() }));
  window.L.polygon = vi.fn(
    (rings: unknown, opts: unknown) => ({ options: opts, _rings: rings }) as never,
  );
  window.L.rectangle = vi.fn(
    (_bounds: unknown, opts: { className?: string }) =>
      ({
        _options: opts,
        getClassName: () => opts?.className ?? "",
        on: vi.fn(),
        eachLayer: vi.fn(),
      }) as never,
  );
  window.L.latLngBounds = vi.fn((a?: unknown, b?: unknown) => {
    const sw = { lat: Infinity, lng: Infinity };
    const ne = { lat: -Infinity, lng: -Infinity };
    const include = (x: unknown): void => {
      const item = x as {
        lat?: number;
        lng?: number;
        getSouthWest?: () => { lat: number; lng: number };
        getNorthEast?: () => { lat: number; lng: number };
      };
      if (
        typeof item.getSouthWest === "function" &&
        typeof item.getNorthEast === "function"
      ) {
        const s = item.getSouthWest();
        const n = item.getNorthEast();
        sw.lat = Math.min(sw.lat, s.lat);
        sw.lng = Math.min(sw.lng, s.lng);
        ne.lat = Math.max(ne.lat, n.lat);
        ne.lng = Math.max(ne.lng, n.lng);
      } else if (typeof item.lat === "number" && typeof item.lng === "number") {
        sw.lat = Math.min(sw.lat, item.lat);
        sw.lng = Math.min(sw.lng, item.lng);
        ne.lat = Math.max(ne.lat, item.lat);
        ne.lng = Math.max(ne.lng, item.lng);
      }
    };
    const acc = {
      isValid: () => sw.lat !== Infinity,
      extend: (x: unknown) => {
        include(x);
        return acc;
      },
      getSouthWest: () => sw,
      getNorthEast: () => ne,
    };
    if (Array.isArray(a)) for (const x of a) include(x);
    else if (a != null) {
      include(a);
      if (b != null) include(b);
    }
    return acc;
  }) as unknown as typeof L.latLngBounds;
};

const initFixture = (
  options: {
    initialZoom?: number;
    maxZoom?: number;
  } = {},
): { manager: LayerManager; ui: LayerUI; map: any } => {
  window.CONF.name = "LayerControl";
  window.CONF.locale_code = "en";

  installLeafletGlobals();

  const container = document.createElement("div");
  document.body.appendChild(container);

  const sw = { lat: 30, lng: 100 };
  const ne = { lat: 40, lng: 110 };
  const bounds = {
    isValid: vi.fn(() => true),
    getSouthWest: () => sw,
    getNorthEast: () => ne,
  };

  const polygonLayer = {
    options: {},
    eachLayer: vi.fn(),
    getBounds: vi.fn(() => bounds),
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
    getZoom: vi.fn(() => options.initialZoom ?? 5),
    getMaxZoom: vi.fn(() => options.maxZoom ?? 18),
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
    getPane: vi.fn(() => {
      const p = makePane();
      p.style.zIndex = "0";
      return p;
    }),
    createPane: vi.fn(() => {
      const p = makePane();
      p.classList.add("foliplus-layer-pane");
      return p;
    }),
    _container: container,
    _layers: {},
    attributionControl: { _attributions: {}, _update: vi.fn() },
    foliplus: {
      showHint: vi.fn(),
      hideHint: vi.fn(),
    },
  };

  const manager = new LayerManager(map, [
    { id: "overlay1", name: "Polygons", isBase: false, layer: polygonLayer },
    {
      id: "base1",
      name: "OSM",
      isBase: true,
      layer: new TileLayer(),
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

  return { manager, ui, map };
};

const findItem = (ui: LayerUI, id: string): HTMLElement =>
  ui.uiContainer.querySelector(`[${CONST.DATA.LAYER_ID}="${id}"]`) as HTMLElement;

/** Resolve the overlay group's toggle-all row and its chevron, plus a live
 *  read of its child rows. */
const attachWithGroup = (ui: LayerUI) => {
  const row = ui.uiContainer.querySelector(
    `.${CONST.CLASSES.TOGGLE_ALL}[data-group="${CONST.GROUP.OVERLAY}"]`,
  ) as HTMLElement;
  const children = () =>
    Array.from(
      ui.uiContainer.querySelectorAll<HTMLElement>(
        `${CONST.SEL.LAYER_ITEM}[data-layer-type="${CONST.GROUP.OVERLAY}"]`,
      ),
    );

  return {
    ui,
    row,
    foldBtn: row.querySelector(`.${CONST.CLASSES.FOLD_BTN}`) as HTMLElement,
    children,
  };
};

const allFolded = (rows: HTMLElement[]) =>
  rows.length > 0 &&
  rows.every(el => el.classList.contains(CONST.CLASSES.GROUP_FOLDED));

const pressKey = (el: HTMLElement, key: string) => {
  el.focus();
  el.dispatchEvent(
    new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key }),
  );
};

const overlayFoldBtn = (root: ParentNode) =>
  root
    .querySelector(`.${CONST.CLASSES.TOGGLE_ALL}[data-group="${CONST.GROUP.OVERLAY}"]`)!
    .querySelector(`.${CONST.CLASSES.FOLD_BTN}`) as HTMLElement;

export {
  allFolded,
  attachWithGroup,
  findItem,
  initFixture,
  installLeafletGlobals,
  makePane,
  overlayFoldBtn,
  pressKey,
  GridLayer,
  TileLayer,
};
