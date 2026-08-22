// core/layer/type — shared layer-management type contracts.
// Pure types, no DOM / CONF dependency. LayerRegistry, LayerFactory, and the
// LayerAPI facade all implement these; global.d.ts re-exports them so other
// components (MeasureControl / HeatmapControl / ExportControl) keep the same
// global names.

/** Options for registerLayer / createLayerInfo. */
export interface RegisterLayerOpts {
  id: string;
  name?: string | null;
  layer?: L.Layer | null;
  isBase?: boolean;
  paneName?: string | null;
  labelPane?: string | null;
  iconSvg?: string | null;
  visible?: boolean;
  canvas?: HTMLCanvasElement | null;
  onToggle?: ((visible: boolean) => void) | null;
  onZIndex?: ((z: number) => void) | null;
  [key: string]: unknown;
}

/** A layer entry in the ordered registry (read-only view). */
export interface LayerInfo {
  id: string;
  name: string;
  layer: L.Layer | null;
  visible: boolean;
  isBase: boolean;
  paneName: string | null;
  labelPane?: string | null;
  iconSvg: string | null;
  type: string | null;
  /** Canvas element registered via createCanvas (e.g. HeatmapControl).
   *  ExportControl renders these as standalone canvases with lifecycle hooks. */
  canvas?: HTMLCanvasElement | null;
  isLabel?: boolean;
  /** Visibility callback fired by LayerControl toggle (e.g. heatmap show/hide). */
  onToggle?: ((visible: boolean) => void) | null;
  /** z-index callback fired by enforceOrder (e.g. heatmap canvas ordering). */
  onZIndex?: ((z: number) => void) | null;
  [key: string]: unknown;
}

/** Leaflet layer with a custom `isLabel` flag (foliplus adds it). */
export interface LabelAwareLayer extends L.Layer {
  isLabel?: boolean;
  options: L.LayerOptions & {
    renderer?: L.Renderer;
    pane?: string;
    paneSet?: boolean;
  };
}

/** Options for `LayerAPI.createLayers`. */
export interface CreateLayersOpts {
  id: string;
  name?: string;
  graphPane?: string;
  labelPane?: string;
  iconSvg?: string;
}

/** Options for `LayerAPI.createCanvas`. */
export interface CreateCanvasOpts {
  id: string;
  name?: string;
  className?: string;
  iconSvg?: string;
  onToggle?: ((visible: boolean) => void) | null;
  onZIndex?: ((z: number) => void) | null;
}

/** Return type of `LayerAPI.createCanvas`. */
export interface CreateCanvasAPI {
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
}

/** Return type of `LayerAPI.createLayers`. */
export interface CreateLayersAPI {
  mainLayer: L.LayerGroup;
  addLayer: (layer: L.Layer, isLabel?: boolean) => L.Layer;
  removeLayer: (...items: (L.Layer | null | undefined)[]) => void;
  clearLayers: () => void;
  register: () => void;
  unregister: () => void;
  registered: () => boolean;
  bringToFront: () => void;
}

/** LayerControl public API, exposed on `map.foliplus.LayerAPI`.
 *
 * Two implementations must satisfy this contract:
 *   - LayerManager (full: registry + sorting + panel integration)
 *   - ensureLayerAPI's lightweight default (createLayers/createCanvas only;
 *     registry/query methods are no-ops returning empty results)
 */
export interface LayerAPI {
  /** `true` only when LayerControl (LayerManager) installed this LayerAPI.
   * ensureLayerAPI's lightweight stub sets this to `false`.
   * Used by requireLayerAPI to distinguish a real LayerControl from the
   * lightweight default.
   */
  isLayerControl: boolean;
  /** Ordered array of layers (frozen read-only snapshot of the registry). */
  layers: readonly LayerInfo[];
  /** Register a layer; returns its row element (or null on failure). */
  registerLayer: (opts: RegisterLayerOpts) => HTMLElement | null;
  /** Unregister and remove a layer; returns true if removed. */
  unregisterLayer: (id: string) => boolean;
  /** Bring a registered overlay layer to the front. */
  bringLayerToFront: (id: string) => void;
  createCanvas: (opts: CreateCanvasOpts) => CreateCanvasAPI;
  createLayers: (opts: CreateLayersOpts) => CreateLayersAPI;
  extractPoints: (
    id: string,
  ) => Array<{ lat: number; lng: number; marker: L.Marker | L.CircleMarker }>;
  getLayerPanes: (layer: L.Layer) => string[];
  getLayersByType: (
    type: string,
  ) => Array<{ id: string; name: string; layer: L.Layer | null }>;
}
