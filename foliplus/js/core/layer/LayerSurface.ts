// core/layer/LayerSurface — the rendering face of one registered layer.
//
// Before this module the answer to "where does this layer draw, and at which z"
// was assembled in three places inside LayerManager's ordering pass: a
// `fallbackPaneMap` keyed by `L.stamp`, an `options.paneSet` flag standing in
// for "already moved", and a queue of DOM moves replayed after the pass. The
// surface owns those concerns instead: it resolves the pane handles once, pins
// the layer's content to them, and hands the ordering pass a z target and
// nothing else.
//
// Two invariants the rest of the tree leans on (design §3.2):
//
//   I1  `materialize()` runs before `map.addLayer`, so `options.pane` is already
//       right at the one moment Leaflet reads it — `Layer.options.pane` is
//       ignored after `addLayer`, so a pane decided later can only be reached by
//       moving DOM.
//   I2  the pane *set* is fixed once materialized. Content may still arrive — a
//       third party can mutate a registered group's tree — and the surface
//       re-pins it on the next reconcile (see `contentDirty`), but no consumer
//       has to handle a "not yet sorted" window.
//
// No CONF / translator dependency: core/layer, not a component dir.
import type { PaneManager } from "./PaneManager.js";
import { FALLBACK_PANE_PREFIX } from "./const.js";
import type {
  LayerCapabilities,
  LayerSurface as LayerSurfaceContract,
  PaneHandle,
  PaneRole,
  PaneSpec,
} from "./type.js";

/** Options a surface is resolved from — the register-time declaration only. */
interface SurfaceOpts {
  id: string;
  layer: L.Layer | null;
  /** The pane the caller declared for this layer, if any. */
  paneName?: string | null;
  /** The panes this layer paints into, in draw order. */
  paneSpecs?: readonly PaneSpec[];
  /** True for a `createCanvas` surface: its pane carries a canvas, not SVG. */
  canvas?: boolean;
}

/** A layer with the mutable option surface the pin writes to. Containers carry
 *  `eachLayer`, and Leaflet ignores a group's pane for its children — which is
 *  why the pin hands such a node's whole tree to `migrateLayers` instead of
 *  writing one pane name onto the group. */
interface PinnableNode extends L.Layer {
  options: L.LayerOptions & {
    renderer?: L.Renderer;
    pane?: string;
    paneSet?: boolean;
  };
  eachLayer?: (fn: (layer: L.Layer) => void) => void;
}

/** Whether a node enumerates children. `eachLayer`, not `isGroupLike`: the pin
 *  walk must treat "container" exactly as the move it delegates to does, and a
 *  non-Leaflet wrapper carrying only `_layers` is a leaf here. */
const isContainer = (node: PinnableNode): boolean =>
  typeof node.eachLayer === "function";

/** The declaration inputs that decide a surface's pane set. Compared by
 *  `matches` when the same id is registered again. */
interface SurfaceDeclaration {
  layer: L.Layer | null;
  paneName: string | null;
  canvas: boolean;
}

class LayerSurface implements LayerSurfaceContract {
  readonly id: string;
  readonly layer: L.Layer | null;
  readonly panes: PaneHandle[] = [];
  materialized = false;
  /** What this surface can actually be asked to do — resolved once in the
   *  constructor (the pane set is fixed by then, I2) and read by the UI, the
   *  export renderer and third parties. Never persisted: it is derived from
   *  what the surface owns, so letting a caller supply it would let them claim
   *  support they do not have and break the honest-degradation contract. */
  readonly capabilities: LayerCapabilities;
  /** Whether the layer's tree has changed since the last reconcile. Set by the
   *  manager on `layeradd` (synchronously — the probe path calls
   *  `enforceOrder` directly, so a debounce-only trigger would miss it) and
   *  cleared by `materialize()`. */
  contentDirty = false;

  private readonly host: PaneManager;
  private readonly specs: readonly PaneSpec[];
  private readonly spec: SurfaceDeclaration;
  /** The pane this surface synthesized because the layer declared none. Its
   *  content is pinned here; a declared pane's content is routed by whoever
   *  declared it (createLayers), so there is nothing for us to pin. */
  private readonly pinTarget: string | null;

