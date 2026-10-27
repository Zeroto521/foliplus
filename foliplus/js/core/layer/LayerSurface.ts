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
//   - `materialize()` runs before `map.addLayer`, so `options.pane` is already
//     right at the one moment Leaflet reads it — `Layer.options.pane` is
//     ignored after `addLayer`, so a pane decided later can only be reached by
//     moving DOM.
//   - the pane *set* is fixed once materialized. Content may still arrive — a
//     third party can mutate a registered group's tree — and the surface
//     re-pins it on the next reconcile (see `contentDirty`), but no consumer
//     has to handle a "not yet sorted" window. One pane joins the set
//     lazily: the marker-shadow pane (`ensureShadowPane`) is synthesized
//     during the same reconcile that first pins a marker leaf, so a group
//     that registered empty still gains a shadow carrier — before anything
//     is pinned into it, never after.
//
// No CONFIG / translator dependency: core/layer, not a component dir.
import { createLogger } from "#common/log.js";
import type { PaneManager } from "./PaneManager.js";
import {
  type LayerCarrierProbe,
  hasMarkerLeaf,
  probeLayerCarrier,
} from "./capability.js";
import { assertInsideOwnedPanes, visibleDomOf } from "./carrier.js";
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

/** Validate a caller-declared pane name against the DOM-bound shape — a name
 *  outside `PANE_NAME_PATTERN` is not a pane we can create, it lands in the
 *  DOM as a Leaflet pane id and class. The shared-pane refusal is layered on
 *  top in `LayerSurface.normalizeDeclared` (it needs the host's
 *  `defaultPanes`); both rejections degrade the same way: "not declared",
 *  and the constructor's fallback synthesis takes over. */
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
}

class LayerSurface implements LayerSurfaceContract {
  readonly id: string;
  readonly layer: L.Layer | null;
  /** Base pane first. `destroy` empties it in place — never replaces the
   *  array — so a closure that captured `surface.panes` at focus time also
   *  sees the empty set when the surface retires under it. */
  readonly panes: PaneHandle[] = [];
  materialized = false;
  /** What this surface can actually be asked to do — resolved at
   *  construction from the declaration and re-derived from the live tree
   *  on every audit (see `refreshCapabilities`). Never persisted: letting a
   *  caller supply it would let them claim support they do not have and
   *  break the honest-degradation contract. The object identity is stable
   *  so readers can hold it; its tree-projected slots move in place. */
  readonly capabilities: LayerCapabilities;
  /** Whether the layer's tree has changed since the last reconcile. Set by the
   *  manager on `layeradd` (synchronously — the probe path calls
   *  `enforceOrder` directly, so a debounce-only trigger would miss it) and
   *  cleared by `materialize()`. */
  contentDirty = false;

  /** Whether `destroy()` has run. Controller attribution skips a retired
   *  surface instead of walking its layer or marking it dirty. */
  get retired(): boolean {
    return this.destroyed;
  }

  /** Whether the style axes and the opacity carrier are projections of the
   *  live tree (the pane-carrier branches) rather than of the declaration.
   *  Only those surfaces re-derive on an audit; a color / cluster /
   *  native-setter / canvas face answers from its declaration. */
  private readonly treeDerived: boolean;
  /** The four-question probe for the current tree, reused within one
   *  dirty cycle. Only the probe is cached: the visible-DOM enumeration is
   *  a snapshot of DOM that can move without the tree changing (a renderer
   *  re-creation, `setIcon`, a pin), so it is recomputed at each audit and
   *  never carried across a content cycle — a stale enumeration would let
   *  a leaf that has since escaped a pane keep an old "pane" verdict.
   *
   *  `markContentDirty` clears it; a same-id replacement builds a new
   *  surface, so `layer` identity is enough. Deliberately per-surface, not
   *  a global `L.stamp` map: the audit's lifetime is the surface's. */
  private carrierAudit: {
    layer: L.Layer;
    probe: LayerCarrierProbe;
  } | null = null;
  /** Set by `destroy()`. A retired surface must ignore late content marks
   *  and must never be walked for ownership again — teardown fires map
   *  events after the lease is gone. */
  private destroyed = false;

  private readonly host: PaneManager;
  private readonly paneSpecs: readonly PaneSpec[];
  private readonly surfaceDecl: SurfaceDeclaration;
  /** The pane this surface synthesized because the layer declared none. Its
   *  content is pinned here; a declared pane's content is routed by whoever
   *  declared it (createLayers), so there is nothing for us to pin. Not
   *  readonly: destroy() resets it, so a retired surface stops reporting a
   *  carrier it no longer holds. */
  private pinTarget: string | null;
  /** The marker-shadow pane synthesized alongside `pinTarget` (see
   *  `addShadowPane`), or null when the layer has no marker leaves — or is
   *  not a synthesized surface at all. This is the one pane whose content the
   *  base pane does not host, so every write that "covers the layer's panes"
   *  must go through `surface.panes`, never through the base pane alone. */
  private shadowPaneName: string | null = null;
  /** Every pane name this surface holds a lease on — base, sub, annotation,
   *  shadow, canvas — in acquisition order. `destroy` releases all of them:
   *  the lease always retires, and the element goes only for the panes
   *  foliplus created as this surface's own carrier. */
  private acquiredPanes: string[] = [];

