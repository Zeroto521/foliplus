// LayerControl/domain — the domain orchestration layer for LayerControl.
//
// Owns the registry / order / persistence / surface / pane / factory
// coordination that registerLayer, unregisterLayer, deleteLayer, enforceOrder
// and friends need. Extracted from LayerController so the controller can stay
// thin: build store + build view + wire up.
//
// Lives beside LayerController (not in core/layer/) because it depends on
// LayerPersistence and AnnotationManager — both LayerControl-local.
import { EVENTS, type EventBus } from "#core/event/index.js";
import { hasLabelField } from "#core/labelField.js";
import type { LayerFactory } from "#core/layer/LayerFactory.js";
import { LayerInfoRegistry } from "#core/layer/LayerInfoRegistry.js";
import type { LayerOrder } from "#core/layer/LayerOrder.js";
import { LayerSurface } from "#core/layer/LayerSurface.js";
import { PaneManager } from "#core/layer/PaneManager.js";
import {
  GROUP,
  INTENT,
  KIND,
  type LayerKind,
  PANE_ROLE,
  findLayer as findLayerUtil,
  topSlotZ,
  zFor,
} from "#core/layer/index.js";
import type {
  LayerInfo,
  PaneSpec,
  RegisterLayerOpts,
} from "#core/layer/type.js";
import { attributionEntries, refreshAttributions } from "#core/leafletAdapter.js";
import type { AnnotationManager } from "./annotation/index.js";
import { LayerIntentStore } from "./domain/LayerIntentStore.js";
import * as CONST from "./const.js";
import type { LayerPersistence } from "./persistence.js";

/** The pane specs a surface is declared with: the registry entry's own, plus
 *  the label (annotation) pane when the layer's features expose a labelable
 *  field. This is the one probe behind `capabilities.annotation` — run on
 *  *every* surface resolution, so a live layer that gained its first
 *  labelable feature flips the declared specs on the next gate / menu /
 *  panel read and `matches` rebuilds the surface (pane and capability with
 *  it) — no reload. Losing the last one flips back the same way.
 *
 *  The spec rides this call's copy, never `layerInfo.paneSpecs`: the
 *  declaration belongs to the surface face (like the fill / stroke probe
 *  results), and a re-registration re-derives it fresh. A spec someone else
 *  already declared is theirs — the probe only appends what is absent and
 *  never removes a foreign declaration. */
const withAnnotationSpec = (
  layerInfo: LayerInfo,
  layer: L.Layer | null,
): PaneSpec[] => {
  const specs = layerInfo.paneSpecs ?? [];
  if (specs.some(spec => spec.role === PANE_ROLE.ANNOTATION)) return specs;
  if (!layer || !hasLabelField(layer)) return specs;
  return [
    ...specs,
    {
      role: PANE_ROLE.ANNOTATION,
      order: specs.length,
      name: CONST.ANNOTATION_PANE_PREFIX + layerInfo.id,
    },
  ];
};

class LayerOrchestration {
  private map: L.Map;
  private events: EventBus;
  private layerRegistry: LayerInfoRegistry;
  private panes: PaneManager;
  private factory: LayerFactory;
  private order: LayerOrder;
  private persistence: LayerPersistence;
  private annotation: AnnotationManager;
  private surfaces: Map<string, LayerSurface>;
  private surfacesByLayer: Map<number, LayerSurface>;
  private lastAttribution: string | null;
  /** Per-layer intent store — the single source for every user-chosen
   *  dimension (visible / fill / border / opacity / zoomRange / name /
   *  annotation). Absent key = never touched. Provenance rides the same
   *  `IntentRow` beside the values. Domain-owned because it is the axis on
   *  which registerLayer (hidden → skip `map.addLayer`), deleteLayer (drop
   *  row + clear name), and persistence replay decide — not a view-only
   *  concern.
   *
   *  Backed by a getter so the controller can swap it out (tests do this by
   *  injecting a mock via `manager.intentStore = mock`); the domain never
   *  caches a stale reference. */
  get intentStore(): LayerIntentStore {
    return this.deps.getIntentStore();
  }
  /** Whether the author set a finite `map.options.maxZoom`.
   *
   *  Captured in the constructor, before the first enforceOrder can write its
   *  own fallback, so the guard below never reads back our own write. */
  private authorMaxZoomDeclared: boolean;

