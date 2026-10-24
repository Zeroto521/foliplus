import {
  EVENTS,
  type EventBus,
  SettledOperation,
  ensureEvents,
  publish,
} from "#core/event/index.js";
import {
  type CreateCanvasAPI,
  type CreateCanvasOpts,
  type CreateColorAPI,
  type CreateColorOpts,
  type CreateLayersAPI,
  type CreateLayersOpts,
  GEOM_TYPE,
  GROUP,
  type LabelAwareLayer,
  type LayerAPI,
  LayerFactory,
  LayerInfoRegistry,
  type LayerKind,
  LayerOrder,
  type LayerSurface,
  PaneManager,
  type RegisterLayerOpts,
  countFeatureGeometry,
  ensureLayerAPI,
  findLayer,
  walkLeaf,
  zFor,
} from "#core/layer/index.js";
import { hasAttachedPath, isGroupLike } from "#core/leafletAdapter.js";
import { type Debounced, debounce } from "#common/debounce.js";
import { createLogger } from "#common/log.js";
import type { Logger } from "#common/type.js";
import { AnnotationManager } from "./annotation/index.js";
import * as CONST from "./const.js";
import { LayerIntentStore, LayerOrchestration } from "./domain/index.js";
import { LayerPersistence } from "./persistence.js";
import { finishSlidersIn } from "./slider.js";
import { collectDeltas } from "./ui/apply.js";
import { type LayerUI } from "./ui/index.js";
import { cursorRef, reconcileCursorByIdentity } from "./ui/listPanel/cursor.js";
import { clearDragState } from "./ui/listPanel/drag.js";

type LayerControllerEnv = {
  readonly T: (key: string) => string;
  readonly log: Logger;
};

const NO_OP_ENV: LayerControllerEnv = {
  T: key => `LayerControl.${key}`,
  log: createLogger("LayerControl"),
};

// ==================== BringToFront Guard (monkey-patch) ====================
// Guard Leaflet's bringToFront against null parentNode during enforceOrder
// layer migration (enforceOrder briefly removes layers from the map, and a
// concurrent mousemove event may call bringToFront on a detached _path).
const origBringToFront = L.Path.prototype.bringToFront;
// Reference count: multiple LayerControl instances (multi-map pages) may patch
// the prototype; only the last unpatch restores the original implementation.
let bringToFrontPatchRefs = 0;

const installBringToFrontPatch = () => {
  bringToFrontPatchRefs++;
  if (bringToFrontPatchRefs > 1) return;
  L.Path.prototype.bringToFront = function () {
    if (hasAttachedPath(this)) origBringToFront.call(this);
    return this;
  };
};

const uninstallBringToFrontPatch = () => {
  if (bringToFrontPatchRefs <= 0) return;
  bringToFrontPatchRefs--;
  if (bringToFrontPatchRefs > 0) return;
  L.Path.prototype.bringToFront = origBringToFront;
};

// ==================== Core Manager: LayerController ====================
//
// LayerController is the orchestrator for the LayerControl component. Its
// boundary splits into three layers:
//
//   1. **LayerAPI public surface** — the methods other controls / third
//      parties call directly: `registerLayer`, `unregisterLayer`,
//      `createLayers`, `createCanvas`, `bringLayerToFront`, `touchLayer`,
//      `setVisible`, `getLayerType`, `getLayersByType`, `getFeatureCount`,
//      `refreshCount`, `findLayer`, `forEachLeaf`, `extractPoints`,
//      `computeZIndex`, `group`, and the `isLayerControl` flag. Anything
//      outside the component reads through these.
//   2. **Internal coordination** — the plumbing between LayerInfoRegistry,
//      PaneManager, LayerSurface, LayerFactory, AnnotationManager and
//      LayerPersistence. Methods here (`surfaceFor`, `enforceOrder`,
//      `resolveLayerPanes`, `saveOrder`, `refreshOrder`, `normalizeGroup`,
//      `onLayerAdd`, `debouncedEnforce`) are read by the sibling ui/*
//      modules and by LayerUI directly; they are not part of LayerAPI.
//   3. **UI delegation hub** — the handful of `ui.*` calls sprinkled
//      through the registration and ordering passes (insertLayerItem,
//      initLayerItem, invalidateFields, applyUserState, syncToggleAll,
//      initTypesAndVisibility, renderInitialList). These are coordinator
//      calls, not public API: they exist so the controller can drive the
//      rendering side without owning DOM.
//
// Geometry-type probing has moved off this file — the
// surface now owns `geometryType()` (cached), and this class reads from it.
// The `layerInfo.type` field is a snapshot mirror of that surface result,
// not a second source of truth.
//
// LayerController boundary reference — which layer each method belongs to.
// Public =
// stable contract, change carefully. Internal = LayerUI sibling read
// surface (ui/* + LayerUI); refactorable, but coordinate with ui/*.
//   LayerAPI  layers, registerLayer, unregisterLayer, deleteLayer,
//             forgetSavedOrder, dropPersistedLayerState, bringLayerToFront,
//             setVisible, createLayers, createCanvas, extractPoints,
//             getLayerPanes, isLayerControl
//   Public    getLayerType, getLayersByType, getFeatureCount, touchLayer,
//   extra     computeZIndex, moveLayerUp, moveLayerDown
//   Internal  surfaceFor, surfaceForLayer, enforceOrder, debouncedEnforce,
//             hasUnresolvedLayers, onLayerAdd, loadSavedOrder, saveOrder,
//             replaySavedOrder (order domain on `this.order` / LayerOrder.ts),
//             syncAttribution, desiredAttribution, attachUI, destroy, canReorderBetween,
//             findLayer, refreshCount, forEachLeaf,
//             clearAllLayers
//   Private   installBringToFrontPatch, uninstallBringToFrontPatch

class LayerController implements LayerAPI {
  /** Diagnostic marker: set by LayerController (true).  The lightweight stub
   * sets this to false.  For the actual LayerControl check, prefer
   * isRealLayerControl — a capability assertion that cannot be bypassed
   * by flag tampering — but this flag is convenient for ad-hoc logging.
   */
  isLayerControl = true;
  map: L.Map;
  /** Per-map event bus — bound once in the constructor (ensure-style getters
   *  return the cached instance, so hold it like the logger does). */
  events: EventBus;
  declare layerRegistry: LayerInfoRegistry;
  declare pendingRegistrations: LayerInfo[];
  declare uiContainer: HTMLElement | null;
  declare isEnforcing: boolean;
  declare isDestroyed: boolean;
  declare panes: PaneManager;
  /** The rendering face of each registered layer, keyed by layer id. Created on
   *  registration (and materialized before the layer joins the map) and dropped
   *  on unregistration — it is the replacement for the stamp-keyed fallback
   *  pane map and the per-layer `options.paneSet` "already moved" flag. */
  declare surfaces: Map<string, LayerSurface>;
  /** The same surfaces keyed by the live layer's stamp, for the lookups that
   *  start from a layer rather than from a registry entry. */
  declare private surfacesByLayer: Map<number, LayerSurface>;
  declare factory: LayerFactory;
  declare ui: LayerUI | null;
  declare debouncedEnforce: Debounced;
  persistence: LayerPersistence;
  /** User-arranged order + one-way deleted-id set. Owns `savedOrder` /
   *  `removedIds` and the load / snapshot / replay / prune methods; the
   *  controller forwards the public face and keeps the ownership call-sites
   *  (register gate, delete mark). */
  declare order: LayerOrder;
  declare annotation: AnnotationManager;
  declare domain: LayerOrchestration;
  /** Per-layer intent store — domain-owned, exposed on
   *  LayerUI as a read-only getter. Read via `this.intentStore` internally
   *  (register gate, deleteLayer) and via `ui.intentStore` externally. */
  declare intentStore: LayerIntentStore;
  declare onLayerAdd: (event: L.LeafletEvent) => void;
  declare getLayerPanes: (layer: L.Layer) => string[];
  private readonly T: (key: string) => string;
  private readonly log: Logger;

