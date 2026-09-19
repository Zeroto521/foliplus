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
  LayerSurface as LayerSurfaceContract,
  PaneHandle,
  PaneRole,
} from "./type.js";

/** Options a surface is resolved from — the register-time declaration only. */
interface SurfaceOpts {
  id: string;
  layer: L.Layer | null;
  /** The pane the caller declared for this layer, if any. */
  paneName?: string | null;
  /** Sub-panes, ordered by z ascending (see RegisterLayerOpts.subPanes). */
  subPanes?: string[];
  /** True for a `createCanvas` surface: its pane carries a canvas, not SVG. */
  canvas?: boolean;
}

/** A layer with the mutable option surface the pin writes to. Containers carry
 *  `eachLayer` and never get `options.pane` of their own — Leaflet ignores a
 *  group's pane for its children, which is why the pin walks the tree. */
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

class LayerSurface implements LayerSurfaceContract {
  readonly id: string;
  readonly layer: L.Layer | null;
  readonly panes: PaneHandle[] = [];
  materialized = false;
  /** Whether the layer's tree has changed since the last reconcile. Set by the
   *  manager on `layeradd` (synchronously — the probe path calls
   *  `enforceOrder` directly, so a debounce-only trigger would miss it) and
   *  cleared by `materialize()`. */
  contentDirty = false;

  private readonly map: L.Map;
  private readonly host: PaneManager;
  private readonly subPanes: string[];
  /** The declaration this surface was built from — `matches` compares against it
   *  when the same id is registered again. */
  private readonly spec: SurfaceOpts;
  /** The pane this surface synthesized because the layer declared none. Its
   *  content is pinned here; a declared pane's content is routed by whoever
   *  declared it (createLayers), so there is nothing for us to pin. */
  private readonly pinTarget: string | null;

  constructor(map: L.Map, host: PaneManager, opts: SurfaceOpts) {
    this.map = map;
    this.host = host;
    this.id = opts.id;
    this.layer = opts.layer;
    this.subPanes = opts.subPanes ?? [];
    this.spec = { ...opts, subPanes: this.subPanes };

    const declared = opts.paneName ?? null;
    const layer = opts.layer;

    if (declared) {
      this.addPane(declared, !opts.canvas, "base");
      for (const name of this.subPanes) {
        if (name !== declared) this.addPane(name, false, "sub");
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
      this.addPane(name, !host.childPanes.has(name), "base");
    }
    if (childPanes.length) {
      this.pinTarget = null;
      return;
    }

    const name = `${FALLBACK_PANE_PREFIX}${L.stamp(layer)}`;
    this.addPane(name, true, "base");
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
      this.host.ensurePane(pane.name, false).pane.style.zIndex = String(z);
    }
    // Sub-panes ride one CHILD_PANE_STEP apart, in declaration order. The base
    // pane is the k=0 entry of that list, so this rewrites the same value it
    // just got rather than a different one.
    if (this.subPanes.length && this.layer) {
      this.host.bumpPanes(this.layer, z, this.subPanes);
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
    const samePanes =
      this.subPanes.length === (opts.subPanes?.length ?? 0) &&
      this.subPanes.every((name, i) => name === opts.subPanes?.[i]);
    return (
      this.spec.layer === opts.layer &&
      (this.spec.paneName ?? null) === (opts.paneName ?? null) &&
      Boolean(this.spec.canvas) === Boolean(opts.canvas) &&
      samePanes
    );
  }

  // ── internals ──────────────────────────────────────────────────

  /** Ensure one pane and record its handle. `needRenderer` is true only where
   *  the surface itself places Path content (the base pane of a declared
   *  surface, and the synthesized fallback) — a sub-pane's renderer is built by
   *  the content that routes into it (`createLayers`' `ensureVector`), and
   *  building it here would put a full-size empty `<svg>` in every label pane. */
  private addPane(name: string, needRenderer: boolean, role: PaneRole = "base"): void {
    const { pane, renderer } = this.host.ensurePane(name, needRenderer);
    this.panes.push({ role, name, element: pane, renderer });
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

export { LayerSurface };