  private deps: {
    getIntentStore: () => LayerIntentStore;
  };
  constructor(deps: {
    map: L.Map;
    events: EventBus;
    layerRegistry: LayerInfoRegistry;
    panes: PaneManager;
    factory: LayerFactory;
    order: LayerOrder;
    persistence: LayerPersistence;
    annotation: AnnotationManager;
    surfaces: Map<string, LayerSurface>;
    surfacesByLayer: Map<number, LayerSurface>;
    lastAttribution: string | null;
    getIntentStore: () => LayerIntentStore;
  }) {
    this.deps = { getIntentStore: deps.getIntentStore };
    this.map = deps.map;
    this.events = deps.events;
    this.layerRegistry = deps.layerRegistry;
    this.panes = deps.panes;
    this.factory = deps.factory;
    this.order = deps.order;
    this.persistence = deps.persistence;
    this.annotation = deps.annotation;
    this.surfaces = deps.surfaces;
    this.surfacesByLayer = deps.surfacesByLayer;
    this.lastAttribution = deps.lastAttribution;
    // Same capture the controller used to do: the author's declaration,
    // read before any enforceOrder can write its own fallback.
    this.authorMaxZoomDeclared = Number.isFinite(deps.map.options?.maxZoom);
  }

  /** Ordered layers (read-only view; always reflects the registry). */
  get layers(): readonly LayerInfo[] {
    return this.layerRegistry.layers;
  }

  findLayer(idOrInfo: string | LayerInfo): L.Layer | null {
    const layerInfo =
      typeof idOrInfo === "string" ? this.layerRegistry.get(idOrInfo) : idOrInfo;
    if (layerInfo?.layer) return layerInfo.layer;
    return findLayerUtil(
      this.map,
      typeof idOrInfo === "string" ? idOrInfo : (layerInfo?.id ?? ""),
    );
  }

  emitLayerChange(id: string, kind: LayerKind): void {
    this.events.emit(EVENTS.LAYER_CHANGE, { id, kind });
  }

  hasUnresolvedLayers(): boolean {
    for (const layerInfo of this.layers) {
      if (layerInfo.layer) continue;
      const kind = layerInfo.kind;
      if (kind === KIND.CANVAS || kind === KIND.SOLID || kind === KIND.CUSTOM) {
        continue;
      }
      return true;
    }
    return false;
  }

  canReorderBetween(fromIdx: number, toIdx: number): boolean {
    return this.layerRegistry.canReorderBetween(fromIdx, toIdx);
  }

  /** Syncs the attribution control to the top visible base tile.
   *  Returns the new attribution value ('' when none) so the controller can
   *  keep its public field in sync. */
  syncAttribution(): string {
    const attrCtrl = this.map.attributionControl;
    if (!attrCtrl) return this.lastAttribution ?? "";

    let topAttr = "";
    for (
      let i = this.layerRegistry.firstBaseIdx;
      i !== -1 && i < this.layers.length;
      i++
    ) {
      const layerInfo = this.layers[i];
      if (layerInfo.group !== GROUP.BASE) continue;
      const layer = this.findLayer(layerInfo);
      if (!(layer instanceof L.TileLayer) || !layer.options.attribution) continue;
      if (this.map.hasLayer(layer)) {
        topAttr = layer.options.attribution;
        break;
      }
    }

    if (topAttr === this.lastAttribution) return this.lastAttribution;

    const prev = this.lastAttribution;
    this.lastAttribution = topAttr;
    if (prev) {
      if (attrCtrl.removeAttribution) attrCtrl.removeAttribution(prev);
      else delete attributionEntries(attrCtrl)[prev];
    }
    if (topAttr) {
      if (attrCtrl.addAttribution) attrCtrl.addAttribution(topAttr);
      else attributionEntries(attrCtrl)[topAttr] = 1;
    }
    if (!attrCtrl.removeAttribution) refreshAttributions(attrCtrl);
    return this.lastAttribution;
  }