  constructor(
    mapInstance: L.Map,
    data: LayerInfo[],
    env: LayerControllerEnv = NO_OP_ENV,
  ) {
    this.map = mapInstance;
    this.T = env.T;
    this.log = env.log;
    this.events = ensureEvents(this.map);
    this.persistence = new LayerPersistence();
    // Delegates to `init` so storage recovery, factory assembly, application
    // tail, and LayerAPI mounting live in a separate phase (mirrors
    // MeasureManager). Constructor return completes with init done; external
    // callers never see an intermediate state.
    this.init(data);
  }

  /** Second phase: storage recovery, registry/factory/domain assembly,
   *  application tail (loadSavedOrder / normalizeGroups / enforceOrder /
   *  BEFORE_EXPORT listener), and LayerAPI mounting. Called synchronously
   *  from the constructor so the external API is never observed in an
   *  intermediate state — the phase split is semantic (deps wiring vs state
   *  assembly), not temporal.
   *
   *  @param data - Initial layer seed. The registry is built from this list
   *   (minus removed ids) here rather than being captured on the constructor
   *   as a field, so the init phase reads it directly. */
  init(data: LayerInfo[]) {
    // One read of the record at construction. `order` seeds the registry's
    // starting arrangement, and `removed` gates both entry points an id can
    // reach the registry through — this bulk build and registerLayer later — so
    // it has to be in memory before the registry exists. Reading it lazily at
    // attach time would let a layer the user deleted back into the panel on the
    // next reload.
    const saved = this.persistence.load();
    const removedIds = new Set(saved.removed);
    // A deleted id must leave the panel *and* the map: folium emits `addTo(map)`
    // for every layer at page load, so gating the registry alone would drop the
    // row while the map kept painting it across a reload. One pass does both.
    this.layerRegistry = new LayerInfoRegistry(
      data.filter(layerInfo => {
        if (!removedIds.has(layerInfo.id)) return true;
        // Late-binding fallback (folium script-stream order) — same single
        // point as `findLayer` / ExportControl's `resolveLayer`.
        const layer = layerInfo.layer ?? findLayer(this.map, layerInfo.id);
        if (layer && this.map.hasLayer(layer)) this.map.removeLayer(layer);
        return false;
      }),
      this.map,
    );
    this.order = new LayerOrder({
      registry: this.layerRegistry,
      getPersistence: () => this.persistence,
      savedOrder: saved.order,
      removedIds,
    });
    this.pendingRegistrations = [];
    this.uiContainer = null;

    // Bind method context: every layer-scoped method a component or the
    // factory may call detached. Collapse the repeated .bind(this) lines
    // into one loop (same effect); getLayerPanes = resolveLayerPanes.bind
    // below is a renamed binding, not part of this list.
    const boundMethods = [
      "registerLayer",
      "unregisterLayer",
      "bringLayerToFront",
      "touchLayer",
      "setVisible",
      "getLayerType",
      "getLayersByType",
      "findLayer",
      "forEachLeaf",
      "extractPoints",
    ] as const;
    for (const name of boundMethods) {
      const method = this[name];
      Object.assign(this, { [name]: method.bind(this) });
    }
    this.isEnforcing = false;
    this.isDestroyed = false;

    this.panes = new PaneManager(this.map);
    this.surfaces = new Map();
    this.surfacesByLayer = new Map();
    this.intentStore = new LayerIntentStore();

    this.factory = new LayerFactory({
      map: this.map,
      panes: this.panes,
      registerLayer: this.registerLayer,
      unregisterLayer: this.unregisterLayer,
      bringLayerToFront: this.bringLayerToFront,
      invalidateType: id => this.invalidateType(id),
      // A canvas or color surface mounts its pane inside register() and needs
      // its slot's z at birth — no provisional bottom step the ordering pass
      // rewrites later. Index and size are stable by the time registerLayer
      // has inserted, so the lookup is exact.
      slotOf: id => {
        const layerInfo = this.layerRegistry.get(id);
        return layerInfo
          ? {
              index: this.layerRegistry.indexOf(layerInfo),
              count: this.layers.length,
              group: layerInfo.group,
            }
          : null;
      },
      // Runtime content changes (createLayers add/remove/clear) refresh the
      // count column live. No-op until a UI row subscribes.
      onDataChange: id => this.refreshCount(id),
    });

    this.ui = null;

    this.debouncedEnforce = debounce(() => {
      if (this.isDestroyed || !this.map?.getContainer()) return;
      this.enforceOrder();
    }, CONST.ENFORCE_ORDER_DEBOUNCE_MS);

    this.onLayerAdd = event => {
      if (
        this.isDestroyed ||
        event.layer === this.map ||
        event.layer instanceof L.Renderer
      ) {
        return;
      }

      // A layer's content can arrive at any time — a third party mutates a
      // registered group's tree, or folium's own script lands the leaves of a
      // registered container. Mark every surface dirty so the next ordering pass
      // reconciles it; there is no need to know which surface the new content
      // belongs to, which is what the old permanently-true flag used to
      // approximate (and got wrong: it kept the pass walking every tree on every
      // pass). The mark is synchronous because the probe path calls
      // `enforceOrder` directly, and a debounce-only trigger would miss it.
      for (const surface of this.surfaces.values()) surface.markContentDirty();
      if ((this.hasUnresolvedLayers() || this.surfaces.size > 0) && !this.isEnforcing) {
        this.debouncedEnforce();
      }
      // Late binding: folium emits a layer's JS global after this control's own
      // script, so the registry entry still reads `layer: null` when the real
      // object joins the map. That arrival is a map-membership change no
      // registry write emitted, so it gets its own LAYER_CHANGE here — without
      // it a consumer that only reads the bus (annotation repaints its labels)
      // would see a registered layer appear and never learn about it. Only
      // entries that had not resolved yet qualify, which also keeps a
      // registration-driven add to one emit: registerLayer's own `map.addLayer`
      // resolves through `opts.layer`, so its entry already carries the layer
      // by the time this handler runs.
      //
      // Emitting alone is not enough: the registry entry would keep reading
      // `layer: null` forever, and every downstream field derived from that
      // snapshot (`carrier.layer`, the pending `kind` for a tile basemap)
      // would stay stale — consumers that read the entry directly (the fill
      // swatch, maxZoom scanning) never see the resolved layer. Rebuild the
      // entry through the same edge as every other registration so `layer`,
      // `kind`, and `carrier` re-derive from the real object, and write it
      // back through `upsert` (in place: no reorder, no re-registration of
      // the caller's fields). `registeredAt` comes back through `existingLi`
      // so the first-registration timestamp is preserved.
      const stamp = L.stamp(event.layer);
      for (const layerInfo of this.layers) {
        if (layerInfo.layer) continue;
        const resolved = findLayer(this.map, layerInfo.id);
        if (resolved && L.stamp(resolved) === stamp) {
          const rebuilt = this.layerRegistry.createLayerInfo(
            { id: layerInfo.id, layer: resolved },
            layerInfo,
          );
          this.layerRegistry.upsert(rebuilt);
          const operation = this.beginOperation();
          this.emitLayerChange(layerInfo.id, rebuilt.kind, operation);
          operation.throwIfFailed();
          break;
        }
      }
    };
    this.map.on("layeradd", this.onLayerAdd);
    // The annotation manager plans each layer's labels on that layer's own
    // label pane — which is a declared `role: "annotation"` PaneSpec of the
    // layer's surface (see `withAnnotationSpec`), created and z-priced with
    // the rest of the face. The manager only mounts canvases into it; there
    // is no pane hook and no stored-intent replay to wire — the pane exists
    // before any intent can, so the executor's registration-pass write
    // already landed on it.
    this.annotation = new AnnotationManager({
      map: this.map,
      layerFind: this.findLayer,
    });
    this.domain = new LayerOrchestration({
      map: this.map,
      layerRegistry: this.layerRegistry,
      panes: this.panes,
      factory: this.factory,
      order: this.order,
      persistence: this.persistence,
      annotation: this.annotation,
      surfaces: this.surfaces,
      surfacesByLayer: this.surfacesByLayer,
      getIntentStore: () => this.intentStore,
    });
    this.getLayerPanes = layer => this.domain.resolveLayerPanes(layer);

    // Application tail — persisted order replay, group normalization, first
    // enforce, and the export-listener wiring. Runs after the assembly phase
    // above so `this.order` / `this.layerRegistry` / `this.factory` / `this.domain`
    // are all populated when these run.
    this.loadSavedOrder();
    this.layerRegistry.normalizeGroups();
    this.enforceOrder();
    // Before any export, flush pending debounced enforceOrder so the exported
    // image matches the panel's layer order.
    this.events.on(EVENTS.BEFORE_EXPORT, () => this.enforceOrder(), "internal");
    // Ensure the lightweight LayerAPI exists (consumers always have a valid
    // LayerAPI even without LayerControl), then upgrade to the full version.
    // LayerController itself implements LayerAPI, so it becomes the map's API.
    ensureLayerAPI(this.map);
    this.map.foliplus!.LayerAPI = this;
  }

