// core/layer/LayerSurface — the rendering face of one registered layer.
//
// Before this module the answer to "where does this layer draw, and at which z"
// was assembled in three places inside LayerController's ordering pass: a
// `fallbackPaneMap` keyed by `L.stamp`, a per-layer `options.paneSet` dirty
// flag, and a queue of DOM moves replayed after the pass. The surface owns
// those concerns instead: it resolves the pane handles once, pins
// the layer's content to them, and hands the ordering pass a z target and
// nothing else.
//
// Two invariants the rest of the tree leans on:
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
// No CONFIG / translator dependency: core/layer, not a component dir.
import { createLogger } from "#common/log.js";
import type { PaneManager } from "./PaneManager.js";
import { hasFillLeaf, hasSetStyleLeaf } from "./capability.js";
import {
  CAP_TIER,
  FALLBACK_PANE_PREFIX,
  KIND,
  PANE_NAME_PATTERN,
  PANE_ROLE,
} from "./const.js";
import type {
  LayerCapabilities,
  LayerKind,
  LayerSurface as LayerSurfaceContract,
  PaneHandle,
  PaneRole,
  PaneSpec,
  PinnableNode,
} from "./type.js";
import { CLUSTER_CAPABILITIES, deriveLayerKind, getGeometryType } from "./util.js";
import { zFor } from "./z.js";

const log = createLogger("LayerSurface");

/** Normalize a caller-declared pane name to the value this surface will
 *  actually build with. A name outside `PANE_NAME_PATTERN` is not a pane we
 *  can create — it lands in the DOM as a Leaflet pane id and class — so it
 *  counts as "not declared" and the constructor's fallback synthesis takes
 *  over. The constructor and `matches` both go through here, so a
 *  re-registration is always compared against the value the surface was
 *  really built with, not the raw string that was handed in. */
const declaredPaneName = (raw: string | null | undefined): string | null =>
  raw != null && PANE_NAME_PATTERN.test(raw) ? raw : null;

/** Whether a layer carries its own `getBounds()`. Presence of the method, not
 *  its answer: the answer depends on what the layer currently holds, while
 *  `capabilities.bounds` is a static declaration made at register time. */
const hasBoundsProvider = (layer: L.Layer | null | undefined): boolean =>
  layer != null &&
  typeof (layer as L.Layer & { getBounds?: () => L.LatLngBounds }).getBounds ===
    "function";

/** Resolve a face's kind: the declaration wins, otherwise probe the layer
 *  family — the same precedence as the registry's `kindFor`, so the two
 *  resolve points cannot disagree when both are handed the same facts.
 *
 *  The registry is the authority for a registered layer: it always hands its
 *  own `LayerInfo.kind` down, and the probe below then only ever serves a
 *  direct `LayerSurface` caller that declared nothing. Reading the declaration
 *  is what keeps an explicitly typed layer honest — a caller that declares
 *  `kind: "custom"` or `kind: "vector"` on a layer whose tree looks like
 *  something else used to be re-derived away from its own declaration here. */
const kindOf = (opts: SurfaceFaceOpts): LayerKind => opts.kind ?? deriveLayerKind(opts);

