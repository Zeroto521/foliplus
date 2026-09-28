// core/layer/type — shared layer-management type contracts.
// Pure types, no DOM / CONF dependency. LayerRegistry, LayerFactory, and the
// LayerAPI facade all implement these; global.d.ts re-exports them so other
// components (MeasureControl / HeatmapControl / ExportControl) keep the same
// global names.

/** What a layer's surface can actually be asked to do, computed once at
 *  materialization by `LayerSurface` (which alone knows the panes it owns and
 *  the shape of its content — runtime probes pin each value).
 *
 *  Read-only on `LayerInfo` as a projection, never persisted: a caller-supplied
 *  `capabilities` in `RegisterLayerOpts` would let a third party claim support
 *  it does not have, and the honest-degradation contract (never silently
 *  degrade) depends on the answer being the surface's, not the caller's. */
interface LayerCapabilities {
  /** Whether the layer's tree has a write carrier for fill: areal geometry
   *  (`L.Polygon` / `L.Circle` / `L.CircleMarker` — the last two because
   *  they extend the polygon-side ancestor) with a `setStyle` leaf.
   *    - "native" — an areal carrier exists; `setStyle({fillColor,
   *      fillOpacity})` writes through the tree. A solid-colour basemap
   *      also declares "native": the pane's paint *is* the fill.
   *    - "none"   — no areal carrier. Line-only layers (Polyline, Circle
   *      without a fill), Marker, canvas, MarkerCluster, and native setter
   *      surfaces (ImageOverlay / GridLayer) all fall out.
   *
   *  Same probe-and-cache contract as `stroke`. */
  fill: "native" | "none";
  /** Whether the layer's tree has a write carrier for stroke (border):
   *    - "native" — a `setStyle` leaf exists in the tree (a Path-family
   *      member: Polygon, Polyline, Circle, CircleMarker, Rectangle). The
   *      write walks `eachLayer` and calls `setStyle` per leaf.
   *    - "none"   — no `setStyle` leaf. Marker (Icon, divIcon) and every
   *      non-vector surface (canvas, color basemap, MarkerCluster, native
   *      ImageOverlay / GridLayer) have no vector stroke axis.
   *
   *  Probe-derived, cached per surface. The probe result is part of
   *  `SurfaceDeclaration`, so a change in the tree's shape triggers a
   *  rebuild through `matches`. */
  stroke: "native" | "none";
  /** How the layer's opacity is written:
   *    - "native" — the layer owns its own setter (`ImageOverlay.setOpacity`,
   *      `TileLayer.options.opacity`). Immediate and correct; the UI reads/writes
   *      the layer's option, not a pane.
   *    - "pane"   — we own a pane for this layer; one CSS write on the pane
   *      covers every child (SVG path / marker / divIcon / canvas element).
   *    - "none"   — no honest carrier exists. MarkerCluster's cluster icons stay
   *      in the shared `markerPane` where `eachLayer` cannot reach them, so a
   *      pane write would fade the individual markers but not the cluster —
   *      half the layer. The UI then hides the opacity control rather than
   *      offering a knob that lies. */
  opacity: "native" | "pane" | "none";
  /** Whether zoom-range visibility is honoured:
   *    - "native" — the layer's own `options.minZoom`/`maxZoom` (GridLayer).
   *    - "pane"   — we hide the pane (or skip drawing it).
   *    - "none"   — no honest carrier. A future surface type will supply this
   *      basemap once it is promoted to a real surface; today that layer is not
   *      in the registry at all, so no placeholder is emitted. */
  zoomRange: "native" | "pane" | "none";
  /** How the layer's visibility is written:
   *    - "native" — the layer is a real `L.Layer`; map membership
   *      (`map.addLayer` / `removeLayer`) is the carrier. MarkerCluster is an
   *      `L.Layer` too, so it routes here — the `isMarkerCluster` branch in
   *      `LayerSurface.detectCapabilities` only takes over opacity / zoomRange
   *      / bounds, not visibility.
   *    - "pane"   — the surface paints into a canvas element we own (createCanvas
   *      for heatmap/measure, createColor for the solid-color basemap's face);
   *      the `HIDDEN` class on that element is the carrier. One CSS write, no
   *      callback.
   *    - "none"   — no honest carrier exists; the UI hides the checkbox rather
   *      than offering one that lies. Today no materialized surface reaches
   *      here; declared so a future shape that cannot carry visibility can say
   *      so without another union change. */
  visibility: "native" | "pane" | "none";
  /** Whether the layer can host a label (annotation) pane:
   *    - "pane" — the registration edge declared a `role: "annotation"`
   *      PaneSpec (its features expose labelable `feature.properties`) and
   *      LayerSurface materializes that pane with the rest of the face, so
   *      the style panel's Label section is honest to render.
   *    - "none" — no labelable content (base tiles, canvas / color surfaces,
   *      shapes without properties): no pane, no row.
   *
   *  Declared, not probed in `detectCapabilities`: the probe lives at the
   *  declaration edge (`LayerManager.surfaceFor`), so the capability and
   *  the pane itself are one fact and can never disagree — and a
   *  re-registration whose tree gained or lost labelable content re-probes
   *  there, changing the declared specs, which rebuilds the surface through
   *  `matches` (the fill / stroke probe's path). */
  annotation: "pane" | "none";
  /** Whether the surface can be z-reordered by our own mechanism. Today every
   *  materialized surface can; the field is declared so a later carrier that
   *  cannot (a plugin that owns its own z) can say so without another shape
   *  change. */
  relocatable: boolean;
  /** Whether the surface exposes a geographic-bounds provider the UI can use
   *  to focus it. A static declaration, not a probe: `getBounds()` on a
   *  live layer may still throw or answer empty until the layer is attached,
   *  and a probe that runs before addLayer would have to swallow that. The
   *  UI reads this to disable focus for layers that never had a provider
   *  (MarkerCluster, third-party groups, canvas surfaces without a getBounds
   *  provider) instead of letting the user click and hit a
   *  silent no-op. `false` does not mean "the provider lies": it means
   *  "no honest carrier to ask". */
  bounds: boolean;
}

