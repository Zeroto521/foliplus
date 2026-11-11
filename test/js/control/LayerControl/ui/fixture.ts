import { afterEach, vi } from "vitest";
import { ROLE } from "#core/layer/index.js";
import { type OverlayRegistry, ensureOverlayRegistry } from "#core/overlay/index.js";
import { createLogger } from "#platform/log.js";
import * as CONST from "#control/LayerControl/const.js";
import { LayerController } from "#control/LayerControl/controller.js";
import { LayerUI } from "#control/LayerControl/ui/index.js";

/** Translator env for LayerUI constructed in tests — mirrors the identity
 *  translators the old NO_OP_ENV default provided, so `ui.T("key")` reads
 *  `LayerControl.key` and `ui._("key")` reads `key`. */
export const TEST_ENV = {
  T: (key: string) => `LayerControl.${key}`,
  _: (key: string) => key,
  log: createLogger("LayerControl"),
};

class GridLayer {
  options = {};
}

// Real Leaflet: TileLayer IS a GridLayer — the carrier probes (native setter
// detection, migratable-family check) key on that inheritance.
class TileLayer extends GridLayer {
  options = { attribution: "© OpenStreetMap" };
  setZIndex = vi.fn();
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
// fill, so the areal probe must recognize them by `getRadius`, not by class.
class Circle {
  options = {};
  getRadius = () => 5;
}

class Marker {}

class CircleMarker {
  options = {};
  getRadius = () => 5;
  setStyle = vi.fn();
  addTo(_map: unknown) {
    return this;
  }
}

/** One id per stamped object, never reused. Real `L.stamp` is a process-wide
 *  counter, so the counter lives at module scope here too: a counter that
 *  restarts on every `installLeafletGlobals` call reissues ids an earlier
 *  install already gave out, two layers end up with the same `L.stamp`, and
 *  the fallback pane name `foliplus-pane-<stamp>` collides across surfaces.
 */
const stamp = (() => {
  let id = 0;
  return vi.fn(() => ++id);
})();

/** Populate window.L with the stubs LayerController / PaneManager expect. */
const installLeafletGlobals = () => {
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
  // This fixture's vector mocks replace the shared setup.ts family, so the
  // real Leaflet class hierarchy has to be restated here too — the carrier
  // probes key on `instanceof L.Path`, which is false for a flat Polygon.
  Object.setPrototypeOf(Polygon.prototype, Path.prototype);
  Object.setPrototypeOf(Polyline.prototype, Path.prototype);
  Object.setPrototypeOf(Circle.prototype, Path.prototype);
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

// The registry installs document-level press/Escape listeners; a test map is
// never unloaded, so each fixture would leave its dispatcher behind and an
// earlier test's still-open surface would swallow the next test's Escape.
// Destroy the tracked registry after every test instead.
const createdRegistries: OverlayRegistry[] = [];
afterEach(() => {
  for (const registry of createdRegistries.splice(0)) registry.destroy();
});

const initFixture = (
  options: {
    initialZoom?: number;
    maxZoom?: number;
    data?: ConstructorParameters<typeof LayerController>[1];
    /** The persisted record, written before the manager is constructed. */
    seed?: Record<string, unknown>;
    /** Runs once the UI shell exists but before attachUI — the point where a
     *  subscriber can catch the attach sweep's notify. */
    beforeAttach?: (manager: LayerController, ui: LayerUI) => void;
    /** Runs after attachUI but before the attach timer fires — the point
     *  where a test can rewire the map so the init pass announces. */
    afterAttach?: (manager: LayerController, ui: LayerUI) => void;
  } = {},
): { manager: LayerController; ui: LayerUI; map: any } => {
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
  // The carrier contract promises pane coverage only to migratable families;
  // this stand-in for a polygon layer declares the Path identity so the
  // executor treats it as pane-capable.
  Object.setPrototypeOf(polygonLayer, new window.L.Path());

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

  createdRegistries.push(ensureOverlayRegistry(map));

  // One class world for the fixture: installLeafletGlobals swaps in the
  // richer L mocks (fixture GridLayer/TileLayer/Marker...), and the carrier
  // probes key on `instanceof` — probing against the bare setup.ts classes
  // while the layers carry the fixture classes answers "unknown family".
  installLeafletGlobals();

  const manager = new LayerController(
    map,
    options.data ?? [
      { id: "overlay1", name: "Polygons", role: "overlay", layer: polygonLayer },
      {
        id: "base1",
        name: "OSM",
        role: "base",
        layer: new TileLayer(),
        paneName: "tilePane",
      },
    ],
  );
  manager.enforceOrder();
  manager.ui = new LayerUI(manager, TEST_ENV);
  const ui = manager.ui!;
  options.beforeAttach?.(manager, ui);

  vi.useFakeTimers();
  manager.attachUI(container);
  options.afterAttach?.(manager, ui);
  vi.advanceTimersByTime(350);
  vi.useRealTimers();

  return { manager, ui, map };
};

/** The panel the fixture attached. `uiContainer` is nullable in the product —
 *  a subscriber can retire the control inside any notify — so a test that
 *  reaches into the panel says so explicitly and fails loudly when the control
 *  is gone, rather than silently reading a null. */
const attachedPanel = (ui: LayerUI): HTMLElement => {
  const container = ui.uiContainer;
  if (!container) throw new Error("fixture: the panel is not attached");
  return container;
};

const findItem = (ui: LayerUI, id: string): HTMLElement =>
  attachedPanel(ui).querySelector(`[${CONST.DATA.LAYER_ID}="${id}"]`) as HTMLElement;

/** Resolve the overlay group's toggle-all row and its chevron, plus a live
 *  read of its child rows. */
const attachWithGroup = (ui: LayerUI) => {
  const row = attachedPanel(ui).querySelector(
    `.${CONST.CLASSES.TOGGLE_ALL}[data-role="${ROLE.OVERLAY}"]`,
  ) as HTMLElement;
  const children = () =>
    Array.from(
      attachedPanel(ui).querySelectorAll<HTMLElement>(
        `${CONST.SEL.LAYER_ITEM}[data-layer-type="${ROLE.OVERLAY}"]`,
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
    .querySelector(`.${CONST.CLASSES.TOGGLE_ALL}[data-role="${ROLE.OVERLAY}"]`)!
    .querySelector(`.${CONST.CLASSES.FOLD_BTN}`) as HTMLElement;

// ── layer stubs and membership tracking shared across the event-contract
// tests (they moved here from the old notifyContract file so each per-script
// test suite can reach the same fixtures without copying). ──

/** A polygon-shaped layer stub — enough for the surface to resolve. The
 *  Path identity is what makes the carrier probe treat it as pane-capable. */
const polygonLayer = () => {
  const layer = {
    options: {},
    eachLayer: vi.fn(),
    getBounds: vi.fn(() => ({
      isValid: vi.fn(() => true),
      getSouthWest: () => ({ lat: 30, lng: 100 }),
      getNorthEast: () => ({ lat: 40, lng: 110 }),
    })),
  };
  Object.setPrototypeOf(layer, new window.L.Path());
  return layer as unknown as L.Layer;
};

/** A polygon-shaped layer whose bounds the test supplies — the flyTo branch
 *  needs a single-point area, the rectangle branch a real extent. */
const polygonLayerWith = (
  southWest: [number, number],
  northEast: [number, number],
): L.Layer => {
  const center = {
    lat: (southWest[0] + northEast[0]) / 2,
    lng: (southWest[1] + northEast[1]) / 2,
  };
  const layer = {
    options: {},
    eachLayer: vi.fn(),
    getBounds: vi.fn(() => ({
      isValid: vi.fn(() => true),
      getSouthWest: () => ({ lat: southWest[0], lng: southWest[1] }),
      getNorthEast: () => ({ lat: northEast[0], lng: northEast[1] }),
      getCenter: () => center,
    })),
  };
  Object.setPrototypeOf(layer, new window.L.Path());
  return layer as unknown as L.Layer;
};

/** A polygon-shaped layer stub that reports no usable bounds — the focus
 *  entry has to bail instead of drawing a rectangle. */
const polygonLayerWithoutBounds = (): L.Layer => {
  const layer = {
    options: {},
    eachLayer: vi.fn(),
    getBounds: vi.fn(() => ({ isValid: vi.fn(() => false) })),
  };
  Object.setPrototypeOf(layer, new window.L.Path());
  return layer as unknown as L.Layer;
};

/** A polygon-shaped layer whose options and `setStyle` the test supplies — the
 *  style-row tests need to read back what a replay wrote. */
const polygonLayerWithStyle = (
  options: Record<string, unknown>,
  setStyle: ReturnType<typeof vi.fn>,
): L.Layer =>
  ({
    options,
    setStyle,
    getLatLngs: () => [
      [
        { lat: 30, lng: 100 },
        { lat: 40, lng: 100 },
        { lat: 40, lng: 110 },
      ],
    ],
  }) as L.Layer;

/** Track real map membership, keyed by the layer the projection diffs against.
 *  A `hasLayer` that always answers the same way turns every add and every
 *  remove into a diff miss. */
const trackMembership = (map: any): Map<L.Layer, boolean> => {
  const onMap = new Map<L.Layer, boolean>();
  map.hasLayer = vi.fn((l: L.Layer) => onMap.get(l) ?? false);
  map.addLayer = vi.fn((l: L.Layer) => {
    onMap.set(l, true);
  });
  map.removeLayer = vi.fn((l: L.Layer) => {
    onMap.set(l, false);
  });
  return onMap;
};

/** One overlay in a fixture whose map membership is tracked, so the
 *  projection's diff against the map is real instead of a constant. The layer
 *  starts on the map, the way attach leaves it. */
const oneOverlay = (makeLayer: () => L.Layer = polygonLayer) => {
  const layer = makeLayer();
  const fixture = initFixture({
    data: [{ id: "overlay1", name: "Polygons", role: "overlay", layer }],
  });
  const onMap = trackMembership(fixture.map);
  onMap.set(layer, true);
  return { ...fixture, layer, onMap };
};

/** Build an awesome-markers author icon fixture. This is the single
 *  source for the author icon in the icon / iconColor / markerColor /
 *  markerIcon suites — the four files used to each carry a private copy
 *  that drifted apart (markerColor gained the `_setIconStyles` re-paint,
 *  icon kept a `withShadow` knob, iconColor had no shadow at all).
 *
 *  The union of knobs is accepted so every caller keeps working:
 *  className / bg / size (icon.ts, markerIcon.ts), markerColor
 *  (icon.ts, markerColor.ts), iconColor / innerColor (iconColor.ts,
 *  markerColor.ts, markerIcon.ts), withShadow (icon.ts, markerIcon.ts).
 *  Extra `face` fields are harmless — no caller asserts on
 *  `author.options.iconColor` / `author.options.markerColor` directly
 *  (all four files assert only on the derived `.icon` reference), so the
 *  union always carries every face the probes could read. */
export const makeAuthorIcon = (
  opts: {
    className?: string;
    bg?: string;
    size?: [number, number];
    markerColor?: string;
    iconColor?: string;
    innerColor?: string;
    withShadow?: boolean;
  } = {},
) => {
  const cfg = {
    className: opts.className ?? "awesome-marker",
    bg: opts.bg ?? "url(icon.png) -24px 0",
    size: opts.size ?? ([36, 46] as [number, number]),
    markerColor: opts.markerColor ?? "blue",
    iconColor: opts.iconColor ?? "blue",
    innerColor: opts.innerColor,
    withShadow: opts.withShadow ?? true,
  };
  const author: any = {
    options: {
      markerColor: cfg.markerColor,
      iconColor: cfg.iconColor,
      className: cfg.className,
      iconSize: cfg.size,
      iconAnchor: [cfg.size[0] / 2, cfg.size[1]],
      popupAnchor: [0, -cfg.size[1]],
    },
    createIcon: vi.fn(function (this: any) {
      const div = document.createElement("div");
      div.className = cfg.className;
      div.style.backgroundImage = cfg.bg;
      div.style.backgroundPosition = "-24px 0";
      div.style.width = `${cfg.size[0]}px`;
      div.style.height = `${cfg.size[1]}px`;
      div.innerHTML = cfg.innerColor
        ? `<i class="fa fa-map-marker" style="color:${cfg.innerColor}"></i>`
        : '<i class="fa fa-map-marker"></i>';
      // The real awesome-markers createIcon paints the preset sprite class
      // from the CURRENT options.markerColor (the derived icon overrides
      // options before calling this, so a chassis edit re-paints the class).
      this._setIconStyles?.(div, `icon-${this.options.markerColor}`);
      return div;
    }),
    _setIconStyles: vi.fn(function (this: any, div: HTMLElement, name: string) {
      // Real L.Icon._setIconStyles appends options.className — the author
      // sprite class must survive the derived chassis swap.
      div.className =
        `awesome-marker-${name} ${this.options.className ?? cfg.className}`.trim();
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

/** A Leaflet default-icon author: an L.Icon.Default instance (the branch
 *  keys on `instanceof L.Icon.Default` first, then on createIcon -> <img>).
 *  Its createIcon returns a real <img> like Leaflet's _createImg, so the
 *  second clause also fires — the dedicated divIcon branch must take it
 *  over. */
export const makeDefaultIconAuthor = (): any => {
  const proto = (window.L as any).Icon.Default.prototype;
  const author = Object.create(proto);
  author.options = { iconSize: [25, 41], iconAnchor: [12, 41] };
  author.createIcon = vi.fn(() => document.createElement("img"));
  return author;
};

/** A plain divIcon author: NO markerColor face. The capability probe must
 *  answer "none" so the marker-color row never renders for this carrier. */
export const makePlainDivIconAuthor = () => ({
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

/** An <img>-based author (Icon.Default / iconUrl): the marker-color
 *  capability probe must answer "none" — an <img> has no awesome-markers
 *  sprite chassis. */
export const makeImgAuthor = () => ({
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

export {
  allFolded,
  attachWithGroup,
  attachedPanel,
  findItem,
  initFixture,
  installLeafletGlobals,
  makePane,
  oneOverlay,
  overlayFoldBtn,
  polygonLayer,
  polygonLayerWith,
  polygonLayerWithoutBounds,
  polygonLayerWithStyle,
  pressKey,
  trackMembership,
  GridLayer,
  TileLayer,
};
