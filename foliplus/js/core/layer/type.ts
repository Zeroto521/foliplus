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
   * The panes this layer paints into, in draw order. Absent means the layer
   * has a single flat pane (its `paneName`), or none at all for a GridLayer.
   *
   * The draw position is the spec's `order`, written down once by the factory
   * rather than re-derived from the index at every z write (the removed
   * `bumpPanes` + `CHILD_PANE_STEP` pair).
   *
   * Was `labelPane?: string | null` — that name was MeasureControl-specific
   * and couldn't express a second, third, or fourth pane. Measuring a circle
   * now puts nodes in a pane between paths and labels.
   */
  paneSpecs?: PaneSpec[];
  iconSvg?: string | null;
  visible?: boolean;
  /** Layer opacity in [0, 1]. Defaults to 1 (fully opaque). */
  opacity?: number;
  canvas?: HTMLCanvasElement | null;
  onToggle?: ((visible: boolean) => void) | null;
  /** Third-party feature count provider (Canvas layers require this; FeatureGroup
   *  layers use the built-in fallback via forEachLeaf). Null means 'don't render'. */
  featureCountProvider?: (() => number) | null;
  /** Style values this layer exposes to the style drawer — pulled on demand,
   *  never cached on the registry (same contract as featureCountProvider). */
  styleProvider?: (() => Record<string, unknown>) | null;
  /** Canonical style setters. Both the component's own panel and the layer
   *  drawer call these — the component owns the only copy of the value. */
  styleSetters?: Record<string, (value: unknown) => void> | null;
  /** Python CONF defaults for the delegated style fields. The drawer's Reset
   *  button calls each styleSetter with the matching default — never the
   *  localStorage-persisted value. Absent means the layer offers no Reset. */
  styleDefaults?: (() => Record<string, unknown>) | null;
  /** Optional geographic-bounds provider. Canvas layers have no Leaflet layer
   *  to derive bounds from, so they supply this for layer focus to work. */
  getBounds?: (() => L.LatLngBounds | null) | null;
  /** Data provenance shown in the layer attributes panel (a URL or filename). */
  source?: string | null;
  /** Last-update timestamp; epoch ms or any value `new Date()` can parse. */
  updatedAt?: string | number | null;
  /** Third-party label/value pairs appended to the attributes panel. */
  meta?: Record<string, string | number> | null;
}