  /** Ordered layers (read-only view; always reflects the registry). */
  get layers(): readonly LayerInfo[] {
    return this.layerRegistry.layers;
  }

  // LayerAPI contract: createLayers / createCanvas delegate to the factory.
  createLayers(opts: CreateLayersOpts): CreateLayersAPI {
    return this.factory.createLayers(opts);
  }

  createCanvas(opts: CreateCanvasOpts): CreateCanvasAPI {
    return this.factory.createCanvas(opts);
  }

  createColor(opts: CreateColorOpts): CreateColorAPI {
    return this.factory.createColor(opts);
  }

  /** True while any registered layer that *declares a Leaflet carrier* is
   *  still unresolved (`layer === null`).
   *
   *  Explicit no-carrier entries — `kind` canvas / solid / custom — are not
   *  "unresolved": they never had a layer to find. Narrowing this predicate
   *  stops those rows from keeping the folium-script-phase enforceOrder loop
   *  alive forever.
   *
   *  During the initial folium script phase any layeradd may make a registered
   *  layer resolvable, so unrelated adds must keep triggering enforceOrder. */
  private hasUnresolvedLayers(): boolean {
    return this.domain.hasUnresolvedLayers();
  }

  // Order-domain forwards (bodies live on `this.order` — see savedOrder.ts).
  loadSavedOrder() {
    this.order.loadSavedOrder();
  }

  saveOrder() {
    this.order.saveOrder();
  }

  replaySavedOrder(id?: string) {
    this.order.replaySavedOrder(id);
  }

  // ==================== Public API Methods ====================

  /** Get the geometry type of a registered layer.
   *  @param {string} id - Layer ID set when calling registerLayer().
   *  @returns {string|null} "point" | "line" | "polygon" | "base" | null
   *
   *  Snapshot contract: `layerInfo.type` is a snapshot of the surface's
   *  probe result and this method is its single writer. The controller never
   *  calls `getGeometryType` directly — that probe lives on the surface. */
  getLayerType(id: string): string | null {
    const layerInfo = this.layerRegistry.get(id);
    if (!layerInfo) return null;
    if (layerInfo.group === GROUP.BASE) {
      layerInfo.type = GROUP.BASE;
      return GROUP.BASE;
    }
    if (layerInfo.iconSvg) {
      layerInfo.type = GEOM_TYPE.CUSTOM;
      return GEOM_TYPE.CUSTOM;
    }
    const surface = this.surfaces.get(id);
    if (!surface) return layerInfo.type;
    const gtype = surface.geometryType();
    layerInfo.type = gtype;
    return gtype;
  }

  /** Drop a registered layer's cached geometry type. Both the surface's
   *  internal cache and the controller's snapshot are cleared; the next
   *  `getLayerType` re-probes through the surface. Unknown ids are no-ops. */
  invalidateType(id: string): void {
    this.surfaces.get(id)?.invalidate();
    const layerInfo = this.layerRegistry.get(id);
    if (layerInfo) layerInfo.type = null;
  }

  /**
   * Get all registered layers of a given geometry type.
   */
  getLayersByType(
    type: string,
  ): Array<{ id: string; name: string; layer: L.Layer | null }> {
    return this.layers
      .filter(l => this.getLayerType(l.id) === type)
      .map(l => ({ id: l.id, name: l.name, layer: this.findLayer(l) }));
  }

