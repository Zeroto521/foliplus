// LayerControl/domain — the domain orchestration layer for LayerControl.
//
// Owns the registry / order / persistence / surface / pane / factory
// coordination that registerLayer, unregisterLayer, deleteLayer, enforceOrder
// and friends need. Extracted from LayerController so the controller can stay
// thin: build store + build view + wire up.
//
// Lives beside LayerController (not in core/layer/) because it depends on
// LayerPersistence and AnnotationManager — both LayerControl-local.
import { hasLabelField } from "#core/label/index.js";
import {
  GROUP,
  INTENT,
  KIND,
  type LayerFactory,
  type LayerInfo,
  type LayerInfoRegistry,
  type LayerOrder,
  LayerSurface,
  PANE_ROLE,
  type PaneManager,
  type PaneSpec,
  type RegisterLayerOpts,
  findLayer as findLayerUtil,
  paintsAtZoom,
  topSlotZ,
  zFor,
} from "#core/layer/index.js";
import { attributionEntries, refreshAttributions } from "#core/leafletAdapter.js";
import { finalizeEach } from "#common/finalize.js";
import type { AnnotationManager } from "../annotation/index.js";
import * as CONST from "../const.js";
import type { LayerPersistence } from "../persistence.js";
import type { LayerIntentStore } from "./LayerIntentStore.js";

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
  const paneSpecs = layerInfo.paneSpecs ?? [];
  if (paneSpecs.some(spec => spec.role === PANE_ROLE.ANNOTATION)) return paneSpecs;
  if (!layer || !hasLabelField(layer)) return paneSpecs;
  return [
    ...paneSpecs,
    {
      role: PANE_ROLE.ANNOTATION,
      order: paneSpecs.length,
      name: CONST.ANNOTATION_PANE_PREFIX + layerInfo.id,
    },
  ];
};

class LayerOrchestration {
  private map: L.Map;
  private layerRegistry: LayerInfoRegistry;
  private panes: PaneManager;
  private factory: LayerFactory;
  private order: LayerOrder;
  private persistence: LayerPersistence;
  private annotation: AnnotationManager;
  private surfaces: Map<string, LayerSurface>;
  private surfacesByLayer: Map<number, LayerSurface>;
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

