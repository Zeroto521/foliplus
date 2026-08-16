import { BEFORE_EXPORT, LAYER_CHANGE, ensureEvents } from "#core/event/index.js";
import { ensureLayerAPI } from "#core/layer/api.js";
import {
  type CreateCanvasAPI,
  type CreateCanvasOpts,
  type CreateLayersAPI,
  type CreateLayersOpts,
  FALLBACK_PANE_PREFIX,
  GEOM_TYPE,
  type LayerAPI,
  LayerFactory,
  LayerRegistry,
  PaneManager,
  type RegisterLayerOpts,
  Z_INDEX,
  findLayer,
  forEachLayer,
  forEachLeaf,
  getGeometryType,
} from "#core/layer/index.js";
import { type Debounced, debounce } from "#common/debounce.js";
import { createTranslator } from "#common/locale.js";
import * as Storage from "#common/storage.js";
import * as CONST from "./const.js";
import { LayerUI } from "./ui.js";

// CONF is a free variable from the IIFE template wrapper (see BaseControl._get_template).
const _ = createTranslator(CONF);

// ==================== BringToFront Guard (monkey-patch) ====================
// Guard Leaflet's bringToFront against null parentNode during enforceOrder
// layer migration (enforceOrder briefly removes layers from the map, and a
// concurrent mousemove event may call bringToFront on a detached _path).
const origBringToFront = L.Path.prototype.bringToFront;
// Reference count: multiple LayerControl instances (multi-map pages) may patch
// the prototype; only the last unpatch restores the original implementation.
let bringToFrontPatchRefs = 0;

const patchBringToFront = () => {
  bringToFrontPatchRefs++;
  if (bringToFrontPatchRefs > 1) return;
  L.Path.prototype.bringToFront = function () {
    if (this._path && this._path.parentNode) origBringToFront.call(this);
    return this;
  };
};

const unpatchBringToFront = () => {
  if (bringToFrontPatchRefs <= 0) return;
  bringToFrontPatchRefs--;
  if (bringToFrontPatchRefs > 0) return;
  L.Path.prototype.bringToFront = origBringToFront;
};

// ==================== Core Manager: LayerManager ====================
class LayerManager implements LayerAPI {
  map: L.Map;
  layerRegistry: LayerRegistry;
  pendingRegistrations: LayerInfo[];
  uiContainer: HTMLElement | null;
  isEnforcing: boolean;
  isDestroyed: boolean;
  panes: PaneManager;
  factory: LayerFactory;
  lastAttribution: string | null;
  ui: LayerUI | null;
  debouncedEnforce: Debounced;
  debouncedSaveOrder: Debounced | undefined; // lazy-init in saveOrder()
  onLayerAdd: (event: L.LeafletEvent) => void;
  getLayerPanes: (layer: L.Layer) => string[];