  /** Return the number of geometric features in a registered layer.
   *  Third-party provider wins (Canvas layers need this). Fallback uses walkLeaf.
   *  Returns null when the layer cannot be meaningfully counted (Canvas without
   *  provider, base tile layers, or unknown non-container layers).
   *  @param {string} id - Layer id.
   *  @returns {number|null} Feature count, or null when count is unavailable. */
  getFeatureCount(id: string): number | null {
    const layerInfo = this.layerRegistry.get(id);
    if (!layerInfo) return null;
    if (layerInfo.group === GROUP.BASE) return null;
    // 1. Third-party provider (Canvas layers must supply this).
    const provider = layerInfo.featureCountProvider;
    if (typeof provider === "function") {
      try {
        const v = provider();
        if (typeof v === "number") return v;
      } catch (err) {
        // Provider threw (e.g. canvas in a failing state). Log so the failure
        // is visible rather than silently returning a stale 0-count. For
        // Canvas/unknown layers the walkLeaf fallback is a no-op anyway
        // (returns null), so this is a defensive fallback, not a real path.
        this.log.error(`featureCountProvider threw for "${id}":`, err);
      }
    }
    // 2. Fallback via walkLeaf — only valid for feature containers.
    const layer = this.findLayer(layerInfo);
    if (!layer) return null;
    if (isGroupLike(layer)) return countFeatureGeometry(layer);
    // 3. Canvas or unknown non-container → no meaningful count.
    return null;
  }

  /** Notify subscribers that a layer's feature count may have changed.
   *  Public API for third-party providers (e.g. Canvas layers whose data
   *  updates independently of LayerController) to trigger an incremental
   *  panel refresh without a full re-render.  Publishes
   *  EVENTS.LAYER_ITEM_COUNT_CHANGE; LayerControl subscribes to it and
   *  refreshes the single affected row via onLayerItemCountChange.
   *  Base layers are suppressed (their counts are null anyway). Unknown ids
   *  are emitted defensively so the bus contract stays uniform; the
   *  subscriber simply finds no row to update and becomes a no-op.
   *
   *  Emit-only: geometry-type invalidation is the content-change path's job
   *  (LayerFactory invalidates on add/remove/clear). A caller that mutates
   *  geometry without going through the factory must invalidateType itself
   *  before emitting; the factory path stays single-invalidation.
   *  @param {string} id - Layer id. */
  refreshCount(id: string) {
    if (this.layerRegistry.get(id)?.group === GROUP.BASE) return;
    // Settled: one consumer throwing must not keep the other count listeners
    // (the row repaint, the fill ramp) from seeing the final geometry.
    publish(this.events, EVENTS.LAYER_ITEM_COUNT_CHANGE, { id });
  }

  findLayer(idOrInfo: string | LayerInfo): L.Layer | null {
    return this.domain.findLayer(idOrInfo);
  }

  forEachLeaf(id: string, fn: (layer: L.Layer) => void) {
    const layer = this.findLayer(id);
    if (layer) walkLeaf(layer, fn);
  }

  /**
   * Extract all point markers from a registered layer by id.
   * @param {string} id - Layer ID.
   */
  extractPoints(
    id: string,
  ): Array<{ lat: number; lng: number; marker: L.Marker | L.CircleMarker }> {
    const pts: Array<{ lat: number; lng: number; marker: L.Marker | L.CircleMarker }> =
      [];
    const seen = new Set();
    this.forEachLeaf(id, (l: L.Layer) => {
      if ((l as LabelAwareLayer).isLabel) return;
      if (!(l instanceof L.Marker || l instanceof L.CircleMarker)) return;
      if (!l.feature) return;
      const stamp = L.stamp(l);
      if (seen.has(stamp)) return;
      seen.add(stamp);
      const ll = l.getLatLng();
      pts.push({ lat: ll.lat, lng: ll.lng, marker: l });
    });
    return pts;
  }

  /** Broadcast a layer's registry / map-membership change with the id and kind
   *  stamped from the registry entry — LayerController's single emit site, so
   *  every subscriber can filter on the payload instead of re-walking the
   *  registry. Covers register / unregister / reorder / visibility toggle /
   *  late re-attachment: those are all "the map now shows a different set of
   *  layers", which is what the annotation manager repaints on.
   *
   *  Always routed through the caller's operation: this event has the same
   *  settled fan-out whichever lifecycle entry produced it, so a consumer
   *  cannot truncate the rest of a register/unregister/reorder by throwing. */
  private emitLayerChange(
    id: string,
    kind: LayerKind,
    operation: SettledOperation,
  ): void {
    operation.emitSuperseding(EVENTS.LAYER_CHANGE, id, { id, kind });
  }

  /** Start one settled fan-out for a lifecycle operation. Queue every event the
   *  operation owes, keep local mutations outside the queue, and raise the
   *  first consumer failure once the whole operation has been attempted. */
  private beginOperation(): SettledOperation {
    return new SettledOperation(this.events);
  }

