/**
 * Ambient declarations for globals injected at runtime by the foliplus
 * Python↔JS bridge (Leaflet, the foliplus runtime, per-control config).
 *
 * This file provides type information for globals that are NOT available
 * via normal imports — they are injected by the Jinja2 IIFE wrapper at
 * runtime (e.g. `L`, `map`, `CONF`, `foliplus`) or loaded from CDN
 * (e.g. `turf`, `chroma`, `h3`).
 *
 * `L` is declared as both a `const` (value) and a `namespace` (type),
 * so code can write `L.Control` in type positions and `L.control()`
 * in value positions — matching the real Leaflet global.
 *
 * Third-party libraries with no available @types (turf v7, gcoord,
 * simple-statistics) have their used subset described inline.
 */
import type { EventBus as CoreEventBus } from "#core/event/EventBus.js";
import type {
  CreateCanvasAPI as CoreCreateCanvasAPI,
  CreateLayersAPI as CoreCreateLayersAPI,
  LayerAPI as CoreLayerAPI,
  LayerInfo as CoreLayerInfo,
} from "#core/layer/type.js";
import type { ModeManager as CoreModeManager } from "#core/mode.js";
import type * as ChromaJs from "chroma-js";
import type * as GeoJSON from "geojson";
import type * as Leaflet from "leaflet";

// ── Runtime helpers ────────────────────────────────────────────

// ── CDN globals (no @types available) ──────────────────────────

/** Turf.js (CDN v7). Only the subset used by foliplus. */
type Turf = {
  distance: (a: GeoJSON.Feature, b: GeoJSON.Feature, opts?: object) => number;
  bearing: (a: GeoJSON.Feature, b: GeoJSON.Feature) => number;
  midpoint: (a: GeoJSON.Feature, b: GeoJSON.Feature) => GeoJSON.Feature;
  area: (polygon: GeoJSON.Feature) => number;
  point: (coords: number[]) => GeoJSON.Feature;
  polygon: (rings: number[][][]) => GeoJSON.Feature;
};

