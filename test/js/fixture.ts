// Shared test infrastructure: window.L extension, per-test reset, and a
// LayerUI mock factory.
//
// Three pieces, all exported:
//
// - `installWindowLExtensions()` — called once from `setup.ts`. Extends the
//   base `window.L` stub with the constructors/factories that individual test
//   files were patching locally (MeasureControl/mode/setup.ts,
//   MeasureControl/manager.test.ts, core/leafletAdapter.test.ts, ...). Uses
//   `Object.assign` so the `window.L` object identity stays stable —
//   production code that captured `L` at module-import time sees the same
//   reference the tests see.
// - `resetState()` — registered as a global `beforeEach`. Clears
//   `window.localStorage` and mock call history. Does NOT touch
//   `document.body`: a test file that mounts DOM in `beforeAll` would have
//   its container wiped before the first `it` runs. Tests that need a
//   scoped DOM root call `mountFixtureRoot()` and clean it up themselves.
// - `makeLayerUIMock(extra?)` — mirror of the `LayerUI` field set (see
//   `foliplus/js/LayerControl/ui/index.ts` constructor + declared fields).
//   Adding a new field to LayerUI means adding it here too; the completeness
//   gate in `test/js/fixture.test.ts` fails loudly if the two drift apart.
import { vi } from "vitest";
import type { LayerUI } from "#foliplus/LayerControl/ui/index.js";

type Overrides = Record<string, unknown>;

// A base Layer-like class every L.<Shape> constructor inherits. Production
// code touches these methods on the returned instance (addTo, remove, on,
// off, setStyle, getElement, bringToFront, ...) — see the call sites in
// foliplus/js/LayerControl/manager.ts and core/layer/LayerFactory.ts.
class LeafletBase {
  addTo = vi.fn(this as unknown as object) as any;
  remove = vi.fn() as any;
  on = vi.fn() as any;
  off = vi.fn() as any;
  setStyle = vi.fn() as any;
  bringToFront = vi.fn() as any;
  bringToBack = vi.fn() as any;
  getBounds = vi.fn(() => ({
    getNorth: () => 0,
    getSouth: () => 0,
    getEast: () => 0,
    getWest: () => 0,
    isValid: () => true,
  })) as any;
  getElement = vi.fn(() => document.createElement("div")) as any;
  getLatLngs = vi.fn(() => []) as any;
}

// Marker mock: the shape that individual test files kept missing fields on
// (a prior incident was a local mock without `bindPopup`). Every caller gets
// a fresh instance with fresh `vi.fn()`s.
const markerMock = vi.fn(() => ({
  bindPopup: vi.fn(),
  bindTooltip: vi.fn(),
  openPopup: vi.fn(),
  openTooltip: vi.fn(),
  closePopup: vi.fn(),
  closeTooltip: vi.fn(),
  addTo: vi.fn(),
  remove: vi.fn(),
  on: vi.fn(),
  off: vi.fn(),
  setLatLng: vi.fn(),
  getLatLng: vi.fn(() => ({ lat: 0, lng: 0 })),
  setIcon: vi.fn(),
  getIcon: vi.fn(() => ({})),
  getElement: vi.fn(() => document.createElement("div")),
  setPopup: vi.fn(),
  getPopup: vi.fn(() => null),
  setZIndexOffset: vi.fn(),
  onAdd: vi.fn(),
  onRemove: vi.fn(),
}));

const divIconMock = vi.fn(() => ({}));

const layerGroupMock = vi.fn(() => ({
  addLayer: vi.fn(),
  removeLayer: vi.fn(),
  eachLayer: vi.fn(),
  getLayers: vi.fn(() => []),
  addTo: vi.fn(),
  remove: vi.fn(),
  on: vi.fn(),
  off: vi.fn(),
}));

const svgMock = vi.fn(() => ({
  addTo: vi.fn(),
  on: vi.fn(),
  off: vi.fn(),
  getContainer: vi.fn(() => document.createElement("div")),
  getSizingTransformer: vi.fn(() => vi.fn()),
  reset: vi.fn(),
}));

