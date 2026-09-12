// core/layer/type — shared layer-management type contracts.
// Pure types, no DOM / CONF dependency. LayerRegistry, LayerFactory, and the
// LayerAPI facade all implement these; global.d.ts re-exports them so other
// components (MeasureControl / HeatmapControl / ExportControl) keep the same
// global names.

/** Options for registerLayer / createLayerInfo. */
interface RegisterLayerOpts {
  id: string;
  name?: string | null;
  layer?: L.Layer | null;
  isBase?: boolean;
  paneName?: string | null;
  /**
   * Sub-panes for this layer, ordered by z ascending. The k-th name gets
   * `CHILD_PANE_OFFSET[k]` in `PaneManager.bumpPanes`. Empty or absent
   * means the layer has a single flat pane (its `paneName`).
   *
   * Was `labelPane?: string | null` — that name was MeasureControl-specific
   * and couldn't express a second, third, or fourth sub-pane. Measuring a
   * circle now puts nodes in a middle pane between paths and labels; this
   * field names that third slot without renaming core.
   */
  subPanes?: string[];
  iconSvg?: string | null;
  visible?: boolean;
  canvas?: HTMLCanvasElement | null;
  onToggle?: ((visible: boolean) => void) | null;
  onZIndex?: ((z: number) => void) | null;
  /** Third-party feature count provider (Canvas layers require this; FeatureGroup
   *  layers use the built-in fallback via forEachLeaf). Null means 'don't render'. */
  featureCountProvider?: (() => number) | null;
  /** Optional geographic-bounds provider. Canvas layers have no Leaflet layer
   *  to derive bounds from, so they supply this for layer focus to work. */
  getBounds?: (() => L.LatLngBounds | null) | null;
  [key: string]: unknown;
}

/** A layer entry in the ordered registry (read-only view). */
interface LayerInfo {
  id: string;
  name: string;
  layer: L.Layer | null;
  visible: boolean;
  isBase: boolean;
  paneName: string | null;
  /** Sub-panes (see `RegisterLayerOpts.subPanes`). Ordered by z ascending. */
  subPanes: string[];
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
  /** Third-party feature count provider. Null means 'don't render count'. */
  featureCountProvider?: (() => number) | null;
  /** Optional geographic-bounds provider (Canvas layers). See RegisterLayerOpts. */
  getBounds?: (() => L.LatLngBounds | null) | null;
  [key: string]: unknown;
}

/** Leaflet layer with a custom `isLabel` flag (foliplus adds it). */
interface LabelAwareLayer extends L.Layer {
  isLabel?: boolean;
  options: L.LayerOptions & {
    renderer?: L.Renderer;
    pane?: string;
    paneSet?: boolean;
  };
}

/** Options for `LayerAPI.createLayers`. */
interface CreateLayersOpts {
  id: string;
  name?: string;
  /**
   * Sub-panes this layer's content may live in, ordered by z ascending.
   *
   * The first entry's `name` is the layer's base pane and doubles as
   * `RegisterLayerOpts.paneName`. Every name is used as the z-target for
   * `PaneManager.bumpPanes` at the layer's base z; entries past the first
   * get successive offsets from `CHILD_PANE_OFFSET`.
   *
   * Entries with `isLabel: true` mark their leaves with the `isLabel` flag,
   * which `countFeatureGeometry` / `util.getGeometryType` use to exclude
   * label leaves from feature-geometry counts.
   *
   * Was `{ graphPane?: string; labelPane?: string }` — the pair hard-coded
   * a two-pane shape (paths under labels) that couldn't express a node
   * pane between them, and it made core aware of measure-specific roles.
   * An ordered entry list lets the caller name any N panes in any order;
   * core only knows they exist and paints them above the base by index.
   *
   * When empty or absent, the layer is a single flat layer with no sub-panes.
   */
  panes?: Array<{ name: string; isLabel?: boolean }>;
  iconSvg?: string;
  /** Optional callback returning the number of features in this layer.
   *  When set, LayerControl's count column uses this instead of the default
   *  countFeatureGeometry (which walks all leaf geometries). */
  featureCountProvider?: (() => number) | null;
}

/** Options for `LayerAPI.createCanvas`. */
interface CreateCanvasOpts {
  id: string;
  name?: string;
  className?: string;
  iconSvg?: string;
  onToggle?: ((visible: boolean) => void) | null;
  onZIndex?: ((z: number) => void) | null;
  /** Optional callback returning the number of features in this layer.
   *  When set, LayerControl's count column uses this instead of returning
   *  null (the default for Canvas layers). */
  featureCountProvider?: (() => number) | null;
  /** Optional callback returning the canvas layer's geographic bounds, so
   *  LayerControl can focus it (Canvas layers have no Leaflet layer). */
  getBounds?: (() => L.LatLngBounds | null) | null;
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
}

/** Return type of `LayerAPI.createLayers`. */
interface CreateLayersAPI {
  mainLayer: L.LayerGroup;
  /**
   * Add a layer into this layer's tree, pinned to the given sub-pane.
   *
   * `paneName` must be one of the pane names passed via `createLayers`'s
   * `opts.panes` (component-defined — `MeasureControl/const.ts:PANES`
   * supplies the values, so callers never write pane-name string literals).
   * Passing a name not in that list routes to the base layerGroup and
   * silently ignores the pin; that is the same behavior as an empty
   * `opts.panes` — the layer goes in as-is.
   *
   * Was `(layer, isLabel?: boolean) => L.Layer`, which was a single boolean
   * dispatch between graph and label. `isNode` had to be added to that
   * dispatch for MeasureControl to keep nodes above paths — each new role
   * meant another boolean. `paneName` accepts a component-owned string and
   * scales to any number of roles without another parameter.
   */
  addLayer: (layer: L.Layer, paneName?: string) => L.Layer;
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
interface LayerAPI {
  /** Diagnostic marker (true = LayerManager, false = lightweight stub).
   * Not authoritative for dependency checks — use isRealLayerControl, which
   * asserts the registry-delegating `layers` getter that only LayerManager
   * has.  Kept for ad-hoc logging / debugging convenience.
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
  /** Return the number of geometric features in a registered layer.
   *  Null when the layer cannot be counted (e.g. Canvas without provider). */
  getFeatureCount?: (id: string) => number | null;
}

export type {
  CreateCanvasAPI,
  CreateCanvasOpts,
  CreateLayersAPI,
  CreateLayersOpts,
  LabelAwareLayer,
  LayerAPI,
  LayerInfo,
  RegisterLayerOpts,
};