/** gcoord (CDN). */
type Gcoord = {
  transform: (coords: number[], from: number, to: number) => number[];
  WGS: number;
  WGS84: number;
  GCJ: number;
  GCJ02: number;
  BD: number;
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
    isFullscreen?: boolean;
    /** Per-map foliplus API namespace, set by ensureHint/ensureLayerAPI/ensureEvents/ensureModes. */
    foliplus?: MapFoliplus;
  }
  interface Layer {
    _layers: Record<string, L.Layer>;
  }
  interface LayerGroup {
    _layers: Record<string, L.Layer>;
  }
  interface LayerOptions {
    paneSet?: boolean;
  }
  interface Path {
    _path: SVGElement;
  }
  interface TileLayer {
    // Leaflet keeps the tile URL template in _url (no public accessor).
    _url: string;
  }
  interface AttributionControl {
    _attributions: Record<string, number>;
  }
  interface Renderer {
    _container: HTMLElement;
  }
  interface SVG {
    /** Get the renderer's container element. */
    getContainer(): HTMLElement | null;
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
    locale_code?: string;
    position?: Leaflet.ControlPosition;
    mode?: string;
    zoom?: number;
    data?: Array<{ name: string; id: string; isBase: boolean }>;
    show_bearing?: boolean;
    agg?: string;
    method?: string;
    n_classes?: number;
    field?: string;
    color_scheme?: string;
    border_weight?: number;
    border_color?: string;
    border_opacity?: number;
    fill_opacity?: number;
    label_format?: "auto" | "comma" | "int";
    label_show?: boolean;
    hide_self?: boolean;
    hide_others?: boolean;
    max_pixels?: number;
    quality?: number;
    scale?: string | number;
    isMetric?: boolean;
    background?: string;
    timeout?: number;
    filename?: string;
    format?: string;
    schemes?: string[];
    [key: string]: unknown;
  }

  /** Runtime helpers injected by the foliplus Python wrapper. */
  interface Foliplus {
    isInitialized: boolean;
    registerHintIcon: (name: string, icon: string) => void;
    showHint: (
      name: string,
      msg: string,
      duration: number,
      withLoadingIcon?: boolean | string | null,
      id?: string,
    ) => void;
    hideHint: (name: string, id?: string) => void;
    reverseGeocode: (
      map: Leaflet.Map,
      lng: number,
      lat: number,
      code?: string,
    ) => Promise<string>;
    geocode: (
      map: Leaflet.Map,
      address: string,
      code?: string,
    ) => Promise<{ lat: number; lng: number; display_name: string } | null>;
    _TABLES: Record<string, Record<string, string>>;
    /** Shared core modules (layer, event, mode). Set by _shared-registry + runtime. */
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
    type LayerEvent = Leaflet.LayerEvent;
    type LeafletMouseEvent = Leaflet.LeafletMouseEvent;
    type LeafletEventHandlerFn = Leaflet.LeafletEventHandlerFn;
    type PointExpression = Leaflet.PointExpression;
    type LatLngExpression = Leaflet.LatLngExpression;
    type LatLng = Leaflet.LatLng;
    type LatLngBounds = Leaflet.LatLngBounds;
    type CircleMarker = Leaflet.CircleMarker;
    type DivIcon = Leaflet.DivIcon;
    type Icon = Leaflet.Icon;
    type Polyline = Leaflet.Polyline;
    type Polygon = Leaflet.Polygon;
    type Circle = Leaflet.Circle;
    type MarkerOptions = Leaflet.MarkerOptions;
    type IconOptions = Leaflet.IconOptions;
    type DivIconOptions = Leaflet.DivIconOptions;
    type LayerOptions = Leaflet.LayerOptions;
    type PathOptions = Leaflet.PathOptions;
    type LeafletMouseEventHandlerFn = Leaflet.LeafletMouseEventHandlerFn;
    type LeafletKeyboardEvent = Leaflet.LeafletKeyboardEvent;
    type GridLayer = Leaflet.GridLayer;
    type GridLayerOptions = Leaflet.GridLayerOptions;
    type TileLayer = Leaflet.TileLayer;
    type TileLayerOptions = Leaflet.TileLayerOptions;
    type ImageOverlay = Leaflet.ImageOverlay;
    type CRS = Leaflet.CRS;
  }

  /** A layer entry in the LayerControl ordered registry (read-only view). */
  type LayerInfo = CoreLayerInfo;

  /** A persisted MeasureControl measurement. */
  interface MeasureData {
    id?: string;
    type: string;
    lng?: number;
    lat?: number;
    address?: string | null;
    points?: Array<{ lng: number; lat: number }>;
    segments?: Array<{ lng: number; lat: number; distance: number }>;
    totalDistance?: number;
    area?: number;
    center?: { lng: number; lat: number };
    target?: { lng: number; lat: number };
    radius?: number;
    [key: string]: unknown;
  }

  /** Return type of `LayerAPI.createCanvas`. */
  type CreateCanvasAPI = CoreCreateCanvasAPI;

  /** A canvas element extended with lifecycle hooks (used by ExportControl capture). */
  interface CanvasWithHooks extends HTMLCanvasElement {
    hooks?: { before: Array<() => void>; after: Array<() => void> };
  }

  /** Return type of `LayerAPI.createLayers`. */
  type CreateLayersAPI = CoreCreateLayersAPI;

  /** Per-map foliplus API namespace, attached as `map.foliplus`. */
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
    ) => void;
    hideHint: (key: string, subkey?: string) => void;
    registerHintIcon: (key: string, iconSvg: string) => void;
    /** Per-map cross-component event bus. */
    events: CoreEventBus;
    /** Per-map cross-component active-mode registry. */
    modes: CoreModeManager;
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
  const CONFIG: ComponentConfig;

  const turf: Turf;
  const gcoord: Gcoord;
  const chroma: ChromaJs;
  const ss: SimpleStats;
  const h3: typeof import("h3-js");

  interface Window {
    foliplus: Foliplus;
    CONF: ComponentConfig;
    CONFIG?: ComponentConfig;
    L: typeof Leaflet;
    map: Leaflet.Map;
  }
}

declare module "leaflet" {
  interface Map {
    foliplus?: MapFoliplus;
  }
}

export {};