  /** The surface for a registry entry, built on first use. Registration builds
   *  it explicitly (see registerLayer); this lazy path is for the entries that
   *  never go through `registerLayer` — folium adds its own layers, so the
   *  registry knows them only as unresolved ids and the ordering pass is where
   *  they first get a rendering face. */
  surfaceFor(layerInfo: LayerInfo): LayerSurface {
    const layer = this.findLayer(layerInfo);
    const spec = {
      id: layerInfo.id,
      layer,
      // The registry is the only place a kind is derived, so forward its answer
      // instead of letting the surface re-probe the tree: without this a
      // declared `kind` (and a `custom` carrier) would be re-derived away from
      // its own declaration on the surface side.
      kind: layerInfo.kind,
      custom: layerInfo.carrier.custom,
      paneName: layerInfo.paneName,
      paneSpecs: withAnnotationSpec(layerInfo, layer),
      canvas: Boolean(layerInfo.carrier.canvas),
      getBounds: layerInfo.getBounds,
      color: layerInfo.color,
    };
    const existing = this.surfaces.get(layerInfo.id);
    if (existing?.matches(spec)) return existing;
    if (existing?.layer) {
      // The layer object (or its declaration) was replaced. Drop the stamp
      // index entry for the superseded layer, or a lookup by it would keep
      // answering with a surface nobody paints into anymore.
      this.surfacesByLayer.delete(L.stamp(existing.layer));
    }
    const surface = new LayerSurface(this.panes, spec);
    this.surfaces.set(layerInfo.id, surface);
    if (spec.layer) this.surfacesByLayer.set(L.stamp(spec.layer), surface);
    return surface;
  }

  /** The surface that currently paints a live layer, or null. */
  surfaceForLayer(layer: L.Layer): LayerSurface | null {
    return this.surfacesByLayer.get(L.stamp(layer)) ?? null;
  }

  /** Panes a registered layer's content lives in, including the pane its
   *  surface synthesized. Falls back to the names in the layer's own tree for a
   *  layer nobody registered. */
  resolveLayerPanes(layer: L.Layer): string[] {
    const surface = this.surfaceForLayer(layer);
    if (surface?.panes.length) return surface.paneNames;
    return this.panes.getLayerPanes(layer);
  }