/** Options for registerLayer / createLayerInfo. */
interface RegisterLayerOpts {
  id: string;
  name?: string | null;
  layer?: L.Layer | null;
  group?: "base" | "overlay";
  /** New base layer insertion: "top" (default, tile basemaps) or "bottom"
   *  (solid-color basemap — lowest z, tiles cover it). */
  baseInsert?: "top" | "bottom";
  /** Persist this registration's slot into the stored order. Defaults to
   *  true. A runtime-created surface (the solid-color basemap) passes false:
   *  its insertion slot is a side effect of attach timing, not a user
   *  arrangement, so writing it would clobber an order the user already
   *  set. Its slot is recovered from storage by `replaySavedOrder` instead. */
  persistOrder?: boolean;
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
  /** Layer opacity in [0, 1]. Defaults to 1 (fully opaque). */
  opacity?: number;
  canvas?: HTMLCanvasElement | null;
  /** The fill a solid-color basemap paints into its own pane. The pane element
   *  is the face, so the value — not an element — is what travels here. */
  color?: string | null;
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
  /** Dynamic meta provider — pulled on demand by the attributes panel (same
   *  pull-on-demand contract as featureCountProvider). Same-key entries in
   *  the returned object override the static `meta` (dynamic wins, static is
   *  fallback). */
  metaProvider?: (() => Record<string, string | number>) | null;
}

/** A layer entry in the ordered registry (read-only view). */
interface LayerInfo {
  id: string;
  name: string;
  layer: L.Layer | null;
  /** Layer opacity in [0, 1]. Defaults to 1 (fully opaque). */
  opacity?: number;
  group: "base" | "overlay";
  paneName: string | null;
  /** The panes this layer paints into, in draw order. */
  paneSpecs: PaneSpec[];
  iconSvg: string | null;
  type: string | null;
  /** Canvas element registered via createCanvas (e.g. HeatmapControl).
   *  ExportControl renders these as standalone canvases with lifecycle hooks. */
  canvas?: HTMLCanvasElement | null;
  /** The fill a solid-color basemap paints into its own pane. */
  color?: string | null;
  isLabel?: boolean;
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
  /** Dynamic meta provider — pull on demand, never cached. */
  metaProvider?: (() => Record<string, string | number>) | null;
  /** Epoch ms of the layer's first registration. Set by the registry itself —
   *  never by the provider — so a re-registration keeps the original value. */
  registeredAt?: number;
}