  registerLayer(opts: RegisterLayerOpts): HTMLElement | null {
    if (!opts?.id) throw new Error(this.log.msg(this.T("id_required")));

    // A deleted layer is refused, not erased: the id has left the registry for
    // good, so accepting it again would silently undo the user's delete. Null
    // (not an exception) keeps the caller's rebuild loop alive — throwing here
    // would take down whatever was registering. Interim behavior: the
    // reason is logged rather than returned, until registerLayer grows a
    // RegisterResult union that names "removed".
    if (this.order.removedIds.has(opts.id)) {
      this.log.warn(
        `registerLayer: refusing "${opts.id}" — the layer was deleted by the ` +
          `user and the deletion is persisted for this map`,
      );
      return null;
    }

    // A layer's group is its role for the id's whole lifetime — it picks the
    // z ladder, the attribution and basemap semantics, and which panel
    // section owns the row. Re-registering with a different group would be a
    // role change, which no code path models: the in-place upsert would
    // strand the row in the old section with a stale section boundary
    // (firstBaseIdx) and a partition invariant broken. Refuse before any
    // mutation — unregister first if the role really must change.
    const existingRole = this.layerRegistry.get(opts.id);
    if (existingRole && opts.group !== undefined && opts.group !== existingRole.group) {
      throw new Error(
        this.log.msg(
          `registerLayer: "${opts.id}" is registered as ${existingRole.group}; ` +
            `re-registering with group "${opts.group}" is a role change. ` +
            `Unregister the layer first, or register it under a new id.`,
        ),
      );
    }

    const { layerInfo, existingIdx, hidden } = this.domain.registerEntry(
      opts,
      Boolean(this.ui),
    );

    // If the layer was previously hidden by the user, keep it off the map on
    // re-entry so it isn't silently re-added by runtime re-registration. A
    // canvas-only hidden layer (no Leaflet layer, HIDDEN class carrier) is
    // handled by `applyUserState` further below, which re-projects the hidden
    // intent and writes the carrier through the executor's single write path.
    if (!hidden && opts.layer && !this.map.hasLayer(opts.layer)) {
      this.map.addLayer(opts.layer);
    }

    const container = this.uiContainer;
    if (!container) {
      this.pendingRegistrations.push(layerInfo);
      this.debouncedEnforce();
      return null;
    }

    const operation = this.beginOperation();
    if (this.ui) {
      if (existingIdx === -1) {
        // New row: the row is inserted by the LAYER_ITEM_ADDED listener; the
        // stored-state projection is left to the single applyUserState below,
        // so the registration entry holds the delta and can announce it after
        // the row, the count and the order are all settled.
        operation.emit(EVENTS.LAYER_ITEM_ADDED, { id: opts.id });
      } else {
        // Re-registration is how the API says "this layer's content changed",
        // so the row's cached field list and resolved auto field are both stale.
        operation.emit(EVENTS.LAYER_ITEM_UPDATED, { id: opts.id });
      }
      // A stored dimension must be replayed on first registration too. Heatmap
      // and Measure register after LayerControl has attached, so this is the only
      // pass that reaches a late-arriving layer's own visibility, opacity, name
      // and order. On a re-registration it also re-applies opacity onto the fresh
      // layer/canvas object (no-op when the user never changed it).
      const moved = this.ui.applyUserState(opts.id);
      // Incremental: refresh only the new/updated row's cells instead of
      // re-scanning every row (initTypesAndVisibility is a full pass used on
      // attach/fold). Fires after applyUserState so the row reflects the fresh
      // map state.
      operation.emit(EVENTS.LAYER_ITEM_REFRESHED, { id: opts.id });
      operation.emit(EVENTS.LAYER_GROUP_COUNT_CHANGED, {
        group: layerInfo.group,
      });
      // Defer z-order enforcement so batch registration coalesces into one pass.
      this.debouncedEnforce();
      // The round goes out last — after the row insert, the count sync and the
      // order replay — so a subscriber that re-enters reads the settled panel:
      // full group count, correct row state. The batch carries the entry it ran
      // against, so a retire inside that notify cannot announce for a
      // replacement holding the same id.
      collectDeltas(this.ui, moved, operation);

      // A subscriber can retire the entry inside that notify: a destroy takes
      // the container and the registry with it, and an unregister leaves the id
      // mapped to a different instance. Either way this registration is over —
      // the registration CHANGE would announce for an entry that no longer
      // exists, and the row lookup below would deref a null container.
      if (this.isRetired(opts.id, layerInfo)) {
        operation.throwIfFailed();
        return null;
      }
    }
    // Registration never writes the saved order: the slot this layer just took
    // is where attach timing put it, not a user arrangement. Only an explicit
    // user reorder (drag, moveLayerUp/Down, bringLayerToFront) snapshots the
    // live order. A layer the user *did* arrange still replays here through
    // insertOverlayAt / applyUserState above.
    this.emitLayerChange(opts.id, layerInfo.kind, operation);
    // The registration CHANGE can retire this registration the same way the
    // projection notify above can: a destroy takes the container and the
    // registry with it, an unregister or a re-registration with the same id
    // leaves the id mapped to a different instance. The retirement is re-checked
    // after that notify rather than cached before it — a cached node would be
    // handed back after the entry that produced it is gone, and a re-lookup
    // would return another instance's row for the same id.
    if (this.isRetired(opts.id, layerInfo)) {
      operation.throwIfFailed();
      return null;
    }
    // The row lookup uses the container captured before any notify. A teardown
    // in the notify above empties that node's content (`destroy` clears
    // innerHTML), so the lookup returns null the same way a re-read would —
    // without needing a branch that can never be taken.
    operation.throwIfFailed();
    return container.querySelector(`[${CONST.DATA.LAYER_ID}="${CSS.escape(opts.id)}"]`);
  }

  /** Whether the entry a notify was announcing for is gone: the control was
   *  destroyed, the layer was unregistered, or the id now maps to a
   *  replacement. Every entry that keeps working after its own notify asks
   *  this one question, in one place. */
  private isRetired(id: string, entry: LayerInfo): boolean {
    return this.isDestroyed || this.layerRegistry.get(id) !== entry;
  }

  /** The one reorder commit path — registry move, z repricing, persistence,
   *  the panel-order signal and the announcement, in that order, inside one
   *  settled operation. moveLayerUp / moveLayerDown / bringLayerToFront and
   *  the drag drop all funnel through here: each entry resolves the user's
   *  intent into a registry mutation and a no-op verdict, and this method
   *  owns every contract the entrances must share — the event pair, the
   *  identity retirement gate and the exception policy.
   *
   *  `mutate` runs before the operation opens, exactly as the entrances did
   *  on their own: the registry move is a local commit, not a side effect a
   *  subscriber can veto, and a throwing consumer must not find the saved
   *  order disagreeing with the live one. */
  private commitReorder(id: string, item: LayerInfo, mutate: () => void): boolean {
    mutate();
    this.enforceOrder();
    this.saveOrder();
    const operation = this.beginOperation();
    if (this.uiContainer && this.ui) {
      operation.emit(EVENTS.LAYER_LIST_REBUILD);
    }
    // The panel sync above is this operation's own side effect, so it lands
    // before the notify: a subscriber reading the row order out of the panel
    // during the CHANGE sees the arrangement that was just made. That same
    // fan-out is where a subscriber can retire what the move announces for —
    // destroying the control or unregistering the layer — so the entry is
    // re-read rather than reused: a swap under the same id would otherwise
    // be announced on top of the arrangement it just rendered. A controller
    // with no panel never synced anything and announces as usual.
    if (this.isRetired(id, item)) {
      operation.throwIfFailed();
      return true;
    }
    this.emitLayerChange(id, item.kind, operation);
    operation.throwIfFailed();
    return true;
  }

  /**
   * Bring a registered layer to the front (top of z-order).
   * @param {string} id - Layer ID previously passed to registerLayer().
   */
  bringLayerToFront(id: string) {
    const item = this.layerRegistry.get(id);
    if (!item) return;
    const idx = this.layerRegistry.indexOf(item);
    if (idx <= 0) return;
    if (item?.group === GROUP.BASE) return;
    this.commitReorder(id, item, () => this.layerRegistry.moveToFront(id));
  }

  /**
   * Land a dragged layer at another layer's slot — the drag-drop counterpart
   * of the move APIs, funneled through the same commit path so a drag
   * publishes the same panel-order signal and layer CHANGE a keyboard or API
   * move does. Both ids are resolved at commit time, not when the gesture
   * started: the armed drag keeps the layer's identity, and the registry is
   * re-read here so an intervening reorder moves what the user actually
   * grabbed.
   * @param {string} id - The dragged layer's ID.
   * @param {string} targetId - The layer whose slot the drop names.
   * @returns {boolean} true if the layer moved, false when either id is
   *   gone, the slots coincide, or the group boundary refuses the move —
   *   always without side effects on false.
   */
  reorderLayer(id: string, targetId: string): boolean {
    const item = this.layerRegistry.get(id);
    const target = this.layerRegistry.get(targetId);
    if (!item || !target) return false;
    const from = this.layerRegistry.indexOf(item);
    const to = this.layerRegistry.indexOf(target);
    // Same slot is a self-drop; any other pairing crosses the group gate,
    // which also owns the bounds check, below.
    if (from === to) return false;
    if (!this.canReorderBetween(from, to)) return false;
    return this.commitReorder(id, item, () => this.layerRegistry.reorder(from, to));
  }