  /** Give every layer a surface and reprice its z.
   *
   *  Re-ordering only. Panes are allocated at register time — a canvas or
   *  color face inside `register()`, a layer's tree inside `materialize()` —
   *  and each is priced at its own slot then, so a pane is never seen at
   *  Leaflet's default z. Content that arrived since the last pass is
   *  re-pinned by `materialize()` itself. What is left here is to reprice
   *  after the registry moves (add, delete, drag) and to place the shared
   *  panes around the ladder.
   *
   *  The controller holds the re-entry guard (`isEnforcing`) and the debounce
   *  cancellation; this pass assumes it is safe to run. */
  enforceOrder() {
    // Leaflet's getMaxZoom() is options.maxZoom ?? <max of the layers'
    // options.maxZoom> ?? Infinity, and folium emits a map with no declared
    // max zoom: the map would zoom past every layer's native range into
    // empty space. Own the ceiling in that case — the union of the
    // registered layers' native options.maxZoom, falling back to a default
    // when nothing declares one. The layers' native values are the author's
    // declaration, not the user's zoomRange (which resolves through
    // effectiveShown, not map zoom limits).
    //
    // Re-runs every pass instead of guarding on map.options.maxZoom: that
    // value is our own previous write, so guarding on it froze the ceiling
    // at the first pass and a layer registered later could never raise it.
    // And it stays a union rather than max(prev, layers), so a removed
    // layer's range no longer holds the ceiling up.
    if (!this.authorMaxZoomDeclared) {
      let max = 0;
      for (const li of this.layers) {
        const opts = li.layer?.options as { maxZoom?: number } | undefined;
        if (
          typeof opts?.maxZoom === "number" &&
          Number.isFinite(opts.maxZoom) &&
          opts.maxZoom > max
        ) {
          max = opts.maxZoom;
        }
      }
      this.map.options.maxZoom = max > 0 ? max : CONST.AUTHOR_ZOOM_FALLBACK_MAX;
    }
    // Give every layer a surface and reprice its z.
    for (let i = 0; i < this.layers.length; i++) {
      const layerInfo = this.layers[i];
      const layer = this.findLayer(layerInfo);
      // Base-group layers (tile basemaps + the solid-color basemap) share
      // the 200 ladder, so a color pane interleaves with tile basemaps
      // row-by-row. Overlay-group layers use the 600 ladder.
      const slot = { index: i, count: this.layers.length, group: layerInfo.group };
      const z = zFor(slot);

      // Callback-only layers (createCanvas / heatmap): no Leaflet layer, but
      // they own a dedicated pane that must still take its place in the stack.
      if (!layer) {
        const surface = this.surfaceFor(layerInfo);
        surface.materialize();
        surface.setZ(z);
        continue;
      }

      if (!this.map.hasLayer(layer)) continue;

      const surface = this.surfaceFor(layerInfo);
      surface.materialize();
      // One write covers every pane the face owns — including the
      // `role: "annotation"` label pane, a PaneHandle since the surface
      // materialized it. The ordering pass used to spot-write that pane by
      // name here; `writeZ` prices it through the same `zFor({ role:
      // "annotation" })` ladder now, so the special case is gone.
      surface.setZ(z);
    }

    // Data panes start at BASE (== Leaflet's markerPane 600). Popup must sit
    // above the highest data pane (topZ + 1), tooltip exactly at topZ, and
    // markers (search/locate pins, ✕, data markers) one step below topZ but
    // still above every data pane — otherwise markerPane would hide under
    // overlays. The base comes from the ladder; the offsets are fixed.
    const topZ = topSlotZ(this.layers.length);
    const popupPaneEl = this.map.getPane("popupPane");
    if (popupPaneEl) popupPaneEl.style.zIndex = String(topZ + 1);
    const tooltipPaneEl = this.map.getPane("tooltipPane");
    if (tooltipPaneEl) tooltipPaneEl.style.zIndex = String(topZ);
    const markerPaneEl = this.map.getPane("markerPane");
    if (markerPaneEl) markerPaneEl.style.zIndex = String(topZ - 1);
  }

  /** The domain half of {@link LayerController.registerLayer}: build or update
   *  the registry entry, materialize its rendering face, and decide whether the
   *  layer joins the map on re-entry.
   *
   *  The `hidden` result is the only intent read of the whole registration
   *  entry point — when the user marked the layer hidden it stays off the map
   *  on runtime re-registration, so nothing is silently re-added. A
   *  canvas-only hidden layer (no Leaflet layer) is projected through
   *  `applyUserState` on the controller side; that carries the hidden intent
   *  through the executor's single write path.
   *
   *  Returns the insertion outcome so the controller can dispatch the right UI
   *  event (new row vs. re-registration) and skip `map.addLayer` when the
   *  intent says so. No UI side effects: events, applyUserState, persistence
   *  are all controller-owned. */
  registerEntry(
    opts: RegisterLayerOpts,
    hasUi: boolean,
  ): { layerInfo: LayerInfo; existingIdx: number; hidden: boolean } {
    const existingLi = this.layerRegistry.get(opts.id);
    const existingIdx = existingLi ? this.layerRegistry.indexOf(existingLi) : -1;
    const layerInfo = this.layerRegistry.createLayerInfo(
      opts,
      existingLi,
      this.map,
    );

    if (existingIdx !== -1) this.layerRegistry.upsert(layerInfo);
    else if (layerInfo.group === GROUP.BASE) {
      const firstBaseIdx = this.layerRegistry.firstBaseIdx;
      const atBottom = opts.baseInsert === "bottom";
      if (firstBaseIdx === -1 || atBottom) {
        this.layerRegistry.insertAt(layerInfo, this.layers.length);
      } else {
        this.layerRegistry.insertAt(layerInfo, firstBaseIdx);
      }
      this.order.placeAtSavedSlot(layerInfo);
    } else this.order.insertOverlayAt(layerInfo);

    // Give the layer its rendering face and materialize it *before* it joins
    // the map. `options.pane` is read by `map.addLayer` and ignored afterwards,
    // so this is the last moment at which the pane can be decided without
    // moving DOM — which is why the ordering pass no longer has to.
    const surface = this.surfaceFor(layerInfo);
    surface.materialize();
    // materialize() may have written options.pane across the tree, so the
    // cached child-pane list for this layer is stale.
    if (opts.layer) this.panes.reset(L.stamp(opts.layer));

    // Hidden gate reads the store only when the panel is attached. The store
    // lives on the controller and survives attach, but before attach the
    // intent has not yet been applied to any live layer, so a pre-attach
    // registration takes the map path (a runtime re-registration with a
    // panel still respects the user's hide).
    const hidden = hasUi && this.intentStore.get(opts.id, INTENT.VISIBLE) === false;
    return { layerInfo, existingIdx, hidden };
  }