const boundsMock = vi.fn(() => ({
  getNorth: () => 0,
  getSouth: () => 0,
  getEast: () => 0,
  getWest: () => 0,
  isValid: () => true,
  contains: () => true,
  getCenter: () => ({ lat: 0, lng: 0 }),
}));

/**
 * Extend `window.L` in place. `setup.ts` calls this after populating the
 * base stub. Tests can still override individual fields at module level
 * (`window.L.circleMarker = vi.fn(...)`) — that pattern is unaffected.
 */
export function installWindowLExtensions(): void {
  const L: any = window.L;
  if (!L) return;

  Object.assign(L, {
    marker: markerMock,
    divIcon: divIconMock,
    icon: vi.fn(() => ({})),
    Popup: class extends LeafletBase {},
    Circle: class extends LeafletBase {},
    Rectangle: class extends LeafletBase {},
    CircleMarker: class extends LeafletBase {},
    GridLayer: class extends LeafletBase {},
    TileLayer: class extends LeafletBase {},
    // `L.LayerGroup` (the class) is deliberately NOT added —
    // LayerFactory.ts:222 checks `L.LayerGroup?.prototype` and falls back
    // to the instance's own `addLayer` when it's undefined. Adding the class
    // would silently redirect `origAddLayer` to the prototype's `vi.fn()`,
    // bypassing the test's local `L.layerGroup` factory.
    layerGroup: layerGroupMock,
    gridLayer: vi.fn(() => ({
      addTo: vi.fn(),
      remove: vi.fn(),
      on: vi.fn(),
      off: vi.fn(),
    })),
    tileLayer: vi.fn(() => ({
      addTo: vi.fn(),
      remove: vi.fn(),
      on: vi.fn(),
      off: vi.fn(),
    })),
    polyline: vi.fn(() => ({
      addLatLng: vi.fn(),
      setLatLngs: vi.fn(),
      getElement: vi.fn(() => null),
      on: vi.fn(),
      off: vi.fn(),
      addTo: vi.fn(),
      remove: vi.fn(),
    })),
    polygon: vi.fn(() => ({
      setLatLngs: vi.fn(),
      getElement: vi.fn(() => null),
      on: vi.fn(),
      off: vi.fn(),
      addTo: vi.fn(),
      remove: vi.fn(),
    })),
    circle: vi.fn(() => ({
      setRadius: vi.fn(),
      getRadius: vi.fn(() => 1000),
      setLatLng: vi.fn(),
      getLatLng: vi.fn(() => ({ lat: 0, lng: 0 })),
      getElement: vi.fn(() => null),
      on: vi.fn(),
      off: vi.fn(),
      addTo: vi.fn(),
      remove: vi.fn(),
    })),
    circleMarker: vi.fn(() => ({
      bringToFront: vi.fn(),
      on: vi.fn(),
      off: vi.fn(),
      setLatLng: vi.fn(),
      getLatLng: vi.fn(() => ({ lat: 0, lng: 0 })),
      getElement: vi.fn(() => null),
      addTo: vi.fn(),
      remove: vi.fn(),
    })),
    svg: svgMock,
    stamp: vi.fn(),
    latLng: vi.fn((lat: number, lng: number) => ({ lat, lng })),
    latLngBounds: boundsMock,
    bounds: boundsMock,
    CRS: { EPSG3857: {} as any },
    DomUtil: { getPosition: vi.fn(() => ({ x: 0, y: 0 })) },
    Util: {
      extend: <T, U>(target: T, source: U): any => Object.assign({}, target, source),
    } as any,
  });

  // MeasureControl edit.ts calls L.DomEvent.stopPropagation — add it to the
  // base DomEvent stub so tests don't have to override the whole object.
  if (L.DomEvent) {
    L.DomEvent.stopPropagation = vi.fn((event: any) => {
      if (event?.originalEvent) event.originalEvent._stopped = true;
    });
  }

  // `L.Path.prototype.bringToFront` is captured at module-import time by
  // LayerControl/manager.ts and monkey-patched in a test — provide the full
  // set of methods production code touches on paths.
  if (L.Path?.prototype) {
    Object.assign(L.Path.prototype, {
      bringToFront: vi.fn(),
      bringToBack: vi.fn(),
      addTo: vi.fn(),
      remove: vi.fn(),
      getBounds: vi.fn(() => ({
        getNorth: () => 0,
        getSouth: () => 0,
        getEast: () => 0,
        getWest: () => 0,
      })),
      getElement: vi.fn(() => document.createElement("div")),
      getLatLngs: vi.fn(() => []),
      setStyle: vi.fn(),
    });
  }
}