  /** Stamp `updatedAt` to now — call after a runtime mutation that does not
   *  re-register (heatmap field change, measure add/edit/remove). */
  touchLayer(id: string): boolean {
    return this.layerRegistry.touch(id);
  }

  /**
   * Set a layer's visibility from outside the panel — the same transition the
   * checkbox performs, including the persisted hidden set, so the choice
   * survives a reload the way a user toggle does.
   *
   * Base layers behave like overlays here: folium paints them as direct map
   * children (`Layer.render` emits `addTo(map)`, with no per-base group
   * wrapper), so hiding one removes it from the map. Neither this path nor the
   * checkbox applies the "only one base at a time" rule — that is decided by
   * the map's base-layer control, not by LayerControl.
   *
   * @param {string} id - Layer ID previously passed to registerLayer().
   * @param {boolean} visible - Show the layer, or hide it.
   * @returns {boolean} true if the layer was found and its visibility was set.
   */
  setVisible(id: string, visible: boolean): boolean {
    // Resolve the id up front so an unknown layer is reported the same whether
    // or not a panel is attached — a caller must not be told a hide succeeded
    // for an id that never existed.
    if (!this.layerRegistry.has(id)) return false;
    if (!this.ui) {
      // No panel means no row to sync and no hidden-set funnel to write. The
      // hidden set lives on LayerUI, so a success here would be a state change
      // the panel can never show — and `destroy()` clears the registry too, so
      // there is no later attach to replay it. Refuse instead of no-op-ing, or
      // the caller cannot tell a no-panel call from a real hide.
      this.log.warn("setVisible called before the panel is attached; no-op");
      return false;
    }
    return this.ui.applyVisibility(id, visible);
  }

  /**
   * The user's stored visibility choice for a layer id: the persisted intent
   * when the user has set it, else the author's declared default.
   *
   * The panel checkbox reads this; the map reflects the projection's
   * `effectiveShown` (intent ∧ policy), which a policy may suppress below
   * what the intent allows. Callers that want "is it drawn right now" ask
   * the map directly — `map.hasLayer`, `LayerAPI.getLayersByType`, etc.
   *
   * Returns `true` for an unknown id or a pre-attach call — the author's
   * declared default stands until someone records a choice — so a caller
   * that only wants the boolean doesn't have to branch on null.
   */
  intentVisible(id: string): boolean {
    if (!this.layerRegistry.has(id)) return true;
    if (!this.ui) return true;
    return this.ui.intentVisible(id);
  }

  /**
   * Unregister and remove a layer from the map and panel.
   *
   * Generic teardown only — it never touches persisted user state. A layer
   * unregistering itself may simply be temporarily empty: HeatmapControl
   * unregisters its canvas when the data goes empty, and nothing about that
   * says the user's stored opacity, zoom range, or hidden state is wanted
   * back at the author default. Erasing stored state is an explicit user
   * action, and it has its own entry point: {@link deleteLayer}.
   *
   * @param {string} id - The layer ID previously passed to registerLayer().
   * @returns {boolean} true if layer was found and removed, false otherwise.
   */
  unregisterLayer(id: string): boolean {
    const retired = this.retireEntry(id);
    if (!retired) return false;

    const operation = this.beginOperation();
    // Flush before any fan-out: the registry is already updated, and a
    // throwing consumer must not leave the persisted order listing the id.
    this.persistence.flushAll();
    this.announceRetirement(retired.layerInfo, operation);
    operation.throwIfFailed();
    return true;
  }

  /** Local teardown of one registry entry: registry, map, panel row, and
   *  annotation rendering. No bus event — the caller (generic unregister, user
   *  delete, component clear) owns the operation that announces the removal,
   *  so its local commits can finish before any consumer can throw. */
  private retireEntry(id: string): { layerInfo: LayerInfo } | null {
    const { layerInfo, layer } = this.domain.unregisterEntry(id);
    if (!layerInfo) return null;

    if (layer) {
      if (this.map.hasLayer(layer)) this.map.removeLayer(layer);
      this.clearAllLayers(layer);
    }

    // A drag armed with the retiring entry has no future: the source row is
    // about to leave the panel, and a native dragend off a detached source
    // cannot be relied on to bubble back. Cancel the gesture now instead of
    // leaving the session and its chrome for the next dragover to find.
    if (this.ui?.listPanel?.dragEntry === layerInfo) clearDragState(this.ui);

    if (this.uiContainer) {
      const target = this.uiContainer.querySelector(
        `[${CONST.DATA.LAYER_ID}="${CSS.escape(id)}"]`,
      );
      if (target) {
        // Finalise an in-flight user edit before its panel leaves the DOM: the
        // drag value is the user's, not teardown state.
        finishSlidersIn(target);
        // Capture the cursor by identity before the row leaves the list: the
        // removal shifts every later row's index, and the ledger must follow
        // the row it described, not the position. Removing the active row
        // itself clears the cursor and hands the tab stop to the first
        // visible row — the roving contract never lapses.
        const ref = this.ui?.listPanel ? cursorRef(this.ui) : null;
        target.remove();
        // Check if the group is now empty and remove the toggle-all row if so.
        const group = layerInfo.group;
        const anchorSel =
          group === GROUP.BASE
            ? `${CONST.SEL.LAYER_ITEM}[data-layer-type="${GROUP.BASE}"]:not([${CONST.DATA.LAYER_ID}="${CONST.SOLID_BASEMAP_ID}"])`
            : `${CONST.SEL.LAYER_ITEM}:not([data-layer-type="${GROUP.BASE}"])`;
        if (!this.uiContainer.querySelector(anchorSel)) {
          this.uiContainer
            .querySelector(`.${CONST.CLASSES.TOGGLE_ALL}[data-group="${group}"]`)
            ?.remove();
        }
        if (this.ui?.listPanel) reconcileCursorByIdentity(this.ui, ref);
      }
    }
    // Nothing below writes persisted state — see the method's doc. The rename
    // and the per-layer intent both survive this teardown, so a component that
    // unregisters an empty layer and registers it again comes back with the
    // name and the settings the user chose.
    // Tear down the annotation RENDERING state; the label config stays —
    // it is part of that surviving intent (a flush after this point must
    // not erase `layers[id].annotation` from storage).
    this.annotation.unloadLayer(id);
    return { layerInfo };
  }