  constructor(host: PaneManager, opts: SurfaceFaceOpts) {
    this.host = host;
    this.id = opts.id;
    this.layer = opts.layer;
    this.paneSpecs = opts.paneSpecs ?? [];

    // The declared paneName is a third-party input that reaches the DOM as a
    // Leaflet pane id / class. If it fails `PANE_NAME_PATTERN`, or names one
    // of Leaflet's shared panes, treat it as not declared — the fallback
    // synthesis below then gives the layer a stamped pane that is provably
    // safe (FALLBACK_PANE_PREFIX + a number). The shared-pane rejection is
    // the declaration-side half of `PaneManager.assertOwnedPane`: an adopted
    // shared pane would route this layer's z / opacity / focus writes onto a
    // pane every other layer draws into.
    const declaredRaw = opts.paneName ?? null;
    const declared = this.normalizeDeclared(declaredRaw);
    if (declaredRaw != null && declared === null) {
      log.warn(
        `LayerSurface rejected paneName "${declaredRaw}" (injection-unsafe or ` +
          `one of Leaflet's shared panes); synthesising a fallback pane instead`,
      );
    }
    const layer = opts.layer;
    // One visit answers every carrier question for the tree — see
    // `probeLayerCarrier` for why the axes share a walk. The same probe seeds
    // the audit, so the capabilities refresh below does not walk again.
    const carrier = probeLayerCarrier(layer);
    this.surfaceDecl = {
      layer,
      kind: kindOf(opts),
      custom: opts.custom !== undefined,
      paneName: declared,
      canvas: opts.canvas === true,
      color: opts.color != null,
      getBounds: opts.getBounds ?? null,
    };
    this.carrierAudit = layer ? { layer, probe: carrier } : null;
    // Capabilities are resolved here, before any early return below, so every
    // branch — declared, synthesized, native — reports the same way. The
    // object is a projection: `refreshCapabilities()` re-derives its
    // tree-backed slots on every audit, so a degrade can recover.
    const resolution = detectCapabilities(opts, carrier);
    this.capabilities = resolution.capabilities;
    this.treeDerived = resolution.treeDerived;

    if (declared) {
      // The declared pane's own spec — matched BY NAME, not position: a
      // caller may hand a spec list whose index 0 is something else (an
      // appended label pane, for one), and a position-based read would
      // stamp that spec's role onto the base pane while never booking the
      // pane the extra spec names.
      //
      // Admission is TRANSACTIONAL: every pane this surface is about to
      // book goes through `canAcquirePane` first and the booking loop runs
      // only over the admitted set — a refused spec (shared name, held
      // elsewhere, foreign content) can never leave a half-stamped class
      // or lease behind. A raw `paneSpecs` naming a Leaflet shared pane
      // hits the same gate here.
      const base = this.paneSpecs.find(spec => spec.name === declared);
      const bookable = this.paneSpecs.filter(
        spec => spec.name === declared || this.host.canAcquirePane(spec.name, this.id),
      );
      // The base pane books first (panes[0] is the content pane), then the
      // admitted sub-panes in declaration order.
      this.addPane(declared, !opts.canvas, base?.role, base?.order);
      for (const spec of bookable) {
        if (spec.name === declared) continue;
        this.addPane(spec.name, false, spec.role, spec.order);
      }
      if (bookable.length < this.paneSpecs.length) {
        const refused = this.paneSpecs
          .filter(spec => !bookable.includes(spec))
          .map(spec => spec.name);
        log.warn(
          `LayerSurface skipped pane specs ${refused.join(", ")}: not ` +
            `acquireable (shared, held by another surface, or carrying ` +
            `foreign content)`,
        );
      }
      this.pinTarget = null;
      this.refreshCapabilities();
      return;
    }

    // No declared pane: every layer gets a synthesized one so each carries
    // its own z in the ordering ladder (row order = z order across
    // kinds — a color layer must be able to interleave with two tile layers).
    // GridLayer/TileLayer used to short-circuit here and paint in the shared
    // tilePane, which confined their z to that one shared stack; first-class
    // basemaps retire that.
    if (!layer) {
      this.pinTarget = null;
      this.addMissingSpecs();
      this.refreshCapabilities();
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
    let admitted = 0;
    for (const name of childPanes) {
      // A pane this surface cannot acquire (held by another surface, or
      // painting foreign content) stays out of the handle set — co-owning it
      // would co-write it. The name's elements keep painting for their real
      // owner; this surface degrades for that share.
      if (!host.canAcquirePane(name, this.id)) {
        log.warn(
          `LayerSurface skipped discovered pane "${name}": not acquireable ` +
            `(held by another surface or carrying foreign content)`,
        );
        continue;
      }
      // A pane registered through `createLayers({ panes })` already has a
      // renderer from `ensureVector`; only a foreign pane needs one built.
      const spec = host.childPaneSpecs.get(name);
      this.addPane(name, spec === undefined, spec?.role, spec?.order);
      admitted++;
    }
    if (admitted > 0) {
      this.pinTarget = null;
      this.addMissingSpecs();
      this.refreshCapabilities();
      return;
    }
    // Every discovered pane was refused: without this fallback the surface
    // would report pane coverage while holding no base carrier at all. The
    // synthesized route gives the layer a provably exclusive pane instead.
    // (The pane name is an incrementing L.stamp — always inside
    // PANE_NAME_PATTERN, so no injection validation is needed here; the
    // third-party-facing gates are the declared `paneName` check and
    // `registerPaneSpecs` above.)
    const name = `${FALLBACK_PANE_PREFIX}${L.stamp(layer)}`;
    if (this.addPane(name, true)) {
      this.pinTarget = name;
      this.addMissingSpecs();
    } else {
      // The fallback could not be booked either. Its name is stamped from
      // L.stamp, so refusal means a pre-built pane of that exact name already
      // exists and is not provably ours. With no base carrier at all the
      // surface must stop promising pane coverage rather than advertise a z
      // / opacity write that lands nowhere.
      this.pinTarget = null;
      log.warn(
        `LayerSurface could not create fallback pane "${name}": no pane ` +
          `carrier at all, so the layer cannot be faded or z-reordered by pane`,
      );
    }
    this.refreshCapabilities();
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
    const refused: string[] = [];
    for (const spec of this.paneSpecs) {
      if (this.panes.some(pane => pane.name === spec.name)) continue;
      // A refused spec leaves a gap between what `capabilities` declares and
      // what `panes` covers — reported here, not left silent.
      if (!this.addPane(spec.name, false, spec.role, spec.order)) {
        refused.push(spec.name);
      }
    }
    if (refused.length) {
      const names = refused.join(", ");
      log.warn(
        `LayerSurface skipped pane specs ${names}: not acquireable (shared, ` +
          `held by another surface, or carrying foreign content)`,
      );
    }
  }

  /** Ensure the layer's marker-shadow pane exists, then pin. Synthesizing
   *  here — not in the constructor — is what keeps the coverage honest for
   *  content that arrives late: a group that registered empty grows marker
   *  leaves on `layeradd`, and the next reconcile must pin their shadows
   *  into a pane that did not exist when the tree was last probed. The pane
   *  is created in the same synchronous pass that pins into it, so no
   *  consumer sees a half-sorted window (the fixed pane-set promise, one pane
   *  wider).
   *
   *  The invariant every layer capability leans on — "a write on the layer's
   *  panes reaches its whole visible DOM" — breaks exactly where a marker's
   *  shadow lives: Leaflet mounts it in the shared `shadowPane` (z=500),
   *  which no surface owns, so pane opacity left the shadow at full strength
   *  and focus-mode could only hide shadows globally (the removed
   *  `.leaflet-shadow-pane` rule in focus.css), taking the focused layer's
   *  own shadows down with the rest. A per-layer shadow pane closes the gap:
   *  `pinLateContent` moves `_shadow` in and writes `options.shadowPane`, and
   *  the pane sits one step BELOW the base (PaneRole.SHADOW → z = slot − 1),
   *  so the shadow paints under its icon by pane ladder — marker icons carry
   *  an inline `z-index = pos.y + zIndexOffset` that goes negative near the
   *  viewport top, where DOM order alone would put the shadow above the icon.
   *
   *  Serves every surface whose tree carries markers — synthesized or
   *  declared: the declared-pane routes do not repin their content's pane
   *  assignment, but the shadow pane is this surface's own carrier (the
   *  icons' pane assignment belongs to the declarer; shadows have none).
   *  A name that a declared spec already claims, or that another surface
   *  holds, is left alone (warn + skip) — an honest gap for that caller, not
   *  a collision. Either way the shadow pane name stays unset, so nothing
   *  points a marker's shadow at a pane this surface does not own. */
  private ensureShadowPane(): void {
    if (this.shadowPaneName || !this.layer || !this.panes.length) return;
    if (!hasMarkerLeaf(this.layer)) return;
    const name = `${this.panes[0].name}-shadow`;
    if (
      this.paneSpecs.some(spec => spec.name === name) ||
      this.panes.some(pane => pane.name === name)
    ) {
      log.warn(
        `marker-shadow pane name "${name}" is already claimed by a declared ` +
          `pane; marker shadows stay on Leaflet's shared shadowPane`,
      );
      return;
    }
    // Record the name only when the lease is really ours: a refused shadow
    // booking would still land in `options.shadowPane`, redirecting every
    // marker shadow into another surface's pane (cross-owner DOM migration).
    if (!this.addPane(name, false, PANE_ROLE.SHADOW)) {
      log.warn(
        `marker-shadow pane "${name}" could not be acquired; marker shadows ` +
          `stay on Leaflet's shared shadowPane`,
      );
      return;
    }
    this.shadowPaneName = name;
  }

  /** Resolve the pane handles and pin the layer's content to them. Re-entrant:
   *  the first call resolves and pins; later calls re-pin and re-audit only
   *  when the layer's tree has changed (`contentDirty`). Steady state — every
   *  pass after the content has settled — is a no-op, so the ordering pass
   *  writes z only and the carriage audit is read from its dirty-cycle cache. */
  materialize(): void {
    if (this.materialized && !this.contentDirty) return;
    this.reconcile();
    this.contentDirty = false;
    this.materialized = true;
  }

  /** Mark the layer's tree as having changed since the last reconcile.
   *  The cached probe describes the tree that just changed, so it is dropped
   *  here — the next reconcile walks once, and every read until then reuses
   *  that fresh answer. A retired surface ignores the mark: teardown can fire
   *  late `layeradd`/`layerremove` events after its leases are gone. */
  markContentDirty(): void {
    if (this.destroyed) return;
    this.contentDirty = true;
    this.carrierAudit = null;
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
    // Snapshot the handles we already hold — the write path never acquires
    // (see writeZ), so there is no lease to win back here either.
    this.zBefore = this.panes.flatMap(pane => [
      [pane.element, pane.element.style.zIndex] as [HTMLElement, string],
    ]);
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
   *  otherwise the ordering pass's. Writes nothing before either has been.
   *
   *  Write path, so it acquires nothing: every pane was booked at construction
   *  and its element is already on the handle. Calling `ensurePane` here would
   *  re-open the admission door on a write — a retired surface whose lease
   *  `destroy` had just handed back could quietly win the pane again on the
   *  next late write instead of being refused.
   *
   *  Each name is gated through `assertOwnedPane` — a shared pane name can
   *  only get here through a surface that adopted one, and lifting that would
   *  reorder the whole map. */
  private writeZ(): void {
    const base = this.overrideZ ?? this.baseZ;
    if (base === undefined) return;
    for (const pane of this.panes) {
      this.host.assertOwnedPane(pane.name);
      pane.element.style.zIndex = String(
        zFor({ base, paneRole: pane.role, order: pane.order }),
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

  /** Drop the cached geometry type *and* the carrier probe. This is the
   *  content-change hook (`createLayers` add/remove/clear); a DOM-only change
   *  that never reaches it is re-enumerated by the next audit anyway, because
   *  `auditCarrier` never reuses a previous visible-DOM snapshot. */
  invalidate(): void {
    this.geometryTypeCached = false;
    this.markContentDirty();
  }

  /** Release every pane this surface holds, then neutralise its own state so a
   *  retired surface is genuinely unusable. The layer is off the map by the
   *  time this runs (LayerController.unregisterLayer), so nothing renders into
   *  them; a *declared* pane survives, which is what lets the same id be
   *  registered again without rebuilding its panes.
   *
   *  Retiring only the leases was not enough: a surface destroyed mid-focus
   *  (unregister, same-id replacement) left `panes` / `baseZ` / `overrideZ`
   *  intact, so a focus-restore closure still holding it would walk those
   *  names through `assertOwnedPane` and throw — after the lease was already
   *  gone — and that throw escaped past the focus mask/rect teardown, leaving
   *  the map dimmed permanently. Every write method below guards on an empty
   *  `panes` or a cleared `overrideZ`, so the neutralisation turns every such
   *  late call into a no-op instead of an error.
   */
  destroy(): void {
    // Retire first: a `layerremove` fired by the pane release below must
    // not re-mark this surface through the controller's attribution.
    this.destroyed = true;
    // Release every lease this surface holds; the element is deleted only
    // for the panes foliplus created as this surface's own carrier (the
    // synthesized base pane and the marker-shadow pane). An adopted or
    // caller-declared pane outlives the surface, which is what lets the same
    // id be registered again without rebuilding panes — but its lease is
    // retired either way, so a retired surface never keeps a name blocked.
    // A canvas face's own pane is retired by that face's `destroy` — the only
    // path that deletes its DOM. Releasing the lease here would leave that call
    // with nothing to check against, and the element would stay on the map with
    // nobody left to take it off.
    const canvasPane = this.surfaceDecl.canvas ? this.surfaceDecl.paneName : null;
    for (const name of this.acquiredPanes) {
      if (name === canvasPane) continue;
      this.host.releasePane(
        name,
        this.id,
        name === this.pinTarget || name === this.shadowPaneName,
      );
    }
    this.acquiredPanes = [];
    // Then drop every handle and every z value. A retired surface must not be
    // able to write — let alone re-acquire — anything: a focus restore or an
    // in-flight ordering pass may still hold a reference to it. `panes` is
    // emptied in place so a closure that captured the array sees empty too,
    // which is what makes the restore a no-op rather than a throw.
    this.panes.length = 0;
    this.baseZ = undefined;
    this.overrideZ = undefined;
    this.zBefore = undefined;
    this.shadowPaneName = null;
    this.pinTarget = null;
    // The audit describes a tree this surface no longer owns; drop it so a
    // retired surface cannot answer with a stale projection.
    this.carrierAudit = null;
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
   *  not change too, rebuilding would destroy correctly pinned panes for
   *  nothing.
   *
   *  Every DECLARATION input `capabilities` is derived from belongs here:
   *  a declaration that gained or lost a bounds provider describes a
   *  different face (the UI decides whether to offer focus from that flag),
   *  and the pane name is compared as the surface normalized it, so a
   *  rejected name does not read as "changed" on every pass. `color` and
   *  `getBounds` are both compared as presence, never as value or reference
   *  — see the fields.
   *
   *  `getBounds` is compared by presence (`!= null`), not reference — callers
   *  hand a fresh arrow on every register, and a different arrow for the same
   *  shape is not a different face. A layer with a native `getBounds` always
   *  has `capabilities.bounds: true` regardless of the provider field, so the
   *  OR in `detectCapabilities` reduces to the provider alone for layers that
   *  lack the method — adding or removing it changes the capability and must
   *  trigger a rebuild. */
  matches(opts: SurfaceFaceOpts): boolean {
    // Face identity only. Capability is a projection of the tree, not part of
    // the face: a tree that gained an unknown leaf (or lost one) must degrade
    // and recover through `refreshCapabilities`, not by destroying and
    // rebuilding the surface on every audit. Content changes are signalled by
    // `markContentDirty` (the manager's `layeradd` attribution) and by the
    // next registration; `matches` is not a content-change detector.
    return this.sameShape(opts);
  }

  /** The whole face comparison: the layer's own identity plus the values
   *  the registry writes at register time, so this is a handful of field
   *  reads and a small array compare.
   *
   *  Probe-derived capabilities are deliberately absent. They move when the
   *  tree moves, and rebuilding a face because its projection moved would
   *  destroy a live surface (and its panes) on every degrade — including the
   *  one that must be able to recover. */
  private sameShape(opts: SurfaceFaceOpts): boolean {
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
    return (
      this.surfaceDecl.layer === opts.layer &&
      this.surfaceDecl.kind === kindOf(opts) &&
      this.surfaceDecl.custom === (opts.custom !== undefined) &&
      this.surfaceDecl.paneName === this.normalizeDeclared(opts.paneName) &&
      this.surfaceDecl.canvas === Boolean(opts.canvas) &&
      this.surfaceDecl.color === (opts.color != null) &&
      Boolean(this.surfaceDecl.getBounds) === Boolean(opts.getBounds ?? null) &&
      samePanes
    );
  }

  // ── internals ──────────────────────────────────────────────────

  /** The pane name this surface will actually build with, from a raw
   *  declaration: pattern-validated by `declaredPaneName`, then refused when
   *  it names one of Leaflet's shared panes (`host.defaultPanes`). The
   *  constructor and `matches` both go through here, so a re-registration is
   *  always compared against the value the surface was really built with,
   *  not the raw string that was handed in. */
  private normalizeDeclared(raw: string | null | undefined): string | null {
    const declared = declaredPaneName(raw);
    if (declared && !this.host.canAcquirePane(declared, this.id)) {
      // The name is a Leaflet shared pane, held by another surface, or a
      // pre-built pane already painting foreign content — none of it is
      // provably exclusive, and acquiring it would co-write (or restyle)
      // someone else's carrier. Refuse here, where the honest degradation
      // (synthesize a stamped pane) is still a constructor-time decision.
      log.warn(
        `LayerSurface rejected paneName "${declared}": the pane is not ` +
          `acquireable (shared, held by another surface, or carrying ` +
          `foreign content); synthesising a fallback pane instead`,
      );
      return null;
    }
    return declared;
  }

  /** Ensure one pane and record its handle. `needRenderer` is true only where
   *  the surface itself places Path content (the base pane of a declared
   *  surface, and the synthesized fallback) — a sub-pane's renderer is built by
   *  the content that routes into it (`createLayers`' `ensureVector`), and
   *  building it here would put a full-size empty `<svg>` in every label pane.
   *
   *  Every pane is created `pointer-events: none` by CSS, and nothing here
   *  re-opens it: whether a pane's content takes a hit is the content's own
   *  call (`AnnotationCanvas` writes `none` on itself, a data canvas is
   *  re-enabled by the rule in `LayerControl/focus.css`).
   *
   *  The boolean is the admission answer, and callers must branch on it:
   *  a refused pane earns no handle and no name in the surface's state. A
   *  caller that assigned `shadowPaneName` or `pinTarget` after the call
   *  regardless would advertise a carrier that does not exist — the shape
   *  that pointed markers' shadows at another surface's pane.
   *
   *  @returns true when the lease was taken and the handle recorded.
   */
  private addPane(
    name: string,
    needRenderer: boolean,
    role: PaneRole = PANE_ROLE.BASE,
    order = 0,
  ): boolean {
    const { pane, renderer } = this.host.ensurePane(name, needRenderer, this.id);
    if (!pane) {
      // Admission refused the pane (held elsewhere, or foreign content): the
      // handle stays out of the surface's set, so nothing writes it. The
      // capability contract is answered after all booking is done.
      log.warn(`LayerSurface skipped pane "${name}": not acquireable by this surface`);
      return false;
    }
    this.acquiredPanes.push(name);
    this.panes.push({
      role,
      order,
      name,
      element: pane,
      renderer,
    });
    return true;
  }

  /** Pin the layer's content into its panes: its options always (so a not-yet-
   *  added leaf lands correctly — the materialize-before-add rule), and its
   *  already-rendered DOM when Leaflet has placed it somewhere else (the content
   *  a caller added to the map
   *  before we ever saw the layer, or since the last reconcile). */
  private reconcile(): void {
    if (!this.layer) return;
    const base = this.panes[0];
    if (!base) return;
    if (this.pinTarget) {
      // A synthesized pane owns the whole tree — pin everything into it.
      this.ensureShadowPane();
      this.host.pinLateContent([
        {
          layer: this.layer,
          paneName: this.pinTarget,
          renderer: base.renderer,
          shadowPaneName: this.shadowPaneName,
          owner: this.id,
        },
      ]);
      this.auditCarrier();
      return;
    }
    if (!isContainer(this.layer as PinnableNode)) {
      // A declared pane on a flat layer is still ours to place: the layer
      // itself carries the pane, and its element needs moving when it is
      // already attached. The shadow rides our shadow pane exactly as on the
      // synthesized route — a declared pane changes who assigns the icon's
      // pane, not whether the layer's full visible DOM is covered.
      this.ensureShadowPane();
      this.host.pinLateContent([
        {
          layer: this.layer,
          paneName: base.name,
          renderer: base.renderer,
          shadowPaneName: this.shadowPaneName,
          owner: this.id,
        },
      ]);
      this.auditCarrier();
      return;
    }
    // A declared pane on a container is for the record: Leaflet ignores a
    // group's pane for its children (they are routed by whoever declared them,
    // e.g. createLayers), so the surface must not recurse — that would collapse
    // every leaf onto the base pane. The one exception is shadows: they carry
    // no pane assignment of their own and must ride this surface's shadow
    // carrier for the pane-write invariant to hold.
    this.ensureShadowPane();
    const node = this.layer as PinnableNode;
    node.options.pane = base.name;
    this.host.pinLateShadows(this.layer, this.shadowPaneName, this.id);
    this.auditCarrier();
  }

  /** Re-derive the tree-backed capability slots from the current tree.
   *
   *  `capabilities` is a projection, not a stored fact: a tree that stopped
   *  being migratable must degrade now (fail closed), and a tree that became
   *  pane-carried again must recover. Only the pane-carrier branches move
   *  here; a color / cluster / native-setter / canvas surface answers from
   *  its declaration and never re-probes.
   *
   *  Writes in place so the object a reader holds stays valid.
   *
   *  Recovery is pushed, not deferred: the controller diffs these slots at the
   *  end of every ordering pass and announces the ids that moved
   *  (LAYER_CAPABILITY_CHANGED), so a style panel that is already open
   *  re-renders the rows the recovered tree now supports. Without that
   *  announcement the recovery would silently wait for a reopen. */
  private refreshCapabilities(): void {
    if (!this.treeDerived) return;
    // `treeDerived` is only true for a pane-carried layer (detectCapabilities
    // sets it as `!canvas && layer != null`), so the probe cannot be null here.
    const probe = this.auditProbe(this.layer!);
    this.capabilities.fill = probe.fill;
    this.capabilities.stroke = probe.stroke;
    this.capabilities.size = probe.size;
    // A pane write is honest only while every visible leaf belongs to a
    // family the migrator relocates AND we actually hold a base pane. An
    // empty container stays provisional-true: its leaves arrive later and
    // are re-audited on the next dirty cycle.
    // The carrier is the surface's own content pane — the synthesized target
    // or the declared base — not "any booked pane": an annotation/shadow-only
    // set has nothing an opacity write can reach. Role alone is not enough:
    // a caller may declare the base pane with a non-base role.
    //
    // Defensive invariant, not a reachable false-positive fix: every
    // constructor branch books its content pane before any other spec, so
    // "panes non-empty without the content pane" is not constructible from
    // the current declaration surface. Keep the name check anyway — it states
    // the carrier contract in the terms the contract is written in (a content
    // pane, not a role), and a future branch that appends a spec first would
    // degrade here instead of advertising a write it cannot make.
    const contentPaneName = this.pinTarget ?? this.surfaceDecl.paneName;
    const hasContentPane = this.panes.some(pane => pane.name === contentPaneName);
    const paneCarrier = hasContentPane && probe.migratable !== "mixed";
    this.capabilities.opacity = paneCarrier ? CAP_TIER.PANE : CAP_TIER.NONE;
    this.capabilities.relocatable = paneCarrier;
  }

  /** The four-question probe for the current tree, reused within one dirty
   *  cycle. `contentDirty` clears it; `layer` identity guards the same-id
   *  replacement path (a replacement builds a new surface and a new cache). */
  private auditProbe(layer: L.Layer): LayerCarrierProbe {
    if (this.carrierAudit?.layer === layer) return this.carrierAudit.probe;
    const probe = probeLayerCarrier(layer);
    this.carrierAudit = { layer, probe };
    return probe;
  }

  /** The carrier invariant, checked where it is supposed to hold: after a
   *  reconcile pinned the content. Re-derives the capabilities first, so a
   *  surface that degraded can recover on a later audit, then runs the
   *  enumeration only for surfaces that promise pane coverage. Diagnostic,
   *  not a throw: a violation means a pane write will miss part of the
   *  layer, which is a bug to log loudly, not a reason to take the ordering
   *  pass down mid-reconcile. */
  private auditCarrier(): void {
    this.refreshCapabilities();
    if (this.capabilities.opacity !== CAP_TIER.PANE) return;
    try {
      assertInsideOwnedPanes(this.panes, this.layer!, visibleDomOf(this.layer!));
    } catch (error) {
      // Fail closed: the audit found a leaf whose pixels no pane write can
      // reach, so the surface stops promising pane coverage (the UI hides
      // the write that would have lied) before logging the violation.
      this.capabilities.opacity = CAP_TIER.NONE;
      this.capabilities.relocatable = false;
      log.error(error instanceof Error ? error.message : String(error));
    }
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
 *      `getBounds` provider; a bare canvas has no idea what it covers.
 *
 *  `treeDerived` is the audit contract: true only for the pane-carrier
 *  branches, whose style axes and opacity tier are projections of the live
 *  tree rather than of the declaration. */
interface CapabilityResolution {
  capabilities: LayerCapabilities;
  /** True when the style axes and the opacity carrier are projections of the
   *  live tree (the pane-carrier branches), so every audit re-derives them. */
  treeDerived: boolean;
}

/** Resolve the initial capability answer — and whether the tree re-derives
 *  it — from the declaration plus the one probe visit the caller already
 *  paid for. */
const detectCapabilities = (
  opts: SurfaceFaceOpts,
  carrier: LayerCarrierProbe,
): CapabilityResolution => {
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
    // is no vector stroke axis on a solid color.
    return {
      capabilities: {
        fill: CAP_TIER.NATIVE,
        stroke: CAP_TIER.NONE,
        size: CAP_TIER.NONE,
        opacity: CAP_TIER.PANE,
        zoomRange: CAP_TIER.PANE,
        annotation,
        relocatable: true,
        bounds: false,
        visibility: CAP_TIER.PANE,
      },
      treeDerived: false,
    };
  }

  // Cluster is a first-class kind: capability dispatch goes through the
  // discriminant (`CLUSTER_CAPABILITIES`), not a duck-typed side path. An
  // undeclared MarkerCluster still resolves to `kind: "cluster"` through
  // `kindOf`, and a declared `kind: "cluster"` reaches this branch without
  // needing the plugin's group to still look like a MarkerCluster.
  if (kindOf(opts) === KIND.CLUSTER) {
    return {
      capabilities: { ...CLUSTER_CAPABILITIES, annotation },
      treeDerived: false,
    };
  }

  if (layer && usesNativeSetter(layer)) {
    // ImageOverlay's zoomRange is declared in options but not runtime-effective
    // once attached: only GridLayer honors min/maxZoom live. Native setter
    // surfaces (GridLayer / ImageOverlay) own no `setStyle` leaf, so both
    // vector axes are "none".
    const zoomRange: LayerCapabilities["zoomRange"] =
      layer instanceof L.GridLayer ? CAP_TIER.NATIVE : CAP_TIER.NONE;
    return {
      capabilities: {
        fill: CAP_TIER.NONE,
        stroke: CAP_TIER.NONE,
        size: CAP_TIER.NONE,
        opacity: CAP_TIER.NATIVE,
        zoomRange,
        annotation,
        relocatable: true,
        bounds: hasBoundsProvider(layer),
        visibility: CAP_TIER.NATIVE,
      },
      treeDerived: false,
    };
  }

  // The surface paints into panes we own — declared, sub, or synthesized — so
  // one style write per pane covers every child. `opts.canvas` covers the
  // createCanvas shape, whose canvas element sits inside its own dedicated
  // pane. Since R11 the canvas face bakes layerAlpha into its draws
  // (`#common/canvasAlpha`); the capability still reports `"pane"` because
  // that is the honest "we own this face" tier — the bake-vs-CSS mechanism
  // distinction belongs to a separate capabilities shape (`"baked"`/
  // `"redraw"`), not something this detector invents.
  const hasContentPanes =
    Boolean(opts.paneName) ||
    (opts.paneSpecs && opts.paneSpecs.length > 0) || // eslint-disable-line @typescript-eslint/prefer-nullish-coalescing -- left side can be false
    opts.canvas;

  // The pane carrier is real for this surface when the FULL tree audits
  // migratable — every visible leaf belongs to a family the migrator
  // relocates. An empty container is provisional (its leaves arrive later
  // and are re-audited on the next dirty cycle); the first unknown leaf — a
  // plugin with its own getElement, a canvas painter that never joins a
  // pane — flips the answer, because promising "pane" there would advertise
  // an opacity write the carrier never delivers. The probe above answered
  // this and the two vector axes plus size in one visit.
  const paneCarrier =
    Boolean(opts.canvas) || (layer != null && carrier.migratable !== "mixed");

  // Visibility carrier: "native" for any surface backed by a real L.Layer
  // (map membership), "pane" for canvas-only surfaces (heatmap / color face),
  // "none" only when neither exists — a layer with no map to add to and no
  // canvas to hide would have no honest toggle at all.
  const visibility: LayerCapabilities["visibility"] = layer
    ? CAP_TIER.NATIVE
    : opts.canvas
      ? CAP_TIER.PANE
      : CAP_TIER.NONE;

  // Only the pane-carrier branches project the style axes and the opacity
  // tier from the live tree. A canvas face owns its paint through the pane
  // (not through the tree), and the other early branches are declaration-
  // fixed; re-probing them on an audit would overwrite an honest answer with
  // a probe that does not apply.
  const treeDerived = !opts.canvas && layer != null;

  if (hasContentPanes) {
    return {
      capabilities: {
        fill: carrier.fill,
        stroke: carrier.stroke,
        size: carrier.size,
        opacity: paneCarrier ? CAP_TIER.PANE : CAP_TIER.NONE,
        zoomRange: CAP_TIER.PANE,
        annotation,
        relocatable: paneCarrier,
        bounds: Boolean(opts.getBounds) || hasBoundsProvider(layer),
        visibility,
      },
      treeDerived,
    };
  }

  // A non-grid, non-native layer with no declared pane and no canvas: the
  // constructor would synthesize a fallback (any non-grid `layer` gets one).
  // That pane is addressable on its own.
  if (layer) {
    return {
      capabilities: {
        fill: carrier.fill,
        stroke: carrier.stroke,
        size: carrier.size,
        opacity: paneCarrier ? CAP_TIER.PANE : CAP_TIER.NONE,
        zoomRange: CAP_TIER.PANE,
        annotation,
        relocatable: paneCarrier,
        bounds: hasBoundsProvider(layer),
        visibility,
      },
      treeDerived: true,
    };
  }

  // No layer at all and no canvas — nothing to write.
  return {
    capabilities: {
      fill: CAP_TIER.NONE,
      stroke: CAP_TIER.NONE,
      size: CAP_TIER.NONE,
      opacity: CAP_TIER.NONE,
      zoomRange: CAP_TIER.NONE,
      annotation,
      relocatable: false,
      bounds: false,
      visibility,
    },
    treeDerived: false,
  };
};

export { LayerSurface };
