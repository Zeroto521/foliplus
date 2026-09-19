/**
 * Ambient declarations for globals that cannot be reached by a normal import.
 *
 * Three origins:
 * - The per-control IIFE wrapper (`BaseControl._compile_component_template`)
 *   binds `map` and `CONF` as free variables.
 * - The shared runtime (`runtime/index.ts`) bootstraps `window.foliplus`.
 * - CDN scripts set their own globals — `L` (Leaflet), `turf`, `chroma`,
 *   `h3`, `gcoord`, `ss`, `GeoTIFF`, `pako`.
 *
 * `L` is declared as both a `const` (value) and a `namespace` (type),
 * so code can write `L.Control` in type positions and `L.control()`
 * in value positions — matching the real Leaflet global.
 *
 * Libraries whose used subset has no usable typings (turf v7, gcoord,
 * simple-statistics) are described inline; chroma, h3, geotiff and pako
 * are typed from their packages.
 */
import type * as ChromaJs from "chroma-js";
import type * as GeoJSON from "geojson";
import type * as Leaflet from "leaflet";
import type { EventBus as CoreEventBus } from "#core/event/EventBus.js";
import type { ProviderConfig } from "#core/geocode/type.js";
import type {
  CreateCanvasAPI as CoreCreateCanvasAPI,
  CreateLayersAPI as CoreCreateLayersAPI,
  LayerAPI as CoreLayerAPI,
  LayerInfo as CoreLayerInfo,
} from "#core/layer/type.js";
import type { ModeManager as CoreModeManager } from "#core/mode.js";
import type { NumberStyle } from "#common/format.js";
import type { LocaleTables } from "#common/locale.js";

// ── Inline CDN typings (no usable @types) ───────────────────────

/** Turf.js (CDN v7). Only the subset used by foliplus. */
type Turf = {
  distance: (a: GeoJSON.Feature, b: GeoJSON.Feature, opts?: object) => number;
  bearing: (a: GeoJSON.Feature, b: GeoJSON.Feature) => number;
  midpoint: (a: GeoJSON.Feature, b: GeoJSON.Feature) => GeoJSON.Feature;
  area: (polygon: GeoJSON.Feature) => number;
  point: (coords: number[]) => GeoJSON.Feature;
  polygon: (rings: number[][][]) => GeoJSON.Feature;
  circle: (
    coord: [number, number],
    radius: number,
    options: { steps?: number; units?: "kilometers" },
  ) => GeoJSON.Feature<GeoJSON.Polygon>;
};

/** gcoord (CDN). Only the subset used by foliplus. */
type Gcoord = {
  transform: (coords: number[], from: number, to: number) => number[];
  WGS84: number;
  GCJ02: number;
  BD09: number;
};

/** simple-statistics (CDN). */
type SimpleStats = {
  ckmeans: (data: number[], n: number) => number[][];
  quantileSorted: (sorted: number[], p: number) => number;
};

// ── Global declarations ────────────────────────────────────────

/** Augment Leaflet's Map with internal properties we use. */
declare module "leaflet" {
  interface Map {
    _layers: Record<string, L.Layer>;
    /**
     * Pane element registry. `createPane()` writes here and `getPane()` reads
     * it — pane removal must clear the entry so `createPane()` rebuilds instead
     * of reusing a detached element.
     */
    _panes: Record<string, HTMLElement>;
    /** Per-pane renderer registry. `getRenderer()` fills this lazily and
     *  re-adds any renderer it finds that is off the map, so a stale entry
     *  must be cleared whenever its pane is removed. */
    _paneRenderers: Record<string, L.Renderer>;
    isFullscreen?: boolean;
    /** Per-map foliplus API namespace, set piecemeal by the ensure* factories. */
    foliplus?: MapFoliplus;
  }
  interface Layer {
    _layers: Record<string, L.Layer>;
    /** Detached Leaflet internals used by core/layer setInteractive. */
    _path?: SVGElement;
    _icon?: HTMLElement;
    _container?: HTMLElement;
    _initInteraction?: () => void;
  }
  interface LayerGroup {
    _layers: Record<string, L.Layer>;
  }
  interface LayerOptions {
    paneSet?: boolean;
  }
  interface TileLayer {
    // Leaflet keeps the tile URL template in _url (no public accessor).
    _url: string;
  }
  interface Popup {
    // The close button Leaflet builds when closeButton is enabled.
    _closeButton?: HTMLAnchorElement;
  }
  interface CRS {
    /** Geodesic destination (leaflet-geodesy plugin, CDN). */
    destination?: (
      latlng: L.LatLngExpression,
      distance: number,
      bearing: number,
    ) => L.LatLng;
  }
  namespace CRS {
    // Override the @types declaration so the geodesy-augmented Earth has destination().
    const Earth: CRS & {
      destination: (
        latlng: L.LatLngExpression,
        distance: number,
        bearing: number,
      ) => L.LatLng;
    };
  }
}