  /** Queue the signals one retirement owes, in their established order.
   *  LAYER_CHANGE lands first for consumers that drop the layer off their own
   *  list; LAYER_REMOVED is the teardown signal itself. A user delete routes
   *  through deleteLayer, which owns the same retirement plus the permanent
   *  prune; component-owned clears emit LAYER_DELETED instead.
   *
   *  Every remaining event is gated on the operation's entry identity. A
   *  subscriber can re-register the same id inside an earlier event (most
   *  naturally inside this CHANGE), and can even unregister that replacement
   *  again before the fan-out ends — existence alone cannot tell the old
   *  operation that its retirement was consumed. So `replaced` is marked by
   *  any ITEM_ADDED / ITEM_UPDATED for this id *and* by a live different
   *  entry between events; once marked, no remaining retirement event fires —
   *  `LAYER_REMOVED` in particular promises "this entry left the registry"
   *  and must not be repeated for an id that was re-registered in between.
   *  Returns whether the full retirement was announced (used to gate the
   *  caller's post-announcement housekeeping). */
  private announceRetirement(
    layerInfo: LayerInfo,
    operation: SettledOperation,
  ): boolean {
    const id = layerInfo.id;
    let replaced = false;
    const mark = (payload: { id: string }): void => {
      if (payload.id === id) replaced = true;
    };
    const offAdded = this.events.on(EVENTS.LAYER_ITEM_ADDED, mark, "internal");
    const offUpdated = this.events.on(EVENTS.LAYER_ITEM_UPDATED, mark, "internal");
    try {
      const gate = (): boolean => {
        const current = this.layerRegistry.get(id);
        if (current !== undefined && current !== layerInfo) replaced = true;
        return !replaced && this.layerRegistry.get(id) === undefined;
      };
      // No gate before the first event: retireEntry just removed the entry and
      // nothing has had a chance to re-register it yet. Every subsequent event
      // is gated.
      operation.emit(EVENTS.LAYER_ITEM_REMOVED, { id });
      if (!gate()) return false;
      // The row was just removed: rescan the group's count so the toggle-all
      // checkbox reflects the removal in the same frame.
      operation.emit(EVENTS.LAYER_GROUP_COUNT_CHANGED, {
        group: layerInfo.group,
      });
      if (!gate()) return false;
      this.emitLayerChange(id, layerInfo.kind, operation);
      if (!gate()) return false;
      operation.emit(EVENTS.LAYER_REMOVED, { id });
      return true;
    } finally {
      offAdded();
      offUpdated();
    }
  }

  /**
   * Delete a layer: two semantics, dispatched by layer ownership.
   *
   * Component-owned layers (Measure, Heatmap) clear their data — no id is
   * recorded in `removed`, so the component can re-register after redraw.
   * The event bus carries the notification; the component owns the wipe.
   *
   * User-added layers are deleted for good: the id is added to `removed` so
   * the registry refuses it again, and the three sections that key by layer
   * id — order, the rename, the annotation config — are pruned. Only a user
   * who pointed at a row and chose "delete" knows the layer is gone for
   * good; per-dimension resets drop one provenance marker instead, which is
   * the same guarantee at the dimension level. Deletion is one level deeper
   * still — nothing about generic teardown can say the id is retired.
   *
   * Everything pruned here is scheduled on the one shared debounce, so the
   * whole record — removed, order, annotations, names, per-layer intent — leaves
   * in a single flush rather than in one write per dimension.
   *
   * @param {string} id - The layer ID previously passed to registerLayer().
   * @returns {boolean} true if the layer existed, false otherwise.
   */
  deleteLayer(id: string): boolean {
    const layerInfo = this.layerRegistry.get(id);
    if (!layerInfo) return false;

    // Component-owned layers clear their data instead of being retired —
    // MeasureControl and HeatmapControl still own a live handle and need the
    // id to stay registerable for the next draw.
    if (layerInfo.styleSetters) {
      const operation = this.beginOperation();
      // The component's LAYER_DELETED handler wipes its own canvas and its own
      // saved config, and LayerControl prunes what it owns below. Both halves
      // of a clear must erase, or the next draw inherits the half nobody
      // pruned. The operation collects the handler failures, so the cleanup
      // still runs even when an earlier consumer throws.
      operation.emit(EVENTS.LAYER_DELETED, { id });
      const { orderDropped, intentDropped } = this.domain.deleteEntry(id);
      if (this.ui && (orderDropped || intentDropped)) this.ui.saveState();
      this.persistence.flushAll();
      operation.throwIfFailed();
      return true;
    }

    // The color basemap is also component-owned: clearing it unregisters the
    // surface and resets the fill state so the map returns to the grid empty
    // state. The id stays registerable so the color can be re-picked.
    if (id === CONST.SOLID_BASEMAP_ID) {
      const retired = this.retireEntry(id);
      if (!retired) return false;
      const operation = this.beginOperation();
      this.persistence.flushAll();
      const announced = this.announceRetirement(retired.layerInfo, operation);
      if (this.ui && announced) {
        this.ui.resetSolidBasemap();
        operation.emit(EVENTS.LAYER_GROUP_COUNT_CHANGED, {
          group: GROUP.BASE,
        });
        operation.emit(EVENTS.LAYER_NO_BASEMAP_CHANGED);
      }
      this.persistence.flushAll();
      operation.throwIfFailed();
      return true;
    }

    const retired = this.retireEntry(id);
    if (!retired) return false;

    // User delete commits every persistent effect before the public fan-out:
    // once the registry entry is gone a retry cannot re-run the prune, so a
    // throwing consumer must never leave the delete half-applied. The events
    // are queued afterwards and all of them are attempted.
    this.order.removedIds.add(id);
    this.persistence.schedule({ removed: () => [...this.order.removedIds] });
    // retireEntry keeps the label config (a teardown is not a delete); this is
    // the delete, so forget it here — `configEntries` must stop answering for
    // a removed id.
    this.annotation.destroyLayer(id);

    // Drop every persisted value for this id (stored order + per-layer intent
    // + name rider) through the domain. `saveState` / `saveNamesState` are
    // called only when something actually dropped, so a delete of an untuned
    // layer no longer rewrites the whole `layers` map.
    //
    // The label config needs no schedule here: it rides `layers[id]`
    // (the live config is gone via `annotation.destroyLayer` above), and the
    // legacy `annotations` segment is pruned on READ for ids in `removed`
    // (parseRecord), so a v2 entry cannot resurrect behind the new key's
    // absence.
    const { orderDropped, intentDropped, nameCleared } = this.domain.deleteEntry(id, {
      clearName: true,
    });

    if (this.ui) {
      if (orderDropped || intentDropped) this.ui.saveState();
      if (nameCleared) this.ui.saveNamesState();
    }
    this.persistence.flushAll();

    const operation = this.beginOperation();
    const announced = this.announceRetirement(retired.layerInfo, operation);
    if (this.ui && announced) {
      operation.emit(EVENTS.LAYER_GROUP_COUNT_CHANGED, {
        group: retired.layerInfo.group,
      });
      operation.emit(EVENTS.LAYER_NO_BASEMAP_CHANGED);
    }
    operation.throwIfFailed();
    return true;
  }

  /**
   * Drop one id from the stored order without retiring the layer (LayerAPI
   * contract; body on {@link LayerOrder}). Component clear paths use it so a
   * redraw lands at the top of the stack; `deleteLayer` reuses the same prune
   * and is the only caller that also records `removedIds`.
   *
   * @param id - The layer ID whose stored position is being dropped.
   * @returns true if the id was in the stored order and got removed, false
   *   otherwise (nothing to forget).
   */
  forgetSavedOrder(id: string): boolean {
    return this.order.forgetSavedOrder(id);
  }

