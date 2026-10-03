import { vi } from "vitest";
import { GROUP, LayerIntentStore, LayerRuntimeStore } from "#core/layer/index.js";
import * as CONST from "#foliplus/LayerControl/const.js";
import { LayerManager } from "#foliplus/LayerControl/manager.js";
import type { LayerAccess } from "#foliplus/LayerControl/ui/access.js";
import { FocusStore } from "#foliplus/LayerControl/ui/focusStore.js";
import { LayerUI } from "#foliplus/LayerControl/ui/index.js";
import { PanelStore } from "#foliplus/LayerControl/ui/panelStore.js";

class TileLayer {
  options = { attribution: "© OpenStreetMap" };
  setZIndex = vi.fn();
}

class GridLayer {
  options = {};
}

const makePane = () => {
  // Debounced manager callbacks can outlive a test that never destroyed its
  // manager; when the file tears jsdom down, a late timer hits a missing
  // document/HTMLElement. Return a style-only stub instead of throwing so the
  // leaked callback becomes a no-op rather than an unhandled error.
  try {
    const el = document.createElement("div");
    el.style.zIndex = "0";
    return el;
  } catch {
    return { style: { zIndex: "0" } } as HTMLElement;
  }
};

// Module-level stub classes, assigned to window.L by installLeafletGlobals.
// Defined ONCE so repeated installs keep the same class identity — a layer
// created between installs must still satisfy `instanceof L.Polygon`.
class Renderer {}

class Path {
  options = {};
}

class Polygon {
  options = {};
  // Areal duck-type: rings of coordinates (hasFillLeaf).
  getLatLngs = () => [
    [
      { lat: 0, lng: 0 },
      { lat: 1, lng: 0 },
      { lat: 0, lng: 1 },
    ],
  ];
}

class Polyline {
  options = {};
  // Line duck-type: flat coordinate array, not rings.
  getLatLngs = () => [
    { lat: 0, lng: 0 },
    { lat: 1, lng: 1 },
  ];
}

// Real Leaflet: Circle extends CircleMarker (not the reverse). Both carry a
// fill, so the areal probe must recognise them by `getRadius`, not by class.
class Circle {
  options = {};
  getRadius = () => 5;
}

class Marker {}

class CircleMarker {
  constructor(_latlng: unknown, _opts: unknown) {}
  options = {};
  getRadius = () => 5;
  setStyle = vi.fn();
  addTo(_map: unknown) {
    return this;
  }
}

/** Populate window.L with the stubs LayerManager / PaneManager expect. */
const installLeafletGlobals = () => {
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
  window.L.Circle = Circle;
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
    data?: ConstructorParameters<typeof LayerManager>[1];
    /** The persisted record, written before the manager is constructed. */
    seed?: Record<string, unknown>;
  } = {},
): { manager: LayerManager; ui: LayerUI; map: any } => {
  window.CONFIG.name = "LayerControl";
  window.CONFIG.locale_code = "en";
  if (options.seed) {
    window.localStorage.setItem(CONST.STORAGE.KEY, JSON.stringify(options.seed));
  }

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
    closePopup: vi.fn(),
    getZoom: vi.fn(() => options.initialZoom ?? 5),
    getMaxZoom: vi.fn(() => options.maxZoom ?? 18),
    getMinZoom: vi.fn(() => 0),
    options: { maxZoom: options.maxZoom ?? 18 },
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
    getPanes: vi.fn(() => ({ mapPane: document.createElement("div") })),
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

  const manager = new LayerManager(
    map,
    options.data ?? [
      { id: "overlay1", name: "Polygons", group: "overlay", layer: polygonLayer },
      {
        id: "base1",
        name: "OSM",
        group: "base",
        layer: new TileLayer(),
        paneName: "tilePane",
      },
    ],
  );
  manager.enforceOrder();
  manager.ui = new LayerUI(manager);

  vi.useFakeTimers();
  manager.attachUI(container);
  const ui = manager.ui!;
  vi.advanceTimersByTime(350);
  // Leave fake timers enabled — callers that need real timers opt in with
  // vi.useRealTimers(). Switching back to real here let attachUI's
  // setTimeout(0) fire before a caller's own useFakeTimers ran, which made
  // the caller's advanceTimersByTime(0) a no-op and let a leaked init pass
  // pollute the next test's module-function spies.

  return { manager, ui, map };
};

const findItem = (
  la: LayerAccess,
  ps: PanelStore,
  fs: FocusStore,
  id: string,
): HTMLElement =>
  ps.uiContainer!.querySelector(`[${CONST.DATA.LAYER_ID}="${id}"]`) as HTMLElement;