  constructor(host: PaneManager, opts: SurfaceOpts) {
    this.host = host;
    this.id = opts.id;
    this.layer = opts.layer;
    this.specs = opts.paneSpecs ?? [];

    const declared = opts.paneName ?? null;
    const layer = opts.layer;
    this.spec = { layer, paneName: declared, canvas: opts.canvas === true };
    // Capabilities are resolved here, before any early return below, so every
    // branch — declared, synthesized, native — reports the same way. A GridLayer
    // or ImageOverlay gets "native" regardless of whether a pane is allocated.
    this.capabilities = detectCapabilities(opts);

    if (declared) {
      const base = this.specs[0];
      this.addPane(declared, !opts.canvas, base?.role, base?.order);
      for (const spec of this.specs.slice(1)) {
        if (spec.name !== declared) {
          this.addPane(spec.name, false, spec.role, spec.order);
        }
      }
      this.pinTarget = null;
      return;
    }

    // No declared pane: a GridLayer paints in the shared tilePane and carries
    // its z on itself, so it gets no pane of ours. Everything else either
    // declares its panes in the tree or is pinned into a synthesized one.
    if (!layer || layer instanceof L.GridLayer) {
      this.pinTarget = null;
      return;
    }

    const childPanes = host.discoverChildPanes(layer);
    for (const name of childPanes) {
      // A pane registered through `createLayers({ panes })` already has a
      // renderer from `ensureVector`; only a foreign pane needs one built.
      const spec = host.childPaneSpecs.get(name);
      this.addPane(name, spec === undefined, spec?.role, spec?.order);
    }
    if (childPanes.length) {
      this.pinTarget = null;
      return;
    }

    const name = `${FALLBACK_PANE_PREFIX}${L.stamp(layer)}`;
    this.addPane(name, true);
    this.pinTarget = name;
  }

  /** Resolve the pane handles and pin the layer's content to them. Re-entrant:
   *  the first call resolves and pins; later calls re-pin only when the layer's
   *  tree has changed (`contentDirty`). Steady state — every pass after the
   *  content has settled — is a no-op, so the ordering pass writes z only. */
  materialize(): void {
    if (this.materialized && !this.contentDirty) return;
    this.reconcile();
    this.contentDirty = false;
    this.materialized = true;
  }

  /** Mark the layer's tree as having changed since the last reconcile. */
  markContentDirty(): void {
    this.contentDirty = true;
  }

  /** Write this surface's z onto its panes.
   *  @param z - The layer's position-based base z.
   *  @returns false when the layer paints through no pane of its own (a
   *    `GridLayer`, which carries its z on the layer itself) — the caller then
   *    falls back to the layer's own native z knob. */
  setZ(z: number): boolean {
    if (!this.panes.length) return false;
    for (const pane of this.panes) {
      this.host.ensurePane(pane.name, false).pane.style.zIndex = String(z + pane.order);
    }
    return true;
  }

  /** Release the panes this surface synthesized. The layer is off the map by
   *  the time this runs (LayerManager.unregisterLayer), so nothing renders into
   *  them; a *declared* pane survives, which is what lets the same id be
   *  registered again without rebuilding its panes. */
  destroy(): void {
    if (this.pinTarget) this.host.removePane(this.pinTarget);
  }

  /** The pane names this surface paints into, base first. */
  get paneNames(): string[] {
    return this.panes.map(pane => pane.name);
  }

  /** The pane this surface synthesized because the layer declared none, or null
   *  when the layer paints into panes it declared. Ownership, not a shared-pane
   *  blocklist: the name is derived from the layer's stamp, so the pane holds
   *  that layer alone. */
  get synthesizedPaneName(): string | null {
    return this.pinTarget;
  }

