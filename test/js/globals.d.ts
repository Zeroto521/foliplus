// Loose global declarations for Vitest tests.
//
// Test files are mock-heavy (see the root tsconfig comment) and deliberately
// skip strict type checking. This file provides a LOOSE counterpart to the
// globals in `foliplus/js/type/global.d.ts`: every runtime-injected / CDN
// global (L/map/CONF/foliplus/turf, etc.) is `any` in value position, and
// types such as `L.Map` / `LayerInfo` are `any` in type position — mocks are
// injected at runtime by `setup.ts`. Source modules pulled into this program
// via test imports also see these loose globals, so mocks are naturally
// assignable to typed parameters.
//
// Note: this file only affects editor checking (tsserver/tsc) for `test/js`.
// It does not affect vitest (esbuild transpiles without type checking) nor the
// root `tsconfig.json` (its include does not cover test/js).

declare const L: any;
declare namespace L {
  type Map = any;
  type Marker = any;
  type CircleMarker = any;
  type Polyline = any;
  type Polygon = any;
  type Circle = any;
  type Layer = any;
  type LayerGroup = any;
  type FeatureGroup = any;
  type LatLng = any;
  type LatLngBounds = any;
  type LatLngLiteral = any;
  type LatLngExpression = any;
  type Point = any;
  type PointExpression = any;
  type Bounds = any;
  type BoundsExpression = any;
  type DivIcon = any;
  type Icon = any;
  type SVG = any;
  type Renderer = any;
  type Canvas = any;
  type Path = any;
  type CRS = any;
  type Control = any;
  type Popup = any;
  type Tooltip = any;
  type GridLayer = any;
  type TileLayer = any;
  type ImageOverlay = any;
  type Evented = any;
  type LeafletEvent = any;
  type LeafletMouseEvent = any;
  type LeafletKeyboardEvent = any;
  type LeafletEventHandlerFn = any;
  type MarkerOptions = any;
  type DivIconOptions = any;
  type IconOptions = any;
  type LayerOptions = any;
  type PathOptions = any;
  type InteractiveLayerOptions = any;
  type GridLayerOptions = any;
  type TileLayerOptions = any;
  type CircleMarkerOptions = any;
  type PolylineOptions = any;
  type PolygonOptions = any;
  type CircleOptions = any;
  type PopupOptions = any;
  type TooltipOptions = any;
  type ControlOptions = any;
  type RendererOptions = any;
}

// Types from `global.d.ts`'s `declare global` block (loosened to `any` for tests).
type LayerInfo = any;
type LayerAPI = any;
type CreateLayersAPI = any;
type CreateCanvasAPI = any;
type CanvasWithHooks = any;
type MeasureData = any;
type Foliplus = any;
type ComponentConfig = any;

// Loose GeoJSON namespace (turf-dependent source modules reference `GeoJSON.*`).
declare namespace GeoJSON {
  type Point = any;
  type Feature = any;
  type FeatureCollection = any;
  type Geometry = any;
  type GeometryCollection = any;
  type LineString = any;
  type Polygon = any;
  type MultiPolygon = any;
  type Position = any;
  type GeoJsonProperties = any;
}

declare var map: any;
declare var CONF: any;
declare var CONFIG: any;
declare var foliplus: any;
declare var turf: any;
declare var gcoord: any;
declare var chroma: any;
declare var ss: any;
declare var h3: any;

interface Window {
  foliplus: any;
  L: any;
  CONF: any;
  CONFIG?: any;
  map: any;
}
