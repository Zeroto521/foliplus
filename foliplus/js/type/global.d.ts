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
import type * as ChromaJs from "chroma-js";
import type * as GeoJSON from "geojson";
import type * as Leaflet from "leaflet";

// ── Runtime helpers ────────────────────────────────────────────

/** Runtime helpers injected by the foliplus Python wrapper. */
interface Foliplus {
  isInitialized: boolean;
  /** LayerControl public API, null until LayerControl is added. */
  LayerAPI: LayerAPI | null;
  registerHintIcon: (name: string, icon: string) => void;
  showHint: (name: string, msg: string, duration: number, withLoadingIcon?: boolean | string | null, id?: string) => void;
  hideHint: (name: string, id?: string) => void;
  reverseGeocode: (
    map: Leaflet.Map,
    lng: number,
    lat: number,
    code?: string,
  ) => Promise<string>;
  _TABLES: Record<string, Record<string, string>>;
}

// ── Component config ───────────────────────────────────────────

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
    _url: string;
  }
  interface AttributionControl {
    _attributions: Record<string, number>;
  }
  interface Renderer {
    _container: HTMLElement;
  }
  interface GridLayer {
    _url: string;
  }
}

declare global {
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
    type LeafletEvent = Leaflet.LeafletEvent;
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
    type PathOptions = Leaflet.PathOptions;
    type LeafletMouseEventHandlerFn = Leaflet.LeafletMouseEventHandlerFn;
    type LeafletKeyboardEvent = Leaflet.LeafletKeyboardEvent;
    type GridLayer = Leaflet.GridLayer;
    type TileLayer = Leaflet.TileLayer;
    type ImageOverlay = Leaflet.ImageOverlay;
    type CRS = Leaflet.CRS;
  }

  /** A layer entry in the LayerControl ordered registry (read-only view). */
  interface LayerInfo {
    id: string;
    name: string;
    layer: L.Layer | null;
    visible: boolean;
    isBase: boolean;
    paneName: string | null;
    iconSvg: string | null;
    type: string | null;
    canvas?: HTMLCanvasElement | null;
    isLabel?: boolean;
    onToggle?: ((visible: boolean) => void) | null;
    onZIndex?: ((z: number) => void) | null;
    [key: string]: unknown;
  }

  /** Return type of `LayerAPI.createCanvas`. */
  interface CreateCanvasAPI {
    canvas: HTMLCanvasElement;
    ctx: CanvasRenderingContext2D | null;
    resize: () => void;
    getSize: () => { width: number; height: number };
    updatePosition: () => void;
    register: () => void;
    unregister: () => void;
    registered: () => boolean;
    destroy: () => void;
    bringToFront: () => void;
    setZIndex: (z: number) => void;
    setVisible: (v: boolean) => void;
    hooks?: { before: Array<() => void>; after: Array<() => void> };
  }

  /** Return type of `LayerAPI.createLayers`. */
  interface CreateLayersAPI {
    mainLayer: L.LayerGroup;
    addLayer: (layer: L.Layer, isLabel?: boolean) => L.Layer;
    removeLayer: (...items: (L.Layer | null | undefined)[]) => void;
    clearLayers: () => void;
    register: () => void;
    unregister: () => void;
    registered: () => boolean;
    bringToFront: () => void;
  }

  /** LayerControl public API, exposed on `foliplus.LayerAPI`. */
  interface LayerAPI {
    /** Ordered array of layers (read-only view of LayerRegistry). */
    layers: LayerInfo[];
    createCanvas: (opts: {
      id: string;
      name?: string;
      className?: string;
      iconSvg?: string;
      onToggle?: (visible: boolean) => void;
      onZIndex?: (z: number) => void;
    }) => CreateCanvasAPI;
    createLayers: (opts: {
      name: string;
      id: string;
      graphPane?: string;
      labelPane?: string;
      iconSvg?: string;
    }) => CreateLayersAPI;
    extractPoints: (id: string) => Array<{ lat: number; lng: number; marker?: any }>;
    getLayerPanes: (layer: L.Layer) => string[];
    getLayersByType: (type: string) => Array<{ id: string; name: string; layer: L.Layer }>;
  }

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

export { };