  constructor(mapInstance: L.Map, data: LayerInfo[]) {
    this.map = mapInstance;
    this.layerRegistry = new LayerRegistry(data, this.map);
    this.pendingRegistrations = [];
    this.uiContainer = null;

    // Bind method context
    this.registerLayer = this.registerLayer.bind(this);
    this.unregisterLayer = this.unregisterLayer.bind(this);
    this.bringLayerToFront = this.bringLayerToFront.bind(this);
    this.getLayerType = this.getLayerType.bind(this);
    this.getLayersByType = this.getLayersByType.bind(this);
    this.findLayer = this.findLayer.bind(this);
    this.forEachLeaf = this.forEachLeaf.bind(this);
    this.extractPoints = this.extractPoints.bind(this);
    this.isEnforcing = false;
    this.isDestroyed = false;

    this.panes = new PaneManager(mapInstance);
    this.getLayerPanes = this.panes.getLayerPanes.bind(this.panes);

    this.factory = new LayerFactory({
      map: this.map,
      panes: this.panes,
      registerLayer: this.registerLayer,
      unregisterLayer: this.unregisterLayer,
      bringLayerToFront: this.bringLayerToFront,
      invalidateType: id => this.invalidateType(id),
    });

    this.lastAttribution = null;
    this.ui = null;

    this.debouncedEnforce = debounce(() => {
      if (this.isDestroyed || !this.map || !this.map.getContainer()) return;
      this.enforceOrder();
    }, CONST.ENFORCE_ORDER_DEBOUNCE_MS);

    // Respond to layer-level adds. The initial enforceOrder runs before the
    // folium layer scripts, so registered layers may not be resolvable yet
    // (layerInfo.layer === null → skipped). When those layers are later added to the
    // map (GeoJSON/FeatureGroup containers included), a layeradd fires and
    // debouncedEnforce re-runs enforceOrder — by then the window globals exist
    // and every managed layer gets its pane/z-index. isEnforcing guards
    // re-entrancy; debounce coalesces a batch of adds into one pass.
    //
    // Once every registered layer is resolved, unrelated layeradds (e.g.
    // ExportControl's crossOrigin re-adds or user-added layers) must NOT
    // trigger a full enforceOrder — only layers belonging to the registry do.
    this.onLayerAdd = event => {
      if (
        this.isDestroyed ||
        event.layer === this.map ||
        event.layer instanceof L.Renderer
      )
        return;

      if (this.hasUnresolvedLayers() || this.isManagedLayer(event.layer)) {
        if (this.isEnforcing) this.debouncedEnforce();
        else this.debouncedEnforce();
      }
    };
    this.map.on("layeradd", this.onLayerAdd);

    this.loadSavedOrder();
    this.layerRegistry.normalizeGroups();
    this.enforceOrder();

    // Before any export, flush pending debounced enforceOrder so the
    // exported image matches the panel's layer order.
    ensureEvents(this.map).on(BEFORE_EXPORT, () => this.enforceOrderNow());

    // Ensure the lightweight LayerAPI exists (consumers always have a valid
    // LayerAPI even without LayerControl), then upgrade to the full version.
    // LayerManager itself implements LayerAPI, so it becomes the map's API.
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

  /** True while any registered layer is unresolved (layerInfo.layer === null).
   *  During the initial folium script phase any layeradd may make a registered
   *  layer resolvable, so unrelated adds must keep triggering enforceOrder. */
  private hasUnresolvedLayers(): boolean {
    for (const layerInfo of this.layers) {
      if (!layerInfo.layer) return true;
    }
    return false;
  }

  /** Whether a just-added layer belongs to a registered layer's tree. */
  private isManagedLayer(layer: L.Layer): boolean {
    for (const layerInfo of this.layers) {
      if (layerInfo.layer === layer) return true;
      if (layerInfo.layer) {
        let found = false;
        forEachLayer(layerInfo.layer, c => {
          if (c === layer) found = true;
        });
        if (found) return true;
      }
    }
    return false;
  }

  loadSavedOrder() {
    const data = Storage.load<string[]>(CONST.STORAGE.ORDER_KEY, CONF.name);
    if (!data || !Array.isArray(data)) return;
    const layerMap = new Map(this.layers.map(l => [l.id, l]));
    const ordered: LayerInfo[] = [];
    for (const id of data) {
      if (layerMap.has(id)) {
        ordered.push(layerMap.get(id)!);
        layerMap.delete(id);
      }
    }
    // byId values are always LayerInfo — no nulls to filter.
    this.layerRegistry.replace(ordered.concat([...layerMap.values()]));
  }

  /** Persist layer order, coalescing rapid calls (drag/drop, batch
   *  registration) into one localStorage write. The debounced writer is
   *  created lazily on first use. */
  saveOrder() {
    if (!this.debouncedSaveOrder) {
      this.debouncedSaveOrder = debounce(() => {
        if (this.isDestroyed) return;
        Storage.save(
          CONST.STORAGE.ORDER_KEY,
          this.layers.map(l => l.id),
          CONF.name,
        );
      }, CONST.SAVE_ORDER_DEBOUNCE_MS);
    }
    this.debouncedSaveOrder();
  }

  // ==================== Public API Methods ====================

  /**
   * Get the geometry type of a registered layer.
   * @param {string} id - Layer ID set when calling registerLayer().
   * @returns {string|null} "point" | "line" | "polygon" | "base" | null
   */
  getLayerType(id: string): string | null {
    const layerInfo = this.layerRegistry.get(id);
    if (!layerInfo) return null;
    if (layerInfo.type) return layerInfo.type;
    if (layerInfo.isBase) return CONST.GROUP.BASE;
    if (layerInfo.iconSvg) return GEOM_TYPE.CUSTOM;
    const layer = this.findLayer(layerInfo);
    if (!layer) return null;
    layerInfo.type = getGeometryType(layer);
    return layerInfo.type;
  }

  /** Drop a registered layer's cached geometry type (re-inferred on next get). */
  invalidateType(id: string): void {
    const layerInfo = this.layerRegistry.get(id);
    if (layerInfo) layerInfo.type = null;
  }

  /** Re-infer and return a layer's geometry type. */
  refreshType(id: string): string | null {
    this.invalidateType(id);
    return this.getLayerType(id);
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

  findLayer(idOrInfo: string | LayerInfo): L.Layer | null {
    const layerInfo =
      typeof idOrInfo === "string" ? this.layerRegistry.get(idOrInfo) : idOrInfo;
    if (layerInfo?.layer) return layerInfo.layer;
    return findLayer(
      this.map,
      typeof idOrInfo === "string" ? idOrInfo : (layerInfo?.id ?? ""),
    );
  }

  forEachLeaf(id: string, fn: (layer: L.Layer) => void) {
    const layer = this.findLayer(id);
    if (layer) forEachLeaf(layer, fn);
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

  registerLayer(opts: RegisterLayerOpts): HTMLElement | null {
    if (!opts?.id) throw new Error(`[${CONF.name}] ${_(`${CONF.name}.id_required`)}`);

    const existingLi = this.layerRegistry.get(opts.id);
    const existingIdx = existingLi ? this.layerRegistry.indexOf(existingLi) : -1;
    const layerInfo = this.layerRegistry.createLayerInfo(opts, existingLi, this.map);

    if (existingIdx !== -1) this.layerRegistry.upsert(layerInfo);
    else if (layerInfo.isBase) {
      const firstBaseIdx = this.layerRegistry.firstBaseIdx;
      if (firstBaseIdx === -1)
        this.layerRegistry.insertAt(layerInfo, this.layers.length);
      else this.layerRegistry.insertAt(layerInfo, firstBaseIdx);
    } else this.layerRegistry.prepend(layerInfo);

    if (opts.paneName) this.panes.ensurePane(opts.paneName);
    if (opts.layer) {
      for (const cp of this.panes.discoverChildPanes(opts.layer))
        this.panes.ensurePane(cp, !this.panes.labelPanes.has(cp));
      // options.pane is updated below — invalidate only this layer's cache.
      this.panes.reset(L.stamp(opts.layer));
    }
    if (opts.layer) this.panes.fallbackPaneMap.delete(L.stamp(opts.layer));
    if (
      opts.paneName &&
      opts.layer &&
      !(opts.layer instanceof L.Path || opts.layer instanceof L.Marker)
    ) {
      opts.layer.options.pane = opts.paneName;
      opts.layer.options.paneSet = true;
    }

    if (opts.layer && !this.map.hasLayer(opts.layer)) this.map.addLayer(opts.layer);

    if (!this.uiContainer) {
      this.pendingRegistrations.push(layerInfo);
      this.debouncedEnforce();
      return null;
    }

    if (this.ui) {
      if (existingIdx === -1) this.ui.insertLayerItem(layerInfo);
      else this.ui.updateLayerItem(layerInfo, existingIdx);
      // Incremental: initialize only the new/updated row instead of re-scanning
      // every row (initTypesAndVisibility is a full pass used on attach/fold).
      this.ui.initLayerItem(layerInfo);
      this.ui.syncToggleAll(layerInfo.isBase ? CONST.GROUP.BASE : CONST.GROUP.OVERLAY);
      // Defer z-order enforcement so batch registration coalesces into one pass.
      this.debouncedEnforce();
    }
    this.saveOrder();
    ensureEvents(this.map).emit(LAYER_CHANGE);
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
    if (item?.isBase) return;
    this.layerRegistry.moveToFront(id);
    this.enforceOrder();
    this.saveOrder();
    ensureEvents(this.map).emit(LAYER_CHANGE);
    if (this.uiContainer && this.ui) {
      this.ui.renderInitialList();
      this.ui.initTypesAndVisibility();
    }
  }

  /**
   * Unregister and remove a layer from the map and panel.
   * @param {string} id - The layer ID previously passed to registerLayer().
   * @returns {boolean} true if layer was found and removed, false otherwise.
   */
  unregisterLayer(id: string): boolean {
    const layerInfo = this.layerRegistry.remove(id);
    if (!layerInfo) return false;

    const layer = this.findLayer(layerInfo);
    if (layer) {
      if (this.map.hasLayer(layer)) this.map.removeLayer(layer);
      this.clearAllLayers(layer);
    }
    if (layer) this.panes.reset(L.stamp(layer));
    if (layer) this.panes.fallbackPaneMap.delete(L.stamp(layer));
    // Drop label-pane entries that are no longer referenced by any layer.
    this.panes.sweepLabelPanes(this.layers);

    if (this.uiContainer) {
      const target = this.uiContainer.querySelector(
        `[${CONST.DATA.LAYER_ID}="${CSS.escape(id)}"]`,
      );
      if (target) {
        target.remove();
        if (this.ui) this.ui.reindexItems();
      }
    }
    ensureEvents(this.map).emit(LAYER_CHANGE);
    return true;
  }

  clearAllLayers(layer: L.Layer | null) {
    if (!layer) return;
    if (
      "clearLayers" in layer &&
      typeof (layer as L.LayerGroup).clearLayers === "function"
    )
      (layer as L.LayerGroup).clearLayers();
    else if (
      "eachLayer" in layer &&
      typeof (layer as L.LayerGroup).eachLayer === "function"
    )
      (layer as L.LayerGroup).eachLayer(c => this.clearAllLayers(c));
  }

  computeZIndex(i: number, isTile: boolean): number {
    const zBase = isTile ? Z_INDEX.TILE_BASE : Z_INDEX.BASE;
    return zBase + (this.layers.length - i) * Z_INDEX.STEP;
  }

  /** Cancel any pending debounced enforceOrder and run it immediately. */
  enforceOrderNow(): void {
    this.debouncedEnforce?.cancel();
    this.enforceOrder();
  }

  enforceOrder() {
    if (this.isEnforcing) return;
    this.isEnforcing = true;
    try {
      const layersToMove: Array<{
        layer: L.Layer;
        paneName: string | null;
        renderer: L.SVG | null;
      }> = [];

      // Note: pane discovery cache is NOT cleared here — enforceOrder does not
      // change layer-tree structure, so registered layers keep their cached
      // child-pane lists. Structure changes (register/unregister/addLayer)
      // invalidate specific entries via panes.reset(stamp).
      for (let i = 0; i < this.layers.length; i++) {
        const layerInfo = this.layers[i];
        const layer = this.findLayer(layerInfo);
        const hasLayer = layer && this.map.hasLayer(layer);
        // GridLayer covers TileLayer plus other grid subclasses (L.gridLayer()).
        // TileLayer has public setZIndex; other GridLayers keep options.zIndex.
        const isGrid = layer instanceof L.GridLayer;
        const isTile = layer instanceof L.TileLayer;
        const z = this.computeZIndex(i, isGrid);

        if (layerInfo.onZIndex) layerInfo.onZIndex(z);
        if (!hasLayer) continue;

        this.applyLayerZIndex({ layerInfo, layer, z, isGrid, isTile, layersToMove });
      }

      // Data panes start at BASE (== Leaflet's markerPane 600). Popup must sit
      // above the highest data pane (topZ + 1), tooltip exactly at topZ, and
      // markers (search/locate pins, ✕, data markers) one step below topZ but
      // still above every data pane — otherwise markerPane would hide under
      // overlays. These offsets are relative to Z_INDEX.STEP (10).
      const topZ = this.computeZIndex(0, false) + Z_INDEX.STEP;
      const popupPaneEl = this.map.getPane("popupPane");
      if (popupPaneEl) popupPaneEl.style.zIndex = String(topZ + 1);
      const tooltipPaneEl = this.map.getPane("tooltipPane");
      if (tooltipPaneEl) tooltipPaneEl.style.zIndex = String(topZ);
      const markerPaneEl = this.map.getPane("markerPane");
      if (markerPaneEl) markerPaneEl.style.zIndex = String(topZ - 1);

      this.panes.migrateLayers(layersToMove);
      this.syncAttribution();
    } finally {
      this.isEnforcing = false;
    }
  }

  applyLayerZIndex({
    layerInfo,
    layer,
    z,
    isGrid,
    isTile,
    layersToMove,
  }: {
    layerInfo: LayerInfo;
    layer: L.Layer;
    z: number;
    isGrid: boolean;
    isTile: boolean;
    layersToMove: Array<{
      layer: L.Layer;
      paneName: string | null;
      renderer: L.SVG | null;
    }>;
  }) {
    const paneName = layerInfo.paneName;
    if (paneName) {
      const paneEntry = this.panes.ensurePane(paneName, !isTile);
      paneEntry.pane.style.zIndex = String(z);
      if (layer.options.pane !== paneName || !layer.options.paneSet)
        layersToMove.push({ layer, paneName, renderer: paneEntry.renderer });
      this.panes.bumpLabelPanes(layer, z);
      return;
    }

    if (isTile) {
      (layer as L.TileLayer).setZIndex(z);
      return;
    }

    if (isGrid) {
      // GridLayer subclass without TileLayer.setZIndex (e.g. L.gridLayer()):
      // Leaflet renders it in tilePane and applies options.zIndex on update.
      (layer.options as L.GridLayerOptions).zIndex = z;
      return;
    }

    const childPanes = this.panes.discoverChildPanes(layer);
    if (childPanes.length > 0) {
      childPanes.forEach((cp: string) => {
        const needRenderer = !isTile && !this.panes.labelPanes.has(cp);
        const paneEntry = this.panes.ensurePane(cp, needRenderer);
        paneEntry.pane.style.zIndex = String(z);
      });
      this.panes.bumpLabelPanes(layer, z);
      layer.options.paneSet = true;
      return;
    }

    const fbName = `${FALLBACK_PANE_PREFIX}${L.stamp(layer)}`;
    this.panes.fallbackPaneMap.set(L.stamp(layer), fbName);
    const paneEntry = this.panes.ensurePane(fbName, !isTile);
    paneEntry.pane.style.zIndex = String(z);
    if (layer.options.pane !== fbName || !layer.options.paneSet)
      layersToMove.push({ layer, paneName: fbName, renderer: paneEntry.renderer });
  }

  syncAttribution() {
    const attrCtrl = this.map.attributionControl;
    if (!attrCtrl) return;

    let topAttr = "";
    // Bases live at the tail of the list; the first visible base tile is the
    // topmost (highest z) one — scan from the first base and stop early.
    for (
      let i = this.layerRegistry.firstBaseIdx;
      i !== -1 && i < this.layers.length;
      i++
    ) {
      const layerInfo = this.layers[i];
      if (!layerInfo.isBase) continue;
      const layer = this.findLayer(layerInfo);
      if (!(layer instanceof L.TileLayer) || !layer.options.attribution) continue;
      if (this.map.hasLayer(layer)) {
        topAttr = layer.options.attribution;
        break;
      }
    }

    // Unchanged top-most attribution: nothing to rebuild.
    if (topAttr === this.lastAttribution) return;

    const prev = this.lastAttribution;
    this.lastAttribution = topAttr;
    if (prev) {
      if (attrCtrl.removeAttribution) attrCtrl.removeAttribution(prev);
      else delete attrCtrl._attributions[prev];
    }
    if (topAttr) {
      if (attrCtrl.addAttribution) attrCtrl.addAttribution(topAttr);
      else attrCtrl._attributions[topAttr] = 1;
    }
    if (!attrCtrl.removeAttribution) attrCtrl._update();
  }

  attachUI(containerDiv: HTMLElement) {
    if (this.ui) this.ui.attachUI(containerDiv);
  }

  canReorderBetween(fromIdx: number, toIdx: number): boolean {
    return this.layerRegistry.canReorderBetween(fromIdx, toIdx);
  }

  destroy() {
    this.isDestroyed = true;
    if (this.map && this.onLayerAdd) this.map.off("layeradd", this.onLayerAdd);
    if (this.debouncedEnforce) this.debouncedEnforce.cancel();
    if (this.debouncedSaveOrder) this.debouncedSaveOrder.cancel();
    if (this.ui) {
      this.ui.unbindEvents();
      this.ui = null;
    }
    if (this.uiContainer) {
      this.uiContainer.innerHTML = "";
      this.uiContainer = null;
    }
    this.layerRegistry.clear();
    this.pendingRegistrations = [];
    this.panes.destroy();
    // Revert to the lightweight LayerAPI (no registry, no panel).
    // ensureLayerAPI guarantees a valid object, so consumers can always
    // call `map.foliplus.LayerAPI.xxx` without null checks.
    ensureLayerAPI(this.map);
  }
}

export { LayerManager, patchBringToFront, unpatchBringToFront };