  /** Whether a fresh registration describes the face this surface already has:
   *  the same live layer object and the same declared panes. Re-registration is
   *  how a caller says "this layer's content changed" — when the declaration did
   *  not change too, rebuilding would re-walk an already-pinned tree for
   *  nothing. */
  matches(opts: SurfaceOpts): boolean {
    const specs = opts.paneSpecs ?? [];
    // `role` and `order` are part of the declaration, not decoration: a spec
    // whose role changes describes a different face, and the surface has to be
    // rebuilt. They are derived from the index today (`LayerFactory` writes
    // them from position), which makes the two comparisons look redundant —
    // they stop being so the moment a spec carries a role its position does
    // not imply, which is where R9's `z = f(layerIndex, role)` and the
    // per-role renderer defaults are headed.
    const samePanes =
      this.specs.length === specs.length &&
      this.specs.every(
        (spec, i) =>
          spec.role === specs[i].role &&
          spec.order === specs[i].order &&
          spec.name === specs[i].name,
      );
    return (
      this.spec.layer === opts.layer &&
      this.spec.paneName === (opts.paneName ?? null) &&
      this.spec.canvas === Boolean(opts.canvas) &&
      samePanes
    );
  }

  // ── internals ──────────────────────────────────────────────────

  /** Ensure one pane and record its handle. `needRenderer` is true only where
   *  the surface itself places Path content (the base pane of a declared
   *  surface, and the synthesized fallback) — a sub-pane's renderer is built by
   *  the content that routes into it (`createLayers`' `ensureVector`), and
   *  building it here would put a full-size empty `<svg>` in every label pane.
   *
   *  Every pane is created `pointer-events: none` by CSS, and nothing here
   *  re-opens it: whether a pane's content takes a hit is the content's own
   *  call (`AnnotationCanvas` writes `none` on itself, a data canvas is
   *  re-enabled by the rule in `LayerControl/focus.css`). */
  private addPane(
    name: string,
    needRenderer: boolean,
    role: PaneRole = "base",
    order = 0,
  ): void {
    const { pane, renderer } = this.host.ensurePane(name, needRenderer);
    this.panes.push({
      role,
      order,
      name,
      element: pane,
      renderer,
    });
  }

  /** Pin the layer's content into its panes: its options always (so a not-yet-
   *  added leaf lands correctly — that is I1), and its already-rendered DOM when
   *  Leaflet has placed it somewhere else (the content a caller added to the map
   *  before we ever saw the layer, or since the last reconcile). */
  private reconcile(): void {
    if (!this.layer) return;
    const base = this.panes[0];
    if (!base) return;
    if (this.pinTarget) {
      // A synthesized pane owns the whole tree — pin everything into it.
      this.host.migrateLayers([
        { layer: this.layer, paneName: this.pinTarget, renderer: base.renderer },
      ]);
      return;
    }
    if (!isContainer(this.layer as PinnableNode)) {
      // A declared pane on a flat layer is still ours to place: the layer
      // itself carries the pane, and its element needs moving when it is
      // already attached.
      this.host.migrateLayers([
        { layer: this.layer, paneName: base.name, renderer: base.renderer },
      ]);
      return;
    }
    // A declared pane on a container is for the record: Leaflet ignores a
    // group's pane for its children (they are routed by whoever declared them,
    // e.g. createLayers), so the surface must not recurse — that would collapse
    // every leaf onto the base pane.
    const node = this.layer as PinnableNode;
    node.options.pane = base.name;
    node.options.paneSet = true;
  }
}

/** The MarkerCluster plugin's group — a shape this tree does not own.
 *
 *  Two tells distinguish it from every other LayerGroup: the plugin attaches
 *  `_topClusterLevel` (its own tree root) and, if the plugin is loaded, is
 *  reachable via `L.MarkerClusterGroup`. `eachLayer` on the group reaches the
 *  individual markers, but the cluster icons themselves live in the shared
 *  `markerPane` and never enter `eachLayer`, so there is no honest carrier for
 *  a per-layer opacity on a MarkerCluster group — the pane write would fade the
 *  individual markers but not the clusters (half the layer).
 *
 *  `L.MarkerClusterGroup` is not in the ambient typings; the plugin is optional
 *  and may not be loaded at all, so the reference is guarded with a runtime
 *  presence check rather than a hard instanceof. */