/** A layer entry in the ordered registry (read-only view). */
interface LayerInfo {
  id: string;
  name: string;
  layer: L.Layer | null;
  visible: boolean;
  /** Layer opacity in [0, 1]. Defaults to 1 (fully opaque). */
  opacity?: number;
  isBase: boolean;
  paneName: string | null;
  /** The panes this layer paints into, in draw order. */
  paneSpecs: PaneSpec[];
  iconSvg: string | null;
  type: string | null;
  /** Canvas element registered via createCanvas (e.g. HeatmapControl).
   *  ExportControl renders these as standalone canvases with lifecycle hooks. */
  canvas?: HTMLCanvasElement | null;
  isLabel?: boolean;
  /** Visibility callback fired by LayerControl toggle (e.g. heatmap show/hide). */
  onToggle?: ((visible: boolean) => void) | null;
  /** Third-party feature count provider. Null means 'don't render count'. */
  featureCountProvider?: (() => number) | null;
  /** Style values exposed to the drawer — pull on demand, never cached. */
  styleProvider?: (() => Record<string, unknown>) | null;
  /** Canonical style setters shared by the component panel and the drawer. */
  styleSetters?: Record<string, (value: unknown) => void> | null;
  /** Python CONF defaults for the delegated style fields. See RegisterLayerOpts. */
  styleDefaults?: (() => Record<string, unknown>) | null;
  /** Optional geographic-bounds provider (Canvas layers). See RegisterLayerOpts. */
  getBounds?: (() => L.LatLngBounds | null) | null;
  /** Static caller-supplied provenance / freshness for the attributes panel.
   *  These survive a provider re-registration (merged with `??`). */
  source?: string | null;
  updatedAt?: string | number | null;
  meta?: Record<string, string | number> | null;
  /** Epoch ms of the layer's first registration. Set by the registry itself —
   *  never by the provider — so a re-registration keeps the original value. */
  registeredAt?: number;
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

/** What a surface's pane is for. `annotation` and `preview` have no producer
 *  yet — they arrive with the components that declare them (label pane,
 *  measure preview) — but they are spelled here so the union is the contract
 *  rather than a local invention. */
type PaneRole = "base" | "sub" | "annotation" | "preview";

/** One pane a surface declares: what it is for, where it sits in the layer's
 *  own draw stack, and the pane it paints into.
 *
 *  `role` and `order` are a **frozen contract whose readers have not landed
 *  yet — read this before deleting either as unused**:
 *    - `order` is the draw offset z arithmetic reads. It replaced the flat
 *      `subPanes: string[]` whose position was re-derived at every z write
 *      (the removed `bumpPanes` + `CHILD_PANE_STEP` pair).
 *    - `role` is what the planned z convergence (`z = f(layerIndex, role)`)
 *      and the per-role renderer defaults will read, and it is where the
 *      `annotation` / `preview` panes get their name once the components that
 *      declare them exist.
 *
 *  Today `LayerFactory` derives both from the entry's index, so nothing
 *  branches on them yet. That is why they look write-only. */
interface PaneSpec {
  role: PaneRole;
  /** Draw offset above the layer's base z. Unique within one surface, 0 for
   *  the base pane. This is the value z arithmetic reads. */
  order: number;
  name: string;
  /** Marks the leaves routed here as labels (`isLabel`), which
   *  `countFeatureGeometry` / `getGeometryType` exclude from
   *  feature-geometry counts. */
  isLabel?: boolean;
}

/** One physical pane a surface paints into: the `leaflet-pane` div, the
 *  renderer it holds (null for canvas and renderer-less panes), the role the
 *  surface gives it, and its offset above the layer's base z. */
interface PaneHandle {
  readonly role: PaneRole;
  readonly order: number;
  readonly name: string;
  /** The pane element — the single target of every face-level write
   *  (z-index today; opacity / display / filter in later steps). */
  readonly element: HTMLElement;
  /** The SVG renderer Path content in this pane must be pinned to, or null. */
  renderer: L.SVG | null;
}

/** The rendering face of one registered layer: which panes carry its content,
 *  and (later) the derived state those panes are written from.
 *
 *  Replaces the two ad-hoc records the layer manager used to keep — the
 *  stamp-keyed fallback-pane map and the `options.paneSet` flag that stood in
 *  for "already moved" — with the real state. See core/layer/LayerSurface.ts
 *  for the two invariants (materialize-before-add, fixed pane set). */
interface LayerSurface {
  readonly id: string;
  readonly layer: L.Layer | null;
  /** The panes this layer paints into, base first. Fixed once materialized. */
  readonly panes: readonly PaneHandle[];
  materialized: boolean;
  /** Release the panes this surface created. Not called by
   *  `LayerManager.destroy()`: that drops the registry without taking the
   *  registered layers off the map, so their panes are still painting. */
  destroy: () => void;
  /** Write the layer's position-based base z onto every pane it paints into,
   *  adding each pane's own draw offset.
   *  @returns false when the surface paints through no pane of its own — a
   *    `GridLayer` carries its z on the layer itself. */
  setZ: (z: number) => boolean;
  /** Lift every pane to an absolute base z, keeping each pane's draw offset so
   *  the layer's internal order survives the lift. `restoreZ` puts the stack
   *  back.
   *  @returns false when the surface paints through no pane of its own, or is
   *    already lifted. */
  setZOverride: (z: number) => boolean;
  /** Undo the last `setZOverride`.
   *  @returns false when nothing was overridden. */
  restoreZ: () => boolean;
}

/** One entry in `CreateLayersOpts.panes`. The caller names the pane and its
 *  label semantics; the role and draw order come from the entry's position in
 *  the list — the first is the base, everything after it is a `sub`. */
interface CreateLayersPane {
  name: string;
  /** Marks the leaves routed here as labels. See `PaneSpec.isLabel`. */
  isLabel?: boolean;
}

/** Options for `LayerAPI.createLayers`. */
interface CreateLayersOpts {
  id: string;
  name?: string;
  /**
   * The panes this layer's content may live in, in draw order.
   *
   * The first entry's `name` is the layer's base pane and doubles as
   * `RegisterLayerOpts.paneName`. Each entry's draw offset is its position in
   * this list, written down once as `PaneSpec.order` and read back at every z
   * write — never re-derived from an array index.
   *
   * Was `{ graphPane?: string; labelPane?: string }` — the pair hard-coded
   * a two-pane shape (paths under labels) that couldn't express a node pane
   * between them, and it made core aware of measure-specific roles. An
   * ordered entry list lets the caller name any N panes in any order.
   *
   * When empty or absent, the layer is a single flat layer with no sub-panes.
   */
  panes?: CreateLayersPane[];
  iconSvg?: string;
  /** Optional callback returning the number of features in this layer.
   *  When set, LayerControl's count column uses this instead of the default
   *  countFeatureGeometry (which walks all leaf geometries). */
  featureCountProvider?: (() => number) | null;
  /** See RegisterLayerOpts. */
  styleProvider?: (() => Record<string, unknown>) | null;
  /** See RegisterLayerOpts. */
  styleSetters?: Record<string, (value: unknown) => void> | null;
  /** See RegisterLayerOpts. */
  styleDefaults?: (() => Record<string, unknown>) | null;
}

/** Options for `LayerAPI.createCanvas`. */
interface CreateCanvasOpts {
  id: string;
  name?: string;
  className?: string;
  iconSvg?: string;
  onToggle?: ((visible: boolean) => void) | null;
  /** Optional callback returning the number of features in this layer.
   *  When set, LayerControl's count column uses this instead of returning
   *  null (the default for Canvas layers). */
  featureCountProvider?: (() => number) | null;
  /** See RegisterLayerOpts. */
  styleProvider?: (() => Record<string, unknown>) | null;
  /** See RegisterLayerOpts. */
  styleSetters?: Record<string, (value: unknown) => void> | null;
  /** See RegisterLayerOpts. */
  styleDefaults?: (() => Record<string, unknown>) | null;
  /** Optional callback returning the canvas layer's geographic bounds, so
   *  LayerControl can focus it (Canvas layers have no Leaflet layer). */
  getBounds?: (() => L.LatLngBounds | null) | null;
  /** Data provenance shown in the layer attributes panel (a URL or filename). */
  source?: string | null;
  /** Last-update timestamp; epoch ms or any value `new Date()` can parse. */
  updatedAt?: string | number | null;
  /** Third-party label/value pairs appended to the attributes panel
   *  (e.g. HeatmapControl's source layer + aggregation field). */
  meta?: Record<string, string | number> | null;
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

/** Content options for `createSurface` — the discriminated-union branch. */
type SurfaceContentOpts =
  | { kind: "layers"; panes?: CreateLayersPane[] }
  | {
      kind: "canvas";
      className?: string;
      onToggle?: ((visible: boolean) => void) | null;
      getBounds?: (() => L.LatLngBounds | null) | null;
      source?: string | null;
      updatedAt?: string | number | null;
      meta?: Record<string, string | number> | null;
    };

/** Options for `LayerFactory.createSurface`. */
interface SurfaceOpts {
  id: string;
  name?: string;
  iconSvg?: string;
  content: SurfaceContentOpts;
  featureCountProvider?: (() => number) | null;
  styleProvider?: (() => Record<string, unknown>) | null;
  styleSetters?: Record<string, (value: unknown) => void> | null;
  styleDefaults?: (() => Record<string, unknown>) | null;
}

/** Content handle returned by `createSurface` — the discriminated-union branch. */
type SurfaceContentHandle =
  | {
      kind: "layers";
      mainLayer: L.LayerGroup;
      addLayer: (layer: L.Layer, paneName?: string) => L.Layer;
      removeLayer: (...items: (L.Layer | null | undefined)[]) => void;
      clearLayers: () => void;
    }
  | {
      kind: "canvas";
      canvas: HTMLCanvasElement;
      ctx: CanvasRenderingContext2D | null;
      resize: () => void;
      getSize: () => { width: number; height: number };
      updatePosition: () => void;
      setZIndex: (z: number) => void;
      setVisible: (v: boolean) => void;
    };

/** Return type of `LayerFactory.createSurface`. Discriminated union:
 *  the canvas variant carries a `destroy` (canvas panes must be cleaned up);
 *  the layers variant does not (Leaflet layers are removed by the registry). */
type SurfaceHandle =
  | {
      content: Extract<SurfaceContentHandle, { kind: "layers" }>;
      register: () => void;
      unregister: () => void;
      registered: () => boolean;
      bringToFront: () => void;
    }
  | {
      content: Extract<SurfaceContentHandle, { kind: "canvas" }>;
      register: () => void;
      unregister: () => void;
      registered: () => boolean;
      bringToFront: () => void;
      destroy: () => void;
    };

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
  /**
   * Programmatically set a layer's visibility — the same transition the panel
   * checkbox performs: the Leaflet layer is added to or removed from the map,
   * callback-only (canvas) layers get `onToggle`, the panel row's checkbox and
   * toggle-all control follow, and the persisted hidden set is updated so the
   * choice survives a reload.
   *
   * This closes the write side of the visibility contract. `LayerInfo.visible`,
   * `onToggle`, and the persisted hidden set all existed already, but only the
   * panel's checkbox wrote them, so a host page that wanted to hide layers by
   * id had to synthesize a DOM event against a row it does not own.
   *
   * @returns true if the layer was found and its visibility was set.
   */
  setVisible: (id: string, visible: boolean) => boolean;
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
  /** Stamp `updatedAt` to now for a runtime mutation that does not re-register. */
  touchLayer?: (id: string) => boolean;
  /** Move a layer one position toward index 0, respecting group boundaries.
   *  False if already at the top, at a group boundary, or unknown.
   *  Only LayerManager implements this — the lightweight stub has no registry. */
  moveLayerUp?: (id: string) => boolean;
  /** Move a layer one position away from index 0, respecting group boundaries.
   *  False if already at the bottom of its group or unknown.
   *  Only LayerManager implements this — the lightweight stub has no registry. */
  moveLayerDown?: (id: string) => boolean;
}

export type {
  CreateCanvasAPI,
  CreateCanvasOpts,
  CreateLayersAPI,
  CreateLayersOpts,
  CreateLayersPane,
  LabelAwareLayer,
  LayerAPI,
  LayerInfo,
  LayerSurface,
  PaneHandle,
  PaneRole,
  PaneSpec,
  RegisterLayerOpts,
  SurfaceContentHandle,
  SurfaceContentOpts,
  SurfaceHandle,
  SurfaceOpts,
};