/** Options a surface is resolved from — the register-time declaration only. */
interface SurfaceFaceOpts {
  id: string;
  layer: L.Layer | null;
  /** Declared kind — the registry's authority (`LayerInfoRegistry.kindFor` is
   * the single place a registered layer's kind is derived), which
   * `LayerController.surfaceFor` forwards down here. When a direct caller
   * declares nothing, `kindOf` probes the layer family. */
  kind?: LayerKind;
  /** Third-party carrier payload (`kind: "custom"`). The registry forwards
   * `carrier.custom`; without it a caller that only supplies a payload would
   * be probed into whatever its `layer` happens to look like. */
  custom?: unknown;
  /** The pane the caller declared for this layer, if any. */
  paneName?: string | null;
  /** The panes this layer paints into, in draw order. */
  paneSpecs?: readonly PaneSpec[];
  /** True for a `createCanvas` surface: its pane carries a canvas, not SVG. */
  canvas?: boolean;
  /** The fill of a solid-color basemap. Its presence decides the surface's
   *  shape, not its value — see `SurfaceDeclaration.color`. */
  color?: string | null;
  /** Bounds provider the caller declared (canvas surfaces). Drives the
   *  `capabilities.bounds` answer — a canvas without a provider has no
   *  honest carrier for focus, so the UI disables the action rather than
   *  letting a click land as a silent no-op. */
  getBounds?: (() => L.LatLngBounds | null) | null;
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
  kind: LayerKind;
  custom: boolean;
  paneName: string | null;
  canvas: boolean;
  /** Whether the declaration names a color fill. Presence, not value: a color
   *  that changes is a repaint, not a rebuild, so the value stays out of the
   *  declaration — but a layer that stops being a color surface does describe
   *  a different face and must be rebuilt. */
  color: boolean;
  /** Bounds provider the caller declared. Part of the declaration because
   *  `capabilities.bounds` is derived from it — a surface reused across a
   *  re-registration that gained or lost a provider would otherwise keep
   *  answering with the old provider's absence.
   *
   *  Compared by presence in `matches`, not by reference: a caller hands a
   *  fresh arrow on every register, and reference equality would read "the
   *  declaration changed" on every pass, rebuilding a face that does not need
   *  rebuilding. The reference is kept only so the value can be reported back
   *  as-is; nothing reads it through. */
  getBounds: (() => L.LatLngBounds | null) | null;
  /** Whether the layer's tree has an areal `setStyle` leaf (vector fill
   *  axis). Same probe-and-cache contract as `stroke`. */
  fill: "native" | "none";
  /** Whether the layer's tree has a `setStyle` leaf (vector stroke axis).
   *  Probe-derived, cached per surface. Part of the declaration so a
   *  re-registration that added or lost a stroke carrier triggers a
   *  rebuild — otherwise the surface would keep answering with the
   *  previous tree's probe result. */
  stroke: "native" | "none";
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
  private readonly paneSpecs: readonly PaneSpec[];
  private readonly surfaceDecl: SurfaceDeclaration;
  /** The pane this surface synthesized because the layer declared none. Its
   *  content is pinned here; a declared pane's content is routed by whoever
   *  declared it (createLayers), so there is nothing for us to pin. */
  private readonly pinTarget: string | null;

  constructor(host: PaneManager, opts: SurfaceFaceOpts) {
    this.host = host;
    this.id = opts.id;
    this.layer = opts.layer;
    this.paneSpecs = opts.paneSpecs ?? [];

    // The declared paneName is a third-party input that reaches the DOM as a
    // Leaflet pane id / class. If it fails `PANE_NAME_PATTERN`, treat it as
    // not declared — the fallback synthesis below then gives the layer a
    // stamped pane that is provably safe (FALLBACK_PANE_PREFIX + a number).
    const declaredRaw = opts.paneName ?? null;
    const declared = declaredPaneName(declaredRaw);
    if (declaredRaw != null && declared === null) {
      log.warn(
        `LayerSurface rejected paneName for injection safety: ${declaredRaw}; ` +
          `synthesising a fallback pane instead`,
      );
    }
    const layer = opts.layer;
    this.surfaceDecl = {
      layer,
      kind: kindOf(opts),
      custom: opts.custom !== undefined,
      paneName: declared,
      canvas: opts.canvas === true,
      color: opts.color != null,
      getBounds: opts.getBounds ?? null,
      fill: probeVectorCarrier(layer, "fill"),
      stroke: probeVectorCarrier(layer, "stroke"),
    };
    // Capabilities are resolved here, before any early return below, so every
    // branch — declared, synthesized, native — reports the same way. A GridLayer
    // or ImageOverlay gets "native" regardless of whether a pane is allocated.
    this.capabilities = detectCapabilities(opts);

    if (declared) {
      // The declared pane's own spec — matched BY NAME, not position: a
      // caller may hand a spec list whose index 0 is something else (an
      // appended label pane, for one), and a position-based read would
      // stamp that spec's role onto the base pane while never booking the
      // pane the extra spec names.
      const base = this.paneSpecs.find(spec => spec.name === declared);
      this.addPane(declared, !opts.canvas, base?.role, base?.order);
      for (const spec of this.paneSpecs) {
        if (spec.name !== declared) {
          this.addPane(spec.name, false, spec.role, spec.order);
        }
      }
      this.pinTarget = null;
      return;
    }

    // No declared pane: every layer gets a synthesized one so each carries
    // its own z in the ordering ladder (row order = z order across
    // kinds — a colour layer must be able to interleave with two tile layers).
    // GridLayer/TileLayer used to short-circuit here and paint in the shared
    // tilePane, which confined their z to that one shared stack; first-class
    // basemaps retire that.
    if (!layer) {
      this.pinTarget = null;
      this.addMissingSpecs();
      return;
    }

    // Reverse edge, and it is deliberate: discovery lives on the map-level
    // host, not here, because its cache cannot be invalidated from a surface.
    // `discoverChildPanes` memoises by `L.stamp(layer)` in `host.discoveryCache`,
    // and the invalidators are `pinTree` / `invalidateDiscoveryCache` — both called by
    // `LayerFactory` and `pinLateContent` for *any* node they happen to pin,
    // including descendants of this layer that this surface never sees. A
    // per-surface cache would have no hook for "someone repinned one of my
    // children", so it would serve stale pane names after a subtree re-pin.
    // The map is the only scope both writers and readers agree on.
    const childPanes = host.discoverChildPanes(layer);
    for (const name of childPanes) {
      // A pane registered through `createLayers({ panes })` already has a
      // renderer from `ensureVector`; only a foreign pane needs one built.
      const spec = host.childPaneSpecs.get(name);
      this.addPane(name, spec === undefined, spec?.role, spec?.order);
    }
    if (childPanes.length) {
      this.pinTarget = null;
      this.addMissingSpecs();
      return;
    }

    // L.stamp returns an incrementing integer; FALLBACK_PANE_PREFIX + digits
    // is always inside PANE_NAME_PATTERN, so no injection validation is needed
    // here. The third-party-facing gate is `registerPaneSpecs` / the declared
    // `paneName` check above — this is the internal fallback for a layer that
    // neither declared a pane nor was routed through `createLayers({ panes })`.
    const name = `${FALLBACK_PANE_PREFIX}${L.stamp(layer)}`;
    this.addPane(name, true);
    this.pinTarget = name;
    this.addMissingSpecs();
  }