/** Leaflet layer with a custom `isLabel` flag (foliplus adds it).
 *
 *  Write contract for a third-party layer's `options` — the exact write set
 *  is `pane` and `renderer`; nothing else:
 *    - Both are Leaflet's own, and the two a correct draw position actually
 *      needs (Leaflet reads `pane` only at attach time and ignores a group's
 *      for its children, so both must be written to survive a re-attach).
 */
interface LabelAwareLayer extends L.Layer {
  isLabel?: boolean;
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
 *  Replaces the stamp-keyed fallback-pane map and the per-layer `options.paneSet`
 *  dirty flag the layer manager used to keep — both are now surface-side
 *  bookkeeping (`materialized`, `contentDirty`). See core/layer/LayerSurface.ts
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
  /** The geometry type this surface's layer resolves to, cached per surface.
   *  Base and iconSvg layers short-circuit in the manager, so this is only
   *  consulted for ordinary data layers. `invalidate()` drops the cache; the
   *  next call re-probes. */
  geometryType: () => string | null;
  /** Drop the cached geometry type. Called by the manager whenever the
   *  layer's content can change (createLayers add/remove/clear, runtime
   *  layeradd) so the next read re-probes. */
  invalidate: () => void;
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
  /** See RegisterLayerOpts. */
  metaProvider?: (() => Record<string, string | number>) | null;
}

/** Options for `LayerAPI.createCanvas`. */
interface CreateCanvasOpts {
  id: string;
  name?: string;
  className?: string;
  iconSvg?: string;
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
  /** The canvas that receives draws. Built at `createCanvas` time but mounted
   *  into its own pane only when `register()` runs, so until then the element
   *  has no parent. `ctx`, `resize` and `setVisible` are all safe before that
   *  — they act on the element, which is never null. `resize` re-runs on mount
   *  and resets the backing store when the container size has changed, so a
   *  draw made before register is not a reliable carrier: the owner re-draws
   *  from its own state at register, which is why HeatmapControl re-renders on
   *  attach. Unlike the color surface, nothing here repaints the owner's pixels. */
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
  setVisible: (v: boolean) => void;
}

/** Options for creating a solid-color basemap surface. */
interface CreateColorOpts {
  id: string;
  name?: string;
  color: string;
  /** See {@link RegisterLayerOpts.persistOrder}. */
  persistOrder?: boolean;
}

/** Return type of the color-surface factory — the solid-color basemap's
 *  rendering face, owned by a dedicated pane so it participates in the
 *  layer z ladder like any other base-group member. */
interface CreateColorAPI {
  /** The canvas element that carries the fill (inside the color pane). Built
   *  at `createColor` time and mounted into its pane when `register()` runs;
   *  `element` is never null, and `setColor` is safe before either — it repaints
   *  into the element and the face is re-painted on mount, so an early
   *  `setColor` survives until the pane appears. */
  element: HTMLCanvasElement;
  setColor: (color: string) => void;
  setVisible: (v: boolean) => void;
  register: () => void;
  unregister: () => void;
  registered: () => boolean;
  bringToFront: () => void;
  destroy: () => void;
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
      getBounds?: (() => L.LatLngBounds | null) | null;
      source?: string | null;
      updatedAt?: string | number | null;
      meta?: Record<string, string | number> | null;
    }
  | {
      /** A solid-color basemap: no Leaflet layer and no canvas, just a flat
       *  fill written onto the pane the surface owns. Anything the CSS
       *  `background` shorthand accepts. */
      kind: "color";
      color: string;
    };