declare global {
  /** Per-component config injected by the Jinja2 IIFE. Fields are runtime-defined. */
  interface ComponentConfig {
    name: string;
    /** Locale tables written by `BaseControl._config_block` for every control. */
    locale_tables?: LocaleTables;
    locale_code?: string;
    position?: Leaflet.ControlPosition;
    mode?: string;
    zoom?: number;
    provider?: string | ProviderConfig;
    provider_config?: Record<string, unknown> | null;
    data?: Array<{ name: string; id: string; isBase: boolean }>;
    show_bearing?: boolean;
    label_show?: boolean;
    label_collide?: boolean;
    show_zoom?: boolean;
    show_live_coords?: boolean;
    agg?: string;
    method?: string;
    n_classes?: number;
    field?: string;
    color_scheme?: string;
    border_weight?: number;
    border_color?: string;
    border_opacity?: number;
    fill_opacity?: number;
    label_color?: string;
    label_size?: number;
    label_format?: NumberStyle;
    hide_self?: boolean;
    hide_others?: boolean;
    max_pixels?: number;
    quality?: number;
    scale?: string | number;
    background?: string;
    timeout?: number;
    filename?: string;
    format?: string;
    export_format?: string;
    schemes?: string[];
    [key: string]: unknown;
  }

  /** Runtime helpers injected by the foliplus Python wrapper.
   * `runtime/index.ts` is the single builder of this object — members added
   * there must land here or they silently type as `unknown`.
   *
   * Hint methods deliberately do NOT appear on this interface: `showHint` /
   * `hideHint` / `registerHintIcon` are per-map and live only on
   * `map.foliplus` (see {@link MapFoliplus}). The hint *module* factory
   * `ensureHint` is what reaches the per-map namespace. */
  interface Foliplus {
    isInitialized: boolean;
    /** Build version (`git describe`), set once by the shared runtime. */
    version: string;
    /** Hint module: per-map manager factory + shared icon registry. */
    hint: Record<string, unknown>;
    /** Leaflet `BaseControl` base class shared by every component. */
    BaseControl: Record<string, unknown>;
    reverseGeocode: (
      map: Leaflet.Map,
      lng: number | string,
      lat: number | string,
      code?: string,
      provider?: string | ProviderConfig,
      providerConfig?: Record<string, unknown> | null,
    ) => Promise<string>;
    geocode: (
      map: Leaflet.Map,
      address: string,
      code?: string,
      provider?: string | ProviderConfig,
      providerConfig?: Record<string, unknown> | null,
    ) => Promise<{ lng: number; lat: number; display_name: string } | null>;
    cacheSuggestion: (
      map: Leaflet.Map,
      address: string,
      lng: number,
      lat: number,
      displayName: string,
      provider?: string | ProviderConfig,
      providerConfig?: Record<string, unknown> | null,
    ) => void;
    _TABLES: LocaleTables;
    /** Shared core modules, exposed by the generated `_shared-registry.ts`;
     *  `runtime/index.ts` also writes `component` and `mode` directly. */
    core: Record<string, unknown>;
  }

  const L: typeof Leaflet;
  namespace L {
    type ControlOptions = Leaflet.ControlOptions;
    type Control = Leaflet.Control;
    type Map = Leaflet.Map;
    type Marker = Leaflet.Marker;
    type Popup = Leaflet.Popup;
    type Layer = Leaflet.Layer;
    type LayerGroup = Leaflet.LayerGroup;
    type Renderer = Leaflet.Renderer;
    type SVG = Leaflet.SVG;
    type LeafletEvent = Leaflet.LeafletEvent;
    type LeafletMouseEvent = Leaflet.LeafletMouseEvent;
    type LeafletEventHandlerFn = Leaflet.LeafletEventHandlerFn;
    type LatLngExpression = Leaflet.LatLngExpression;
    type LatLng = Leaflet.LatLng;
    type LatLngBounds = Leaflet.LatLngBounds;
    type CircleMarker = Leaflet.CircleMarker;
    type DivIcon = Leaflet.DivIcon;
    type Polyline = Leaflet.Polyline;
    type Polygon = Leaflet.Polygon;
    type Circle = Leaflet.Circle;
    type LayerOptions = Leaflet.LayerOptions;
    type Path = Leaflet.Path;
    type PathOptions = Leaflet.PathOptions;
    type GridLayer = Leaflet.GridLayer;
    type GridLayerOptions = Leaflet.GridLayerOptions;
    type TileLayer = Leaflet.TileLayer;
    type TileLayerOptions = Leaflet.TileLayerOptions;
    type CRS = Leaflet.CRS;
  }

  /** A layer entry in the LayerControl ordered registry (read-only view). */
  type LayerInfo = CoreLayerInfo;

  /** A persisted MeasureControl measurement.
   * Unit conventions: | totalDistance / radius / segments[].distance => meters;
   * segments[].bearing => degrees (0-360, clockwise from north);
   * area => square meters; coordinates => longitude/latitude in degrees. */
  interface MeasureData {
    id?: string;
    type: string;
    lng?: number;
    lat?: number;
    address?: string | null;
    points?: Array<{ lng: number; lat: number }>;
    segments?: Array<{ lng: number; lat: number; distance: number; bearing: number }>;
    totalDistance?: number;
    area?: number;
    center?: { lng: number; lat: number };
    target?: { lng: number; lat: number };
    radius?: number;
    [key: string]: unknown;
  }

  /** Return type of `LayerAPI.createCanvas`. */
  type CreateCanvasAPI = CoreCreateCanvasAPI;

  /** Return type of `LayerAPI.createLayers`. */
  type CreateLayersAPI = CoreCreateLayersAPI;

  /** Per-map foliplus API namespace, attached as `map.foliplus`.
   *
   * All members are required, but each is seeded by exactly one factory
   * (ensureHint / ensureLayerAPI / ensureEvents / ensureModes /
   * ensureInteraction) which runs on first use — code must therefore only
   * reach a member through the factory, never assume the namespace is
   * complete. {@link ensureMapFoliplus} owns the `LayerAPI: null` seed; it is
   * the single place that lies about the interface, and it is load-bearing:
   * the factories read their members off `map.foliplus!` unguarded, so
   * `MapFoliplus` must stay a complete object or those call sites become
   * TS2722. */
  interface MapFoliplus {
    /** LayerControl public API (always available; lightweight until LayerControl upgrades it). */
    LayerAPI: LayerAPI;
    /** Per-map toast system (HintManager). */
    showHint: (
      key: string,
      text: string,
      duration: number,
      append?: boolean,
      subkey?: string,
      withLoadingIcon?: boolean,
    ) => void;
    hideHint: (key: string, subkey?: string) => void;
    registerHintIcon: (key: string, iconSvg: string) => void;
    /** Per-map cross-component event bus. */
    events: CoreEventBus;
    /** Per-map cross-component active-mode registry. */
    modes: CoreModeManager;
    /** Per-map interaction shortcut manager. */
    interaction: InteractionManager;
    /** Default geocode provider spec for this map, registered by provider-aware
     *  controls (e.g. SearchControl) so indirect geocoding follows it. */
    geocodeProvider?: string | ProviderConfig;
  }

  /** LayerControl public API, exposed on `map.foliplus.LayerAPI`.
   * Defined in core/layer/type.ts — implemented by both LayerManager (full)
   * and ensureLayerAPI's lightweight default. */
  type LayerAPI = CoreLayerAPI;

  /** Per-map cross-component event bus (`map.foliplus.events`). */
  type EventBus = CoreEventBus;

  /** Per-map active-mode registry (`map.foliplus.modes`). */
  type ModeManager = CoreModeManager;

  const map: Leaflet.Map;
  const foliplus: Foliplus;
  const CONF: ComponentConfig;
  /** Build-time constant: `git describe` inlined by esbuild define. */
  const __FOLIPLUS_VERSION__: string;

  const turf: Turf;
  const gcoord: Gcoord;
  const chroma: ChromaJs;
  const ss: SimpleStats;
  const h3: typeof import("h3-js");

  /** geotiff.js (CDN, ExportControl). Provides GeoTIFF.writeArrayBuffer. */
  const GeoTIFF: typeof import("geotiff");
  /** pako (CDN, ExportControl). Deflate/inflate for GeoTIFF compression. */
  const pako: typeof import("pako");

  interface Window {
    foliplus: Foliplus;
    CONF: ComponentConfig;
    L: typeof Leaflet;
    map: Leaflet.Map;
  }
}
