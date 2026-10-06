import { EVENTS, type EventBus, ensureEvents } from "#core/event/index.js";
import { ensureLayerAPI } from "#core/layer/api.js";
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
  findLayer,
  walkLeaf,
  zFor,
} from "#core/layer/index.js";
import { hasAttachedPath, isGroupLike } from "#core/leafletAdapter.js";
import { debounce } from "#common/debounce.js";
import type { Debounced } from "#common/debounce.js";
import { createLogger } from "#common/log.js";
import type { Logger } from "#common/type.js";
import { AnnotationManager } from "./annotation/index.js";
import * as CONST from "./const.js";
import { LayerOrchestration } from "./domain.js";
import { LayerIntentStore } from "./domain/LayerIntentStore.js";
import { LayerPersistence } from "./persistence.js";
import { LayerUI } from "./ui/index.js";

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
//             syncAttribution, attachUI, destroy, canReorderBetween,
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
  layerRegistry: LayerInfoRegistry;
  pendingRegistrations: LayerInfo[];
  uiContainer: HTMLElement | null;
  isEnforcing: boolean;
  isDestroyed: boolean;
  panes: PaneManager;
  /** The rendering face of each registered layer, keyed by layer id. Created on
   *  registration (and materialized before the layer joins the map) and dropped
   *  on unregistration — it is the replacement for the stamp-keyed fallback
   *  pane map and the per-layer `options.paneSet` "already moved" flag. */
  surfaces: Map<string, LayerSurface>;
  /** The same surfaces keyed by the live layer's stamp, for the lookups that
   *  start from a layer rather than from a registry entry. */
  private surfacesByLayer: Map<number, LayerSurface>;
  factory: LayerFactory;
  lastAttribution: string | null;
  ui: LayerUI | null;
  debouncedEnforce: Debounced;
  persistence: LayerPersistence;
  /** User-arranged order + one-way deleted-id set. Owns `savedOrder` /
   *  `removedIds` and the load / snapshot / replay / prune methods; the
   *  controller forwards the public face and keeps the ownership call-sites
   *  (register gate, delete mark). */
  order: LayerOrder;
  annotation: AnnotationManager;
  domain: LayerOrchestration;
  /** Per-layer intent store — domain-owned (#620 follow-up), exposed on
   *  LayerUI as a read-only getter. Read via `this.intentStore` internally
   *  (register gate, deleteLayer) and via `ui.intentStore` externally. */
  intentStore: LayerIntentStore;
  onLayerAdd: (event: L.LeafletEvent) => void;
  getLayerPanes: (layer: L.Layer) => string[];
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
      data.filter(li => {
        if (!removedIds.has(li.id)) return true;
        // Late-binding fallback (folium script-stream order) — same single
        // point as `findLayer` / ExportControl's `resolveLayer`.
        const layer = li.layer ?? findLayer(this.map, li.id);
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

    this.panes = new PaneManager(mapInstance);
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
        const li = this.layerRegistry.get(id);
        return li
          ? {
              index: this.layerRegistry.indexOf(li),
              count: this.layers.length,
              group: li.group,
            }
          : null;
      },
      // Runtime content changes (createLayers add/remove/clear) refresh the
      // count column live. No-op until a UI row subscribes.
      onDataChange: id => this.refreshCount(id),
    });

    this.lastAttribution = null;
    this.ui = null;

    this.debouncedEnforce = debounce(() => {
      if (this.isDestroyed || !this.map || !this.map.getContainer()) return;
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
      const stamp = L.stamp(event.layer);
      for (const li of this.layers) {
        if (li.layer) continue;
        const resolved = findLayer(this.map, li.id);
        if (resolved && L.stamp(resolved) === stamp) {
          this.emitLayerChange(li.id, li.kind);
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
      events: this.events,
      layerRegistry: this.layerRegistry,
      panes: this.panes,
      factory: this.factory,
      order: this.order,
      persistence: this.persistence,
      annotation: this.annotation,
      surfaces: this.surfaces,
      surfacesByLayer: this.surfacesByLayer,
      lastAttribution: this.lastAttribution,
      getIntentStore: () => this.intentStore,
    });
    this.getLayerPanes = layer => this.domain.resolveLayerPanes(layer);
    this.loadSavedOrder();
    this.layerRegistry.normalizeGroups();
    this.enforceOrder();

    // Before any export, flush pending debounced enforceOrder so the
    // exported image matches the panel's layer order.
    this.events.on(EVENTS.BEFORE_EXPORT, () => this.enforceOrder());

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
    this.events.emit(EVENTS.LAYER_ITEM_COUNT_CHANGE, { id });
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
   *  layers", which is what the annotation manager repaints on. */
  private emitLayerChange(id: string, kind: LayerKind): void {
    this.domain.emitLayerChange(id, kind);
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

    if (!this.uiContainer) {
      this.pendingRegistrations.push(layerInfo);
      this.debouncedEnforce();
      return null;
    }

    if (this.ui) {
      if (existingIdx === -1) {
        // New row: the UI inserts the DOM row. insertLayerItem internally
        // runs applyUserState for this id, so the controller-level applyUserState
        // below is a no-op on the new-row path (idempotent) and only carries
        // meaning on the re-registration branch.
        this.events.emit(EVENTS.LAYER_ITEM_ADDED, { id: opts.id });
      } else {
        // Re-registration is how the API says "this layer's content changed",
        // so the row's cached field list and resolved auto field are both stale.
        this.events.emit(EVENTS.LAYER_ITEM_UPDATED, { id: opts.id });
      }
      // A stored dimension must be replayed on first registration too. Heatmap
      // and Measure register after LayerControl has attached, so this is the only
      // pass that reaches a late-arriving layer's own visibility, opacity, name
      // and order. On a re-registration it also re-applies opacity onto the fresh
      // layer/canvas object (no-op when the user never changed it).
      this.ui.applyUserState(opts.id);
      // Incremental: refresh only the new/updated row's cells instead of
      // re-scanning every row (initTypesAndVisibility is a full pass used on
      // attach/fold). Fires after applyUserState so the row reflects the fresh
      // map state.
      this.events.emit(EVENTS.LAYER_ITEM_REFRESHED, { id: opts.id });
      this.events.emit(EVENTS.LAYER_GROUP_COUNT_CHANGED, {
        group: layerInfo.group,
      });
      // Defer z-order enforcement so batch registration coalesces into one pass.
      this.debouncedEnforce();
    }
    // Registration never writes the saved order: the slot this layer just took
    // is where attach timing put it, not a user arrangement. Only an explicit
    // user reorder (drag, moveLayerUp/Down, bringLayerToFront) snapshots the
    // live order. A layer the user *did* arrange still replays here through
    // insertOverlayAt / applyUserState above.
    this.emitLayerChange(opts.id, layerInfo.kind);
    return this.uiContainer.querySelector(
      `[${CONST.DATA.LAYER_ID}="${CSS.escape(opts.id)}"]`,
    );
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
    this.layerRegistry.moveToFront(id);
    this.enforceOrder();
    this.saveOrder();
    this.emitLayerChange(id, item.kind);
    if (this.uiContainer && this.ui) {
      this.events.emit(EVENTS.LAYER_LIST_REBUILD);
    }
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
    const { layerInfo, layer } = this.domain.unregisterEntry(id);
    if (!layerInfo) return false;

    if (layer) {
      if (this.map.hasLayer(layer)) this.map.removeLayer(layer);
      this.clearAllLayers(layer);
    }

    if (this.uiContainer) {
      const target = this.uiContainer.querySelector(
        `[${CONST.DATA.LAYER_ID}="${CSS.escape(id)}"]`,
      );
      if (target) {
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
    // Emitting unconditionally: bindEvents has not run when there is no UI, so
    // the subscribers simply do not fire — same effect as the previous
    // `this.ui?.` guards, without a null-check chain on the manager side.
    this.events.emit(EVENTS.LAYER_ITEM_REMOVED, { id });
    // The row was just removed: rescan the group's count so the toggle-all
    // checkbox reflects the removal in the same frame.
    this.events.emit(EVENTS.LAYER_GROUP_COUNT_CHANGED, {
      group: layerInfo.group,
    });
    // Unregister is rare, so flush rather than riding out the 100ms window.
    // Any pending write carries the registry's current order, which no longer
    // lists this id — that dimension reads the registry live, so the removal is
    // recorded without the teardown touching a persisted map.
    this.persistence.flushAll();
    this.emitLayerChange(id, layerInfo.kind);
    // The registry change lands first, so a subscriber that drops the layer off
    // its own list and then clears state observes the removal on the same
    // channel it saw the registration. LAYER_REMOVED is the teardown
    // notification itself — "the id left the registry" (Measure drops its
    // active mode), not "the user deleted this". A user delete routes through
    // deleteLayer, which emits LAYER_REMOVED for user-owned layers and
    // LAYER_DELETED for component-owned ones.
    this.events.emit(EVENTS.LAYER_REMOVED, { id });
    return true;
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
      // Emit first: the component's LAYER_DELETED handler wipes its own canvas
      // and its own saved config, and only then does LayerControl prune what it
      // owns. Both halves of a clear must erase, or the next draw inherits the
      // half nobody pruned.
      this.events.emit(EVENTS.LAYER_DELETED, { id });
      const { orderDropped, intentDropped } = this.domain.deleteEntry(id);
      if (this.ui && (orderDropped || intentDropped)) this.ui.saveState();
      this.persistence.flushAll();
      return true;
    }

    // The colour basemap is also component-owned: clearing it unregisters the
    // surface and resets the fill state so the map returns to the grid empty
    // state. The id stays registerable so the colour can be re-picked.
    if (id === CONST.SOLID_BASEMAP_ID) {
      const removed = this.unregisterLayer(id);
      if (!removed) return false;
      if (this.ui) {
        this.ui.resetSolidBasemap();
        this.events.emit(EVENTS.LAYER_GROUP_COUNT_CHANGED, {
          group: GROUP.BASE,
        });
        this.events.emit(EVENTS.LAYER_NO_BASEMAP_CHANGED);
      }
      this.persistence.flushAll();
      return true;
    }

    const removed = this.unregisterLayer(id);
    if (!removed) return false;

    this.order.removedIds.add(id);
    this.persistence.schedule({ removed: () => [...this.order.removedIds] });
    // unregisterLayer keeps the label config (a teardown is not a delete);
    // this is the delete, so forget it here — `configEntries` must stop
    // answering for a removed id.
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

    if (!this.ui) {
      this.persistence.flushAll();
      return true;
    }
    if (orderDropped || intentDropped) this.ui.saveState();
    if (nameCleared) this.ui.saveNamesState();
    this.events.emit(EVENTS.LAYER_GROUP_COUNT_CHANGED, {
      group: layerInfo.group,
    });
    this.events.emit(EVENTS.LAYER_NO_BASEMAP_CHANGED);
    this.persistence.flushAll();
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

  syncAttribution() {
    this.lastAttribution = this.domain.syncAttribution();
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

    this.layerRegistry.reorder(idx, idx - 1);
    this.enforceOrder();
    this.saveOrder();
    this.emitLayerChange(id, item.kind);
    if (this.uiContainer && this.ui) {
      this.events.emit(EVENTS.LAYER_LIST_REBUILD);
    }
    return true;
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

    this.layerRegistry.reorder(idx, idx + 1);
    this.enforceOrder();
    this.saveOrder();
    this.emitLayerChange(id, item.kind);
    if (this.uiContainer && this.ui) {
      this.events.emit(EVENTS.LAYER_LIST_REBUILD);
    }
    return true;
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