  /** The domain half of {@link LayerController.unregisterLayer}: remove the
   *  registry entry and tear down its rendering face.
   *
   *  Generic teardown only — it never touches persisted user state. A layer
   *  unregistering itself may simply be temporarily empty (HeatmapControl
   *  unregisters its canvas when the data goes empty), and nothing about that
   *  says the user's stored opacity, zoom range, or hidden state is wanted
   *  back at the author default. Erasing stored state is an explicit user
   *  action and has its own entry point: {@link LayerController.deleteLayer}.
   *
   *  The map-level removal (`map.removeLayer` + `clearAllLayers`) stays on the
   *  controller because it walks the Leaflet tree — a UI side effect, not a
   *  domain decision. The registry / surface / pane teardown here is the
   *  bookkeeping half that a re-registration must not have to redo. */
  unregisterEntry(
    id: string,
  ): { layerInfo: LayerInfo | null; layer: L.Layer | null; layerStamp: number | null } {
    const layerInfo = this.layerRegistry.remove(id);
    if (!layerInfo) return { layerInfo: null, layer: null, layerStamp: null };

    const layer = this.findLayer(layerInfo);
    const layerStamp = layer ? L.stamp(layer) : null;
    if (layerStamp !== null) this.panes.reset(layerStamp);
    // The layer is off the map first (controller side), so the pane teardown
    // never touches a live layer's renderer or path nodes. Only the pane the
    // surface synthesized goes away: a declared pane survives, because
    // re-registering the same id must not have to rebuild it.
    this.surfaces.get(id)?.destroy();
    this.surfaces.delete(id);
    if (layerStamp !== null) this.surfacesByLayer.delete(layerStamp);
    // Drop child-pane bookkeeping for layers that no longer use them.
    this.panes.sweepChildPanes(this.layers);
    return { layerInfo, layer, layerStamp };
  }

  /** Drop one id's persisted user state (order slot + intent row) without
   *  retiring the layer — the domain half of {@link LayerController.deleteLayer}
   *  and its public `dropPersistedLayerState` counterpart.
   *
   *  `clearName` also drops the name rider, which {@link LayerIntentStore.dropRow}
   *  deliberately leaves (it prunes only override dims + provenance). The
   *  component-clear branch of `deleteLayer` keeps the name (a cleared heatmap
   *  is still the user's heatmap); the regular-branch delete drops it because
   *  the layer is gone for good.
   *
   *  Returns what actually changed so the controller can decide which
   *  persistence writes to schedule — an untuned layer must not rewrite the
   *  whole `layers` map on a delete. No UI side effects: the controller owns
   *  `saveState` / `saveNamesState` / events. */
  deleteEntry(
    id: string,
    opts: { clearName?: boolean } = {},
  ): {
    orderDropped: boolean;
    intentDropped: boolean;
    nameCleared: boolean;
  } {
    const orderDropped = this.order.forgetSavedOrder(id);
    const intentDropped = this.intentStore.dropRow(id);
    let nameCleared = false;
    if (opts.clearName && this.intentStore.get(id, INTENT.NAME) != null) {
      this.intentStore.clearValue(id, INTENT.NAME);
      nameCleared = true;
    }
    return { orderDropped, intentDropped, nameCleared };
  }
}

export { LayerOrchestration, withAnnotationSpec };