/**
 * Per-test isolation. Registered as a global `beforeEach` from `setup.ts`.
 * Clears localStorage and mock call history. Deliberately does not touch
 * `document.body` — clearing it here would wipe containers mounted in a
 * test file's `beforeAll` before the first `it` of that file runs.
 */
export function resetState(): void {
  window.localStorage.clear();
  vi.clearAllMocks();
}

/**
 * Optional scoped DOM root for tests that mount their own elements. Call it
 * in a `beforeAll` and clean up in an `afterAll` (or just leave it —
 * `document.body` is per-file in jsdom). Not auto-cleaned by
 * `resetState()` for the reason above.
 */
export function mountFixtureRoot(): HTMLElement {
  const existing = document.getElementById("fixture-root");
  if (existing) return existing;
  const div = document.createElement("div");
  div.id = "fixture-root";
  document.body.appendChild(div);
  return div;
}

/**
 * LayerUI-shaped fixture. Every field from `LayerUI`'s constructor
 * (foliplus/js/LayerControl/ui/index.ts:208-252) plus declared fields
 * (the `declare on*` handlers and `activeMenu` / `activeAttrsPanel`).
 * `extra` overrides defaults — pass `as unknown as Partial<LayerUI>` when
 * the override has a different shape (real Sets, real Maps, real DOM nodes).
 */
export function makeLayerUIMock(extra: Overrides = {}): LayerUI {
  const base: any = {
    // Constructor-initialized state
    manager: null,
    events: {
      on: vi.fn(() => vi.fn()),
      emit: vi.fn(),
      off: vi.fn(),
    },
    conf: {} as any,
    T: (key: string) => key,
    _: (key: string) => key,
    foldedGroups: new Set<string>(),
    hiddenIds: new Set<string>(),
    rangeHiddenIds: new Set<string>(),
    authorVisible: new Map<string, boolean>(),
    userOverrides: {},
    isColorActive: false,
    currentColor: "#cccccc",
    renamedNames: {},
    activeRenameId: null,
    dragIdx: null,
    lastDragHintAt: 0,
    lastDragOverItem: null,
    activeIdx: null,
    listCursor: null,
    interactionCleanup: null,
    // Declared handler fields
    onChange: null,
    onInput: null,
    onClick: null,
    onFocusIn: null,
    onFocusOut: null,
    onDragStart: null,
    onDragOver: null,
    onDragLeave: null,
    onDragEnd: null,
    onDrop: null,
    onKeyDown: null,
    // Lifecycle / dismiss handlers
    onMoreClick: null,
    onMoreMenuClick: null,
    onMoreMapClick: null,
    onZoomEnd: null,
    unsubscribeCountChange: null,
    unsubscribeControlAttached: null,
    activeMenu: null,
    activeAttrsPanel: null,
    attrsOutsideHandler: null,
    styleOutsideHandler: null,
    styleUnsubscribe: null,
    styleRefresh: null,
    styleZoomEndHandler: null,
    stylePanelLayerId: null,
    fieldCache: new Map<string, unknown[]>(),
    pressInPanel: false,
    labelConfigs: {},
    opacityMap: {},
    zoomRangeMap: {},
    focusRect: null,
    focusingLayerId: null,
    onFocusMapMove: null,
    focusMask: null,
    focusRenderer: null,
    focusedPaneRestores: [],
    ...extra,
  };
  // `m` is a getter alias for `manager` on the real class.
  Object.defineProperty(base, "m", {
    get: () => base.manager,
    configurable: true,
  });
  return base;
}