  /**
   * Drop every persisted user value for one id — the intent row (visibility,
   * opacity, zoom range) with its provenance, plus the stored order slot —
   * without retiring the layer. The id stays registerable, and the registry
   * entry and annotation config are left alone.
   *
   * `deleteLayer` composes the same two prunes for the layers it does retire,
   * and the component-owned branch of `deleteLayer` calls this straight, so
   * the panel Clear button and the overflow Clear Data erase the same thing:
   * a component that clears its own data must not hand the next draw the
   * tuning the user arranged for the previous one.
   *
   * Deliberately no `flushAll` and no `annotation.destroyLayer` — the caller
   * owns persistence timing, and the id is stable across draws, so the
   * annotation config and any user rename still describe the same thing.
   *
   * @param id - The layer ID whose persisted state is being dropped.
   * @returns true if persisted state was dropped, false when nothing was
   *   stored for this id (nothing to erase is not an error).
   */
  dropPersistedLayerState(id: string): boolean {
    const orderDropped = this.order.forgetSavedOrder(id);
    const intentDropped = this.ui ? this.ui.dropPersistedLayerState(id) : false;
    if (this.ui && (orderDropped || intentDropped)) this.ui.saveState();
    return orderDropped || intentDropped;
  }

  /** Recursively clear every child of a layer. Kept as a hand-written recursion
   *  (not `walkLeaf` + per-leaf teardown) because `LayerGroup.clearLayers()`
   *  is Leaflet's atomic teardown — it unregisters map targets, detaches event
   *  listeners, and fires `remove` events — while `walkLeaf` is a pure
   *  enumeration that has no teardown semantics. Delegating the fast path to
   *  `clearLayers()` and only recursing through `eachLayer` for exotic
   *  containers keeps the two semantics distinct. */
  clearAllLayers(layer: L.Layer | null) {
    if (!layer) return;
    if (
      "clearLayers" in layer &&
      typeof (layer as L.LayerGroup).clearLayers === "function"
    ) {
      (layer as L.LayerGroup).clearLayers();
    } else if (
      "eachLayer" in layer &&
      typeof (layer as L.LayerGroup).eachLayer === "function"
    ) {
      (layer as L.LayerGroup).eachLayer(c => this.clearAllLayers(c));
    }
  }

  /** Thin forwarder only — gathers the args and hands the z arithmetic to
   *  `core/layer/z.zFor`. There is no second z-semantics here: the z-space
   *  is defined in `z.ts`, not in this file. Since R9 production code calls
   *  `zFor` directly, but this wrapper stays because LayerController is the
   *  LayerAPI entry point — removing it would break the contract. Tests and
   *  probes may still call it. Do not grow this into real logic. */
  computeZIndex(i: number, group: "base" | "overlay"): number {
    return zFor({ index: i, count: this.layers.length, group });
  }

  /** The surface for a registry entry, built on first use. Registration builds
   *  it explicitly (see registerLayer); this lazy path is for the entries that
   *  never go through `registerLayer` — folium adds its own layers, so the
   *  registry knows them only as unresolved ids and the ordering pass is where
   *  they first get a rendering face. */
  surfaceFor(layerInfo: LayerInfo): LayerSurface {
    return this.domain.surfaceFor(layerInfo);
  }

  /** Give every layer a surface and reprice its z.
   *
   *  Re-ordering only. The pass lives on the domain; the controller keeps the
   *  re-entry guard and the debounce cancellation around it. */
  enforceOrder() {
    if (this.isEnforcing) return;
    this.debouncedEnforce?.cancel();
    this.isEnforcing = true;
    try {
      this.domain.enforceOrder();
      this.syncAttribution();
    } finally {
      this.isEnforcing = false;
    }
  }

  desiredAttribution(): string {
    return this.domain.desiredAttribution();
  }

  syncAttribution() {
    this.domain.syncAttribution();
  }

  attachUI(containerDiv: HTMLElement) {
    if (this.ui) this.ui.attachUI(containerDiv);
  }

  canReorderBetween(fromIdx: number, toIdx: number): boolean {
    return this.domain.canReorderBetween(fromIdx, toIdx);
  }

  /**
   * Move a registered layer one position up in z-order (toward index 0).
   * Respects group boundaries (overlay to base never crosses).
   * @param {string} id - Layer ID previously passed to registerLayer().
   * @returns {boolean} true if the layer was moved, false if already at top,
   *   at the base boundary, or unknown.
   */
  moveLayerUp(id: string): boolean {
    const item = this.layerRegistry.get(id);
    if (!item) return false;
    const idx = this.layerRegistry.indexOf(item);
    if (idx <= 0) return false;
    if (!this.canReorderBetween(idx, idx - 1)) return false;

    return this.commitReorder(id, item, () => this.layerRegistry.reorder(idx, idx - 1));
  }

  /**
   * Move a registered layer one position down in z-order (away from index 0).
   * Respects group boundaries (overlay to base never crosses).
   * @param {string} id - Layer ID previously passed to registerLayer().
   * @returns {boolean} true if the layer was moved, false if already at bottom
   *   of its group or unknown.
   */
  moveLayerDown(id: string): boolean {
    const item = this.layerRegistry.get(id);
    if (!item) return false;
    const idx = this.layerRegistry.indexOf(item);
    if (idx < 0 || idx >= this.layers.length - 1) return false;
    if (!this.canReorderBetween(idx, idx + 1)) return false;

    return this.commitReorder(id, item, () => this.layerRegistry.reorder(idx, idx + 1));
  }

  destroy() {
    this.isDestroyed = true;
    if (this.map && this.onLayerAdd) this.map.off("layeradd", this.onLayerAdd);
    if (this.debouncedEnforce) this.debouncedEnforce.cancel();
    // Flush before destroy: the writes are debounced at 100ms, wide enough for
    // the control to be removed before the timer fires. unbindEvents also
    // flushes, but it only runs when a panel is attached.
    this.persistence.flushAll();
    this.annotation.destroy();
    if (this.ui) {
      this.ui.unbindEvents();
      this.ui = null;
    }
    this.persistence.destroy();
    if (this.uiContainer) {
      this.uiContainer.innerHTML = "";
      this.uiContainer = null;
    }
    this.layerRegistry.clear();
    this.pendingRegistrations = [];
    this.surfaces.clear();
    this.surfacesByLayer.clear();
    this.panes.destroy();
    // Revert to the lightweight LayerAPI (no registry, no panel).
    // ensureLayerAPI guarantees a valid object, so consumers can always
    // call `map.foliplus.LayerAPI.xxx` without null checks.
    // `force` is required: without it the existing (destroyed) manager would
    // short-circuit the stub replacement and stay live on the map.
    ensureLayerAPI(this.map, true);
  }
}

export { LayerController, installBringToFrontPatch, uninstallBringToFrontPatch };