  /** Materialize every declared spec the constructor's branch did not already
   *  add. The declared-pane route books its whole spec list; the other routes
   *  only walk panes they discovered in the live tree or synthesized — so a
   *  spec with no DOM pane to discover (the registration edge's
   *  `role: "annotation"` label pane) would otherwise be declared in
   *  `capabilities` and never exist. Fills the gap in place: handles already
   *  booked are skipped, so the base pane stays `panes[0]` and `reconcile`
   *  still pins content into it. */
  private addMissingSpecs(): void {
    for (const spec of this.paneSpecs) {
      if (!this.panes.some(pane => pane.name === spec.name)) {
        this.addPane(spec.name, false, spec.role, spec.order);
      }
    }
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

  /** The position-based base z the ordering pass last wrote for this surface. */
  private baseZ?: number;
  /** The absolute base z an override lifted every pane to. */
  private overrideZ?: number;
  /** The inline z each pane carried when an override was applied — what
   *  `restoreZ` returns to when the ordering pass has not written yet. */
  private zBefore?: Array<[HTMLElement, string]>;

  /** Write this surface's z onto its panes.
   *  @param z - The layer's position-based base z.
   *  @returns false when the layer paints through no pane of its own (a
   *    `GridLayer`, which carries its z on the layer itself) — the caller then
   *    falls back to the layer's own native z knob. */
  setZ(z: number): boolean {
    if (!this.panes.length) return false;
    this.baseZ = z;
    this.writeZ();
    return true;
  }

  /** Lift every pane to an absolute base z, keeping each pane's draw offset so
   *  the layer's internal order survives the lift. Focus uses this instead of
   *  a hand-derived ladder; `restoreZ` puts the stack back.
   *  @param z - The absolute base z to lift to, e.g. `focusLayerZ()`.
   *  @returns false when the surface paints through no pane of its own, or is
   *    already lifted — the caller lifts the element itself in that case. */
  setZOverride(z: number): boolean {
    if (!this.panes.length || this.overrideZ !== undefined) return false;
    this.zBefore = this.panes.map(pane => {
      const el = this.host.ensurePane(pane.name, false).pane;
      return [el, el.style.zIndex];
    });
    this.overrideZ = z;
    this.writeZ();
    return true;
  }

  /** Undo a `setZOverride`: rewrite the ordering pass's z, or the inline z the
   *  panes carried before the lift when the ordering pass has not written yet.
   *  @returns false when nothing was overridden. */
  restoreZ(): boolean {
    if (this.overrideZ === undefined) return false;
    this.overrideZ = undefined;
    if (this.baseZ === undefined) {
      for (const [el, z] of this.zBefore ?? []) el.style.zIndex = z;
    }
    this.zBefore = undefined;
    this.writeZ();
    return true;
  }

  /** Write the z of every pane: the override base while a lift is active,
   *  otherwise the ordering pass's. Writes nothing before either has been. */
  private writeZ(): void {
    const base = this.overrideZ ?? this.baseZ;
    if (base === undefined) return;
    for (const pane of this.panes) {
      this.host.ensurePane(pane.name, false).pane.style.zIndex = String(
        zFor({ base, role: pane.role, order: pane.order }),
      );
    }
  }

  /** The cached geometry type this surface's layer resolves to. Base and
   *  iconSvg layers short-circuit in the manager — this only handles the
   *  ordinary data-layer case. A null result is also cached: an empty or
   *  mixed-geometry container has a stable answer until its content changes,
   *  which is what `invalidate()` is for. */
  private cachedGeometryType: string | null = null;
  private geometryTypeCached = false;

  geometryType(): string | null {
    if (this.geometryTypeCached) return this.cachedGeometryType;
    const layer = this.layer;
    this.cachedGeometryType = layer ? getGeometryType(layer) : null;
    this.geometryTypeCached = true;
    return this.cachedGeometryType;
  }

  invalidate(): void {
    this.geometryTypeCached = false;
  }

  /** Release the panes this surface synthesized. The layer is off the map by
   *  the time this runs (LayerController.unregisterLayer), so nothing renders into
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
   *  nothing.
   *
   *  Every input `capabilities` is derived from belongs here: a declaration
   *  that gained or lost a bounds provider describes a different face (the UI
   *  decides whether to offer focus from that flag), and the pane name is
   *  compared as the surface normalized it, so a rejected name does not read
   *  as "changed" on every pass. `color` and `getBounds` are both compared as
   *  presence, never as value or reference — see the fields.
   *
   *  `getBounds` is compared by presence (`!= null`), not reference — callers
   *  hand a fresh arrow on every register, and a different arrow for the same
   *  shape is not a different face. A layer with a native `getBounds` always
   *  has `capabilities.bounds: true` regardless of the provider field, so the
   *  OR in `detectCapabilities` reduces to the provider alone for layers that
   *  lack the method — adding or removing it changes the capability and must
   *  trigger a rebuild. */
  matches(opts: SurfaceFaceOpts): boolean {
    const paneSpecs = opts.paneSpecs ?? [];
    // `role` and `order` are part of the declaration, not decoration: a spec
    // whose role changes describes a different face, and the surface has to be
    // rebuilt. They are derived from the index today (`LayerFactory` writes
    // them from position), which makes the two comparisons look redundant —
    // they stop being so the moment a spec carries a role its position does
    // not imply, which is where R9's `z = f(layerIndex, role)` and the
    // per-role renderer defaults are headed.
    const samePanes =
      this.paneSpecs.length === paneSpecs.length &&
      this.paneSpecs.every(
        (spec, i) =>
          spec.role === paneSpecs[i].role &&
          spec.order === paneSpecs[i].order &&
          spec.name === paneSpecs[i].name,
      );
    // Probe results are part of the declaration: a tree that gained or lost a
    // `setStyle` leaf describes a different face, and the surface has to be
    // rebuilt so the next read of `capabilities.stroke` / `.fill` sees the
    // fresh answer. Recomputed on every `matches` call — the walk is bounded
    // by the layer's own tree and the surface is resolved once per register,
    // so the cost is one tree walk per re-registration, not per frame.
    return (
      this.surfaceDecl.layer === opts.layer &&
      this.surfaceDecl.kind === kindOf(opts) &&
      this.surfaceDecl.custom === (opts.custom !== undefined) &&
      this.surfaceDecl.paneName === declaredPaneName(opts.paneName) &&
      this.surfaceDecl.canvas === Boolean(opts.canvas) &&
      this.surfaceDecl.color === (opts.color != null) &&
      Boolean(this.surfaceDecl.getBounds) === Boolean(opts.getBounds ?? null) &&
      this.surfaceDecl.fill === probeVectorCarrier(opts.layer, "fill") &&
      this.surfaceDecl.stroke === probeVectorCarrier(opts.layer, "stroke") &&
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
    role: PaneRole = PANE_ROLE.BASE,
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
      this.host.pinLateContent([
        { layer: this.layer, paneName: this.pinTarget, renderer: base.renderer },
      ]);
      return;
    }
    if (!isContainer(this.layer as PinnableNode)) {
      // A declared pane on a flat layer is still ours to place: the layer
      // itself carries the pane, and its element needs moving when it is
      // already attached.
      this.host.pinLateContent([
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
  }
}

/** Whether the layer paints through a setter of its own (not a pane of ours).
 *
 *  `GridLayer` and `ImageOverlay` both fall into this bucket: `GridLayer` (and
 *  its `TileLayer` subclass) carries `options.opacity` + `minZoom`/`maxZoom`
 *  and reads them at `addLayer`; `ImageOverlay`'s `<img>` stays in the shared
 *  `overlayPane` — a pane write would fade every layer in that shared pane —
 *  but its own `setOpacity` is immediate and correct. */
const usesNativeSetter = (layer: L.Layer): boolean =>
  (typeof L.GridLayer !== "undefined" && layer instanceof L.GridLayer) ||
  (typeof L.ImageOverlay !== "undefined" && layer instanceof L.ImageOverlay);

/** Resolve one vector-style probe against the layer's tree. `axis` picks
 *  the probe (`stroke` → `hasSetStyleLeaf`, `fill` → `hasFillLeaf`). A
 *  null layer yields "none" — there is no tree to walk. Called from the
 *  constructor (to seed `surfaceDecl.stroke` / `surfaceDecl.fill`) and from `matches`
 *  (to detect a tree change on re-registration). */
const probeVectorCarrier = (
  layer: L.Layer | null,
  axis: "stroke" | "fill",
): "native" | "none" => {
  if (!layer) return CAP_TIER.NONE;
  const found = axis === "stroke" ? hasSetStyleLeaf(layer) : hasFillLeaf(layer);
  return found ? CAP_TIER.NATIVE : CAP_TIER.NONE;
};

/** Resolve a surface's capabilities from what it actually owns.
 *
 *  Every situation where content could land outside our panes is either given
 *  a carrier or honestly downgraded to "none" here — that is the precondition
 *  for deleting the per-feature walk: no case is left with a write that is
 *  neither owned nor declared impossible.
 *
 *    - MarkerCluster → "none" for both. The cluster icons stay in the shared
 *      `markerPane`, `eachLayer` cannot reach them.
 *    - GridLayer / ImageOverlay → "native". `ImageOverlay`
 *      `setOpacity` immediate-and-correct; `GridLayer` options immediate at
 *      addLayer (zoomRange honest only for GridLayer, not ImageOverlay).
 *    - Everything else registered with a content surface → "pane" (declared
 *      or synthesized). Includes createCanvas whose canvas sits in its own
 *      dedicated pane.
 *
 *  The only "none" left is a layer that has no content we can route: the
 *  constructor synthesizes no pane and none is declared — e.g. a third-party
 *  plugin that builds its own canvas in Leaflet's `overlayPane`. Its content
 *  is not ours to write.
 *
 *  `bounds` answers a different question — "can we ask this surface for a
 *  geographic extent to focus on?" — and its rules are different:
 *
 *    - MarkerCluster's group bounds are unreliable (Leaflet's own docs warn
 *      that they're a bounding box of the leaves' bounds, but individual
 *      cluster markers may sit outside), so we treat them as having no
 *      honest carrier and let the UI disable focus.
 *    - GridLayer / ImageOverlay carry their own `getBounds` — `native`.
 *    - A Layer with a `getBounds()` method (most Leaflet vector layers,
 *      groups with leaves that expose bounds) gets `true`.
 *    - A canvas surface gets `true` only if the caller provided a
 *      `getBounds` provider; a bare canvas has no idea what it covers. */
const detectCapabilities = (opts: SurfaceFaceOpts): LayerCapabilities => {
  const layer = opts.layer;
  // The label pane is a declared carrier, read like `bounds` rather than
  // probed: the registration edge (`LayerController.surfaceFor`) appends the
  // `role: "annotation"` spec exactly when the layer's features expose
  // labelable `feature.properties`, and the constructor below materializes
  // that spec's pane in every branch — so the capability and the pane are
  // the same fact. Every branch reports it, early returns included: a
  // MarkerCluster whose children carry properties still has an honest
  // label pane (the probe decides the spec, not the branch shape).
  const annotation: LayerCapabilities["annotation"] = opts.paneSpecs?.some(
    spec => spec.role === PANE_ROLE.ANNOTATION,
  )
    ? CAP_TIER.PANE
    : CAP_TIER.NONE;

  if (opts.color != null) {
    // A solid-color basemap owns one pane of its own, so a CSS write on that
    // pane is the only honest opacity carrier. It carries no geographic
    // extent, so the UI disables focus rather than offering a click that is a
    // silent no-op. `fill: "native"` — the pane's paint *is* the fill — and
    // `zoomRange: "pane"` so the row renders (the executor's `visible` op is
    // the carrier, same as every other surface). Stroke stays "none": there
    // is no vector stroke axis on a solid colour.
    return {
      fill: CAP_TIER.NATIVE,
      stroke: CAP_TIER.NONE,
      opacity: CAP_TIER.PANE,
      zoomRange: CAP_TIER.PANE,
      annotation,
      relocatable: true,
      bounds: false,
      visibility: CAP_TIER.PANE,
    };
  }

  // Cluster is a first-class kind: capability dispatch goes through the
  // discriminant (`CLUSTER_CAPABILITIES`), not a duck-typed side path. An
  // undeclared MarkerCluster still resolves to `kind: "cluster"` through
  // `kindOf`, and a declared `kind: "cluster"` reaches this branch without
  // needing the plugin's group to still look like a MarkerCluster.
  if (kindOf(opts) === KIND.CLUSTER) {
    return { ...CLUSTER_CAPABILITIES, annotation };
  }

  if (layer && usesNativeSetter(layer)) {
    // ImageOverlay's zoomRange is declared in options but not runtime-effective
    // once attached: only GridLayer honours min/maxZoom live. Native setter
    // surfaces (GridLayer / ImageOverlay) own no `setStyle` leaf, so both
    // vector axes are "none".
    const zoomRange: LayerCapabilities["zoomRange"] =
      layer instanceof L.GridLayer ? CAP_TIER.NATIVE : CAP_TIER.NONE;
    return {
      fill: CAP_TIER.NONE,
      stroke: CAP_TIER.NONE,
      opacity: CAP_TIER.NATIVE,
      zoomRange,
      annotation,
      relocatable: true,
      bounds: hasBoundsProvider(layer),
      visibility: CAP_TIER.NATIVE,
    };
  }

  // The surface paints into panes we own — declared, sub, or synthesized — so
  // one style write per pane covers every child. `opts.canvas` covers the
  // createCanvas shape, whose canvas element sits inside its own dedicated
  // pane. Since R11 the canvas face bakes layerAlpha into its draws
  // (`#common/canvasAlpha`); the capability still reports `"pane"` because
  // that is the honest "we own this face" tier — the bake-vs-CSS mechanism
  // distinction is a T222 capabilities shape (`"baked"`/`"redraw"`), not
  // something this detector invents.
  const hasContentPanes =
    Boolean(opts.paneName) ||
    (opts.paneSpecs && opts.paneSpecs.length > 0) || // eslint-disable-line @typescript-eslint/prefer-nullish-coalescing -- left side can be false
    opts.canvas;

  // Visibility carrier: "native" for any surface backed by a real L.Layer
  // (map membership), "pane" for canvas-only surfaces (heatmap / color face),
  // "none" only when neither exists — a layer with no map to add to and no
  // canvas to hide would have no honest toggle at all.
  const visibility: LayerCapabilities["visibility"] = layer
    ? CAP_TIER.NATIVE
    : opts.canvas
      ? CAP_TIER.PANE
      : CAP_TIER.NONE;

  if (hasContentPanes) {
    return {
      fill: probeVectorCarrier(layer, "fill"),
      stroke: probeVectorCarrier(layer, "stroke"),
      opacity: CAP_TIER.PANE,
      zoomRange: CAP_TIER.PANE,
      annotation,
      relocatable: true,
      bounds: Boolean(opts.getBounds) || hasBoundsProvider(layer),
      visibility,
    };
  }

  // A non-grid, non-native layer with no declared pane and no canvas: the
  // constructor would synthesize a fallback (any non-grid `layer` gets one).
  // That pane is addressable on its own.
  if (layer) {
    return {
      fill: probeVectorCarrier(layer, "fill"),
      stroke: probeVectorCarrier(layer, "stroke"),
      opacity: CAP_TIER.PANE,
      zoomRange: CAP_TIER.PANE,
      annotation,
      relocatable: true,
      bounds: hasBoundsProvider(layer),
      visibility,
    };
  }

  // No layer at all and no canvas — nothing to write.
  return {
    fill: CAP_TIER.NONE,
    stroke: CAP_TIER.NONE,
    opacity: CAP_TIER.NONE,
    zoomRange: CAP_TIER.NONE,
    annotation,
    relocatable: false,
    bounds: false,
    visibility,
  };
};

export { LayerSurface };