  private deps: {
    getIntentStore: () => LayerIntentStore;
  };
  constructor(deps: {
    map: L.Map;
    layerRegistry: LayerInfoRegistry;
    panes: PaneManager;
    factory: LayerFactory;
    order: LayerOrder;
    persistence: LayerPersistence;
    annotation: AnnotationManager;
    surfaces: Map<string, LayerSurface>;
    surfacesByLayer: Map<number, LayerSurface>;
    getIntentStore: () => LayerIntentStore;
  }) {
    this.deps = {
      getIntentStore: deps.getIntentStore,
    };
    this.map = deps.map;
    this.layerRegistry = deps.layerRegistry;
    this.panes = deps.panes;
    this.factory = deps.factory;
    this.order = deps.order;
    this.persistence = deps.persistence;
    this.annotation = deps.annotation;
    this.surfaces = deps.surfaces;
    this.surfacesByLayer = deps.surfacesByLayer;
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

  /** Which attribution string belongs to the topmost *painting* base — `''`
   *  when none paints. Pure (no Leaflet writes), so it is unit-testable
   *  without mocking the control's private table.
   *
   *  Registry order is list order, and index 0 is the visually topmost layer
   *  (`zFor` prices `count - index`). The first checked base that is
   *  effective shown is therefore the one whose attribution the user expects.
   *  `paintsAtZoom` is the effective-shown gate — a layer must be on the map
   *  (`hasLayer`) AND its zoom must be within its own `minZoom/maxZoom` range
   *  (outside that range Leaflet's GridLayer builds no tiles, so it isn't
   *  painting). A layer that is checked but not painting is not "being shown".
   */
  desiredAttribution(): string {
    for (
      let i = this.layerRegistry.firstBaseIdx;
      i !== -1 && i < this.layers.length;
      i++
    ) {
      const layerInfo = this.layers[i];
      if (layerInfo.group !== GROUP.BASE) continue;
      const layer = this.findLayer(layerInfo);
      if (!(layer instanceof L.TileLayer) || !layer.options.attribution) continue;
      if (!paintsAtZoom(this.map, layer)) continue;
      return layer.options.attribution;
    }
    return "";
  }

  /** Syncs the attribution control to show exactly one entry: the topmost
   *  visible base's attribution.
   *
   *  foliplus is the sole writer of the entry table. Leaflet's own
   *  `layeradd` handler increments a per-layer entry on every base tile
   *  layer addition (and decrements on remove), so diffing against a cached
   *  "last value" is unsound under multiple simultaneous base layers: a base
   *  that Leaflet already registered underneath another visible base would
   *  linger in the table and show up in the rendered attribution. Clearing
   *  and rebuilding the table on every sync makes the invariant "exactly one
   *  entry == the topmost visible base's attr" independent of Leaflet's own
   *  bookkeeping order.
   *
   *  `attributionEntries` hands back the live table by reference and
   *  `refreshAttributions` re-runs the control's private redraw — the two are
   *  the sanctioned adapter route around Leaflet's private
   *  `addAttribution` / `removeAttribution` / `_update`. */
  syncAttribution(): void {
    const attrCtrl = this.map.attributionControl;
    if (!attrCtrl) return;
    const topAttr = this.desiredAttribution();
    const entries = attributionEntries(attrCtrl);
    const keys = Object.keys(entries);
    // Already exactly the expected single entry: skip the redraw. `_update()`
    // rewrites the attribution element, and this runs on every ordering pass
    // (register / delete / drag), so an unchanged table must not pay for it.
    // Reading the *live* table (not a private cache) still catches an entry
    // Leaflet's own layeradd added behind our back — that makes the key count
    // wrong and falls through to the rebuild.
    const settled =
      topAttr === ""
        ? keys.length === 0
        : keys.length === 1 && keys[0] === topAttr && entries[topAttr] === 1;
    if (settled) return;
    for (const key of keys) delete entries[key];
    if (topAttr) entries[topAttr] = 1;
    refreshAttributions(attrCtrl);
  }

  /** The surface for a registry entry, built on first use. Registration builds
   *  it explicitly (see registerLayer); this lazy path is for the entries that
   *  never go through `registerLayer` — folium adds its own layers, so the
   *  registry knows them only as unresolved ids and the ordering pass is where
   *  they first get a rendering face. */
  surfaceFor(layerInfo: LayerInfo): LayerSurface {
    const layer = this.findLayer(layerInfo);
    const surfaceFace = {
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
    if (existing?.matches(surfaceFace)) return existing;
    if (existing) {
      // The layer object (or its declaration) was replaced. Release the old
      // surface's resources before the new face takes the id: its
      // synthesized base pane and marker-shadow pane would otherwise linger
      // as unowned DOM, and the replacement's claim on its own pane names
      // would collide with a stale claim. The stamp index entry goes first so
      // a lookup by the superseded layer cannot answer with a surface nobody
      // paints into anymore.
      if (existing.layer) this.surfacesByLayer.delete(L.stamp(existing.layer));
      existing.destroy();
    }
    const surface = new LayerSurface(this.panes, surfaceFace);
    this.surfaces.set(layerInfo.id, surface);
    if (surfaceFace.layer) {
      this.surfacesByLayer.set(L.stamp(surfaceFace.layer), surface);
    }
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
   *  cancellation; this pass assumes it is safe to run.
   *
   *  @returns the ids that could not be priced, in registry order — empty on a
   *    clean pass. A throwing layer must not strand the layers above it.
   */
  enforceOrder(): string[] {
    const failed = finalizeEach(
      this.layers,
      (layerInfo, i) => this.priceLayer(layerInfo, i),
      layerInfo => layerInfo.id,
    );

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

    return failed.map(f => f.item.id);
  }

  /** Price one layer: resolve (or build) its surface, materialize the face and
   *  write its slot's z. Split out so a throw is attributable to exactly one
   *  layer. */
  private priceLayer(layerInfo: LayerInfo, index: number): void {
    const layer = this.findLayer(layerInfo);
    // Base-group layers (tile basemaps + the solid-color basemap) share
    // the 200 ladder, so a color pane interleaves with tile basemaps
    // row-by-row. Overlay-group layers use the 600 ladder.
    const slot = { index, count: this.layers.length, group: layerInfo.group };
    const z = zFor(slot);

    // Callback-only layers (createCanvas / heatmap): no Leaflet layer, but
    // they own a dedicated pane that must still take its place in the stack.
    if (!layer) {
      const surface = this.surfaceFor(layerInfo);
      surface.materialize();
      surface.setZ(z);
      return;
    }

    if (!this.map.hasLayer(layer)) return;

    const surface = this.surfaceFor(layerInfo);
    surface.materialize();
    // One write covers every pane the face owns — including the
    // `role: "annotation"` label pane, a PaneHandle since the surface
    // materialized it. The ordering pass used to spot-write that pane by
    // name here; `writeZ` prices it through the same `zFor({ role:
    // "annotation" })` ladder now, so the special case is gone.
    surface.setZ(z);
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

    // Same-layer re-registration is the caller's "this layer changed"
    // signal. `matches()` no longer probes content, so drop the cached audit
    // here — the `materialize()` below then re-pins the tree and re-derives
    // the capability projection (a tree that became migratable again recovers
    // without waiting for a `layeradd`). A replaced layer object rebuilds the
    // surface anyway; the mark on the old surface is harmless.
    if (existingLi) this.surfaces.get(opts.id)?.markContentDirty();
    const layerInfo = this.layerRegistry.createLayerInfo(opts, existingLi, this.map);

    // Same id, new layer object: the old layer is being replaced, not
    // joined. Retire it from the map BEFORE the registry forgets it —
    // otherwise it keeps painting as an unmanageable ghost (no row, no
    // opacity, no focus, no sort can reach it) for as long as the session
    // lives. Same-object re-registration (the "this layer changed" signal)
    // is untouched.
    if (
      existingLi?.layer &&
      opts.layer &&
      existingLi.layer !== opts.layer &&
      this.map.hasLayer(existingLi.layer)
    ) {
      this.map.removeLayer(existingLi.layer);
    }

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
    if (opts.layer) this.panes.invalidateDiscoveryCache(L.stamp(opts.layer));

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
  unregisterEntry(id: string): {
    layerInfo: LayerInfo | null;
    layer: L.Layer | null;
    layerStamp: number | null;
  } {
    const layerInfo = this.layerRegistry.remove(id);
    if (!layerInfo) return { layerInfo: null, layer: null, layerStamp: null };

    const layer = this.findLayer(layerInfo);
    const layerStamp = layer ? L.stamp(layer) : null;
    if (layerStamp !== null) this.panes.invalidateDiscoveryCache(layerStamp);
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

export { LayerOrchestration };