const isMarkerCluster = (layer: L.Layer): boolean => {
  if (typeof L.MarkerClusterGroup !== "undefined" && layer instanceof L.MarkerClusterGroup)
    return true;
  // Fallback: the plugin's private `_topClusterLevel` field. If the plugin is
  // renamed or the instanceof fails (plugin loaded without `L.MarkerClusterGroup`),
  // this still catches it. The failure mode — duck typing alone — is documented
  // in the PR body per §25.3-3.
  return !!(layer as L.Layer & { _topClusterLevel?: unknown })._topClusterLevel;
};

/** Whether the layer paints through a setter of its own (not a pane of ours).
 *
 *  `GridLayer` and `ImageOverlay` both fall into this bucket: `GridLayer` (and
 *  its `TileLayer` subclass) carries `options.opacity` + `minZoom`/`maxZoom`
 *  and reads them at `addLayer`; `ImageOverlay`'s `<img>` stays in the shared
 *  `overlayPane` — a pane write would fade every layer in that shared pane —
 *  but its own `setOpacity` is immediate and correct (R1 §25.2). */
const usesNativeSetter = (layer: L.Layer): boolean =>
  (typeof L.GridLayer !== "undefined" && layer instanceof L.GridLayer) ||
  (typeof L.ImageOverlay !== "undefined" && layer instanceof L.ImageOverlay);

/** Resolve a surface's capabilities from what it actually owns (R1 probes).
 *
 *  Every situation where content could land outside our panes is either given
 *  a carrier or honestly downgraded to "none" here — that is the precondition
 *  for deleting the per-feature walk: no case is left with a write that is
 *  neither owned nor declared impossible.
 *
 *    - MarkerCluster → "none" for both. The cluster icons stay in the shared
 *      `markerPane`, `eachLayer` cannot reach them (§25.3-3).
 *    - GridLayer / ImageOverlay → "native". R1 §25.2 measured: `ImageOverlay`
 *      `setOpacity` immediate-and-correct; `GridLayer` options immediate at
 *      addLayer (zoomRange honest only for GridLayer, not ImageOverlay).
 *    - Everything else registered with a content surface → "pane" (declared
 *      or synthesized). Includes createCanvas whose canvas sits in its own
 *      dedicated pane.
 *
 *  The only "none" left is a layer that has no content we can route: the
 *  constructor synthesizes no pane and none is declared — e.g. a third-party
 *  plugin that builds its own canvas in Leaflet's `overlayPane`. Its content
 *  is not ours to write. */
const detectCapabilities = (opts: SurfaceOpts): LayerCapabilities => {
  const layer = opts.layer;

  if (layer && isMarkerCluster(layer)) {
    return { opacity: "none", zoomRange: "none", relocatable: false };
  }

  if (layer && usesNativeSetter(layer)) {
    // ImageOverlay's zoomRange is declared in options but not runtime-effective
    // once attached (R1 §25.3-5): only GridLayer honours min/maxZoom live.
    const zoomRange: LayerCapabilities["zoomRange"] =
      layer instanceof L.GridLayer ? "native" : "none";
    return { opacity: "native", zoomRange, relocatable: true };
  }

  // The surface paints into panes we own — declared, sub, or synthesized — so
  // one style write per pane covers every child. `opts.canvas` covers the
  // createCanvas shape, whose canvas element sits inside its own dedicated
  // pane and is addressable through the same CSS write (§4.2 first version:
  // canvas bakes alpha later, R11).
  const hasContentPanes =
    Boolean(opts.paneName) ||
    (opts.paneSpecs && opts.paneSpecs.length > 0) ||
    opts.canvas;

  if (hasContentPanes) {
    return { opacity: "pane", zoomRange: "pane", relocatable: true };
  }

  // A non-grid, non-native layer with no declared pane and no canvas: the
  // constructor would synthesize a fallback (any non-grid `layer` gets one).
  // That pane is addressable on its own.
  if (layer) {
    return { opacity: "pane", zoomRange: "pane", relocatable: true };
  }

  // No layer at all and no canvas — nothing to write.
  return { opacity: "none", zoomRange: "none", relocatable: false };
};

export { LayerSurface };