/** Options for `LayerFactory.createSurface`. */
interface CreateSurfaceOpts {
  id: string;
  name?: string;
  iconSvg?: string;
  content: SurfaceContentOpts;
  featureCountProvider?: (() => number) | null;
  styleProvider?: (() => Record<string, unknown>) | null;
  styleSetters?: Record<string, (value: unknown) => void> | null;
  styleDefaults?: (() => Record<string, unknown>) | null;
  metaProvider?: (() => Record<string, string | number>) | null;
  /** See {@link RegisterLayerOpts.persistOrder}. */
  persistOrder?: boolean;
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
      setVisible: (v: boolean) => void;
    }
  | {
      /** The canvas element that paints the fill, inside a dedicated
       *  pane. Full-size viewport canvas, same plumbing as createCanvas:
       *  the pane owns its z in the ladder, the canvas fills it. */
      element: HTMLCanvasElement;
      kind: "color";
      /** The fill currently written onto `element`. */
      color: string;
      setColor: (color: string) => void;
      /** Show or hide the color basemap. Visibility toggles the HIDDEN
       *  class on `element`; the pane itself stays in the DOM so its z
       *  in the ladder is preserved across toggles. */
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
    }
  | {
      content: Extract<SurfaceContentHandle, { kind: "color" }>;
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
  /** Delete a layer and drop every persisted value the user set for it —the
   *  single path that erases stored state. Unregister alone never does,
   *  because a component that unregisters itself may simply be temporarily
   *  empty. */
  deleteLayer: (id: string) => boolean;
  /** Drop one id from the stored order so its next registration lands at the
   *  top of the overlay stack instead of returning to the slot the user
   *  arranged. The counterpart to deleteLayer's saved-order prune, but without
   *  the `removedIds` recording — the layer stays registerable. Called by
   *  component clear paths (Heatmap, Measure) after they unregister, so a
   *  clear-and-redraw cycle resets the position rather than preserving it. */
  forgetSavedOrder?: (id: string) => boolean;
  /** Bring a registered overlay layer to the front. */
  bringLayerToFront: (id: string) => void;
  /**
   * Programmatically set a layer's visibility — the same transition the panel
   * checkbox performs: the Leaflet layer is added to or removed from the map
   * (`visibility: "native"`), the canvas/face `HIDDEN` class is toggled
   * (`visibility: "pane"`), the panel row's checkbox and toggle-all control
   * follow, and the persisted hidden set is updated so the choice survives a
   * reload.
   *
   * This closes the write side of the visibility contract. The intent
   * (persisted hidden set + `intentProvenance`) is the only stored source;
   * `LayerInfo` itself carries no visibility — so a host page that wanted to
   * hide layers by id never had to synthesize a DOM event against a row it
   * does not own.
   *
   * @returns true if the layer was found and its visibility was set.
   */
  setVisible: (id: string, visible: boolean) => boolean;
  /** The user's stored visibility choice (persisted intent) for a layer id,
   *  or the author's declared default when the user never touched it.
   *  This is the panel checkbox's fact, not the map's membership — a layer
   *  marked visible here may still be off the map because policy (focus,
   *  zoom range) is suppressing it. Callers that need "is it drawn right
   *  now" read the map directly; callers that need "did the user hide it"
   *  read this. Only LayerManager implements this; the lightweight stub
   *  has no intent storage, so a consumer sees `undefined` and falls back
   *  to `true`.
   */
  intentVisible?: (id: string) => boolean;
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

/** Everything `zFor` can be told about the pane it prices. */
interface ZArgs {
  /** The layer's position in the ordered registry: index 0 is the topmost. */
  index?: number;
  /** How many layers the registry holds — the step multiplier. */
  count?: number;
  /** Base-group layers (tile basemaps and the solid-color basemap) share the
   *  lower `TILE_BASE` ladder; overlay-group layers use `BASE`. Row order
   *  within a group = visual stack order, since both share one `STEP`. */
  group?: "base" | "overlay";
  /** The pane's role in its layer's draw stack. Only `annotation` prices a
   *  relation of its own (one step above its layer); the rest use `order`. */
  role?: PaneRole;
  /** The pane's draw offset within its layer (`PaneSpec.order`). */
  order?: number;
  /** An absolute base z instead of a slot — the focus lift. */
  base?: number;
}

/** A node in the layer tree a probe walk may reach. */
type StyleProbeNode = {
  setStyle?: (style: Record<string, unknown>) => void;
  eachLayer?: (fn: (layer: L.Layer) => void) => void;
};

export type {
  CreateCanvasAPI,
  CreateCanvasOpts,
  CreateColorAPI,
  CreateColorOpts,
  CreateLayersAPI,
  CreateLayersOpts,
  CreateLayersPane,
  CreateSurfaceOpts,
  LabelAwareLayer,
  LayerAPI,
  LayerCapabilities,
  LayerInfo,
  LayerSurface,
  PaneHandle,
  PaneRole,
  PaneSpec,
  RegisterLayerOpts,
  StyleProbeNode,
  SurfaceContentHandle,
  SurfaceContentOpts,
  SurfaceHandle,
  ZArgs,
};