/** Resolve the overlay group's toggle-all row and its chevron, plus a live
 *  read of its child rows. */
const attachWithGroup = (la: LayerAccess, ps: PanelStore, fs: FocusStore) => {
  const row = ps.uiContainer!.querySelector(
    `.${CONST.CLASSES.TOGGLE_ALL}[data-group="${GROUP.OVERLAY}"]`,
  ) as HTMLElement;
  const children = () =>
    Array.from(
      ps.uiContainer!.querySelectorAll<HTMLElement>(
        `${CONST.SEL.LAYER_ITEM}[data-layer-type="${GROUP.OVERLAY}"]`,
      ),
    );

  return {
    ui: { la, panelStore: ps, focusStore: fs },
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
    .querySelector(`.${CONST.CLASSES.TOGGLE_ALL}[data-group="${GROUP.OVERLAY}"]`)!
    .querySelector(`.${CONST.CLASSES.FOLD_BTN}`) as HTMLElement;

// ── Phase-2 injection faces (T270) ───────────────────────────────────

const makePanelStore = () => new PanelStore();

const makeFocusStore = () => new FocusStore();

/** A stub LayerAccess with empty stores and inert manager members; tests that
 *  need a real manager pass it (or a shaped stub) through `extra`. */
const makeAccess = (extra: Record<string, unknown> = {}) => ({
  layerRegistry: { get: () => undefined, layers: [] } as any,
  intentStore: new LayerIntentStore(),
  runtimeStore: new LayerRuntimeStore(),
  annotation: null as any,
  events: {
    on: vi.fn(() => vi.fn()),
    emit: vi.fn(),
    off: vi.fn(),
  },
  map: {} as any,
  findLayer: () => null,
  surfaceFor: () =>
    ({
      capabilities: { opacity: "none", zoomRange: "none" },
      paneNames: [],
      panes: [],
    }) as any,
  getFeatureCount: () => null,
  ...extra,
});

/** Split a hand-written ui stub into the (la, ps, fs) faces the phase-2
 *  modules receive. Fields the stub did not shape fall back to inert
 *  defaults, so a thin stub keeps compiling and running. */
const facesOf = (ui: Record<string, any>) => {
  const m = ui.m ?? {};
  const ps = makePanelStore();
  const fs = makeFocusStore();
  for (const key of [
    "foldedGroups",
    "checkedCount",
    "activeMenu",
    "activeAttrsPanel",
    "stylePanelLayerId",
    "activeRenameId",
    "dragIdx",
    "lastDragHintAt",
    "lastDragOverItem",
    "pressInPanel",
    "activeIdx",
    "listCursor",
    "interactionCleanup",
    "currentColor",
    "uiContainer",
    "colorSurface",
    "onChange",
    "onInput",
    "onClick",
    "onFocusIn",
    "onFocusOut",
    "onDragStart",
    "onDragOver",
    "onDragLeave",
    "onDragEnd",
    "onDrop",
    "onMoreClick",
    "onMoreMenuClick",
    "onMoreMapClick",
    "onZoomEnd",
    "unsubscribeCountChange",
    "unsubscribeControlAttached",
    "attrsOutsideHandler",
    "styleOutsideHandler",
    "attrsUnsubscribe",
    "styleUnsubscribe",
    "styleRefresh",
    "styleZoomEndHandler",
    "geometryMarqueeCleanup",
  ]) {
    if (ui[key] !== undefined) (ps as Record<string, unknown>)[key] = ui[key];
  }
  // Translator seam: a stub that pins its own T/_ (identity, or a scoped
  // lookalike) must win over PanelStore's CONFIG-derived defaults — the same
  // injection the real coordinator provides via the instance getters.
  if (ui.T !== undefined) (ps as Record<string, unknown>).T = ui.T;
  if (ui._ !== undefined) (ps as Record<string, unknown>)._ = ui._;
  // The color basemap's default fill color — a stub that never set it must
  // still read the control's DEFAULT, not PanelStore's empty string.
  if ((ps as Record<string, unknown>).currentColor === "") {
    (ps as Record<string, unknown>).currentColor = "#cccccc";
  }
  for (const key of [
    "focusRect",
    "focusingLayerId",
    "onFocusMapMove",
    "focusMask",
    "focusRenderer",
    "focusedPaneRestores",
  ]) {
    if (ui[key] !== undefined) (fs as Record<string, unknown>)[key] = ui[key];
  }
  const la: Record<string, unknown> = {
    // A plain Map stub has no `.layers` — wrap it so projection walks get
    // the array shape without losing Map lookup.
    layerRegistry: (() => {
      const raw = m.layerRegistry ?? ui.layerRegistry;
      if (raw && raw.layers) return raw;
      // Spread keeps stub methods (indexOf / reorder / …) while Map get/has
      // still reach through to the original.
      return {
        ...(raw ?? {}),
        get: (id: string) => raw?.get?.(id),
        has: (id: string) => raw?.has?.(id) ?? (raw ? id in raw : false),
        layers: [],
      };
    })(),
    intentStore: ui.intentStore ?? new LayerIntentStore(),
    runtimeStore: ui.runtimeStore ?? new LayerRuntimeStore(),
    annotation: m.annotation ??
      ui.annotation ?? {
        configEntries: () => [],
        getConfig: () => ({ show: false }),
        hasConfig: () => false,
        collectFields: () => [],
      },
    events: ui.events ?? { on: vi.fn(() => vi.fn()), emit: vi.fn(), off: vi.fn() },
    map: m.map ??
      ui.map ?? {
        on: vi.fn(),
        off: vi.fn(),
        hasLayer: vi.fn(() => false),
        addLayer: vi.fn(),
        removeLayer: vi.fn(),
        getZoom: vi.fn(() => 5),
        getMaxZoom: vi.fn(() => 18),
        getMinZoom: vi.fn(() => 0),
        flyTo: vi.fn(),
        fitBounds: vi.fn(),
        getContainer: vi.fn(() => document.createElement("div")),
        foliplus: { showHint: vi.fn(), hideHint: vi.fn() },
      },
    layers: m.layers ?? [],
    panes: m.panes ?? ui.panes ?? {},
    pendingRegistrations: m.pendingRegistrations ?? [],
    persistence: m.persistence ??
      ui.persistence ?? {
        schedule: vi.fn(),
        load: () => ({}),
        flushAll: vi.fn(),
      },
    debouncedEnforce: m.debouncedEnforce ?? (() => {}),
    findLayer: m.findLayer
      ? (x: any) => m.findLayer(x)
      : (ui.findLayer ?? (() => null)),
    surfaceFor: m.surfaceFor
      ? (x: any) => m.surfaceFor(x)
      : (ui.surfaceFor ??
        (() => ({
          capabilities: { opacity: "none", zoomRange: "none" },
          paneNames: [],
          panes: [],
        }))),
    getFeatureCount: m.getFeatureCount ?? ui.mgmt?.getFeatureCount ?? (() => null),
    getLayerPanes: m.getLayerPanes ?? ui.getLayerPanes ?? (() => []),
    canReorderBetween: m.canReorderBetween
      ? (a: any, b: any) => m.canReorderBetween(a, b)
      : (ui.canReorderBetween ?? (() => true)),
    enforceOrder: m.enforceOrder
      ? () => m.enforceOrder()
      : (ui.enforceOrder ?? (() => {})),
    saveOrder: m.saveOrder ? () => m.saveOrder() : (ui.saveOrder ?? (() => {})),
    deleteLayer: m.deleteLayer
      ? (id: string) => m.deleteLayer(id)
      : (ui.deleteLayer ?? (() => false)),
    moveLayerUp: m.moveLayerUp
      ? (id: string) => m.moveLayerUp(id)
      : (ui.moveLayerUp ?? (() => false)),
    moveLayerDown: m.moveLayerDown
      ? (id: string) => m.moveLayerDown(id)
      : (ui.moveLayerDown ?? (() => false)),
    replaySavedOrder: m.replaySavedOrder
      ? (id?: string) => m.replaySavedOrder(id)
      : (ui.replaySavedOrder ?? (() => {})),
    createColor: m.createColor ?? ui.createColor ?? (() => ({})),
  };
  return { la, ps, fs } as { la: any; ps: any; fs: any };
};

/** Attach the (la, ps, fs) faces to a hand-written ui stub in place. */
const attachFaces = (ui: Record<string, any>) => {
  const faces = facesOf(ui);
  (ui as Record<string, unknown>).la = faces.la;
  (ui as Record<string, unknown>).panelStore = faces.ps;
  (ui as Record<string, unknown>).focusStore = faces.fs;
  return ui;
};

export {
  allFolded,
  attachFaces,
  attachWithGroup,
  facesOf,
  findItem,
  initFixture,
  installLeafletGlobals,
  makeAccess,
  makeFocusStore,
  makePane,
  makePanelStore,
  overlayFoldBtn,
  pressKey,
  GridLayer,
  TileLayer,
};
