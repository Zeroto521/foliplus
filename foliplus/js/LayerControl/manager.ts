import { type Debounced, debounce } from "#common/debounce.js";
import { dom } from "#common/dom.js";
import { createTranslator } from "#common/locale.js";
import * as Storage from "#common/storage.js";
import { throttleRaf } from "#common/throttle.js";
import {
  FALLBACK_PANE_PREFIX,
  GEOM_TYPE,
  Z_INDEX,
  LayerRegistry,
  type RegisterLayerOpts,
  PaneManager,
  findLayer,
  forEachLeaf,
  getGeometryType,
} from "#core/layer/index.js";
import * as CONST from "./const.js";
import { LayerUI } from "./ui.js";

// CONF is a free variable from the IIFE template wrapper (see BaseControl._get_template).
const _ = createTranslator(CONF);

// ==================== BringToFront Guard (monkey-patch) ====================
// Guard Leaflet's bringToFront against null parentNode during enforceOrder
// layer migration (enforceOrder briefly removes layers from the map, and a
// concurrent mousemove event may call bringToFront on a detached _path).
const origBringToFront = L.Path.prototype.bringToFront;
let isBringToFrontPatched = false;

const patchBringToFront = () => {
  if (isBringToFrontPatched) return;
  isBringToFrontPatched = true;
  L.Path.prototype.bringToFront = function () {
    if (this._path && this._path.parentNode) origBringToFront.call(this);
    return this;
  };
};

const unpatchBringToFront = () => {
  if (!isBringToFrontPatched) return;
  isBringToFrontPatched = false;
  L.Path.prototype.bringToFront = origBringToFront;
};

/** Options for createLayers. */
interface CreateLayersOpts {
  id: string;
  name?: string;
  graphPane?: string;
  labelPane?: string;
  iconSvg?: string;
}

/** Options for createCanvas. */
interface CreateCanvasOpts {
  id: string;
  name?: string;
  className?: string;
  iconSvg?: string;
  onToggle?: (visible: boolean) => void;
  onZIndex?: (z: number) => void;
}

/** Leaflet layer with a custom `isLabel` flag (foliplus adds it). */
interface LabelAwareLayer extends L.Layer {
  isLabel?: boolean;
  options: L.LayerOptions & { renderer?: L.Renderer; pane?: string; paneSet?: boolean };
}

// ==================== Core Manager: LayerManager ====================
class LayerManager {
  map: L.Map;
  layerRegistry: LayerRegistry;
  layers: LayerInfo[];
  pendingRegistrations: LayerInfo[];
  uiContainer: HTMLElement | null;
  isEnforcing: boolean;
  isDestroyed: boolean;
  panes: PaneManager;
  lastAttribution: string | null;
  ui: LayerUI | null;
  debouncedEnforce: Debounced;
  onLayerAdd: (event: L.LeafletEvent) => void;
  getLayerPanes: (layer: L.Layer) => string[];

  constructor(mapInstance: L.Map, data: LayerInfo[]) {
    this.map = mapInstance;
    this.layerRegistry = new LayerRegistry(data, this.map);
    this.layers = this.layerRegistry.layers;
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
    this.createLayers = this.createLayers.bind(this);
    this.createCanvas = this.createCanvas.bind(this);
    this.isEnforcing = false;
    this.isDestroyed = false;

    this.panes = new PaneManager(mapInstance);
    this.getLayerPanes = this.panes.getLayerPanes.bind(this.panes);

    this.lastAttribution = null;
    this.ui = null;

    this.debouncedEnforce = debounce(() => {
      if (this.isDestroyed || !this.map || !this.map.getContainer()) return;
      this.enforceOrder();
    }, CONST.ENFORCE_ORDER_DEBOUNCE_MS);

    // Respond to every layer-level add. The initial enforceOrder runs before
    // the folium layer scripts, so registered layers may not be resolvable
    // yet (li.layer === null → skipped). When those layers are later added to
    // the map (GeoJSON/FeatureGroup containers included), a layeradd fires and
    // debouncedEnforce re-runs enforceOrder — by then the window globals exist
    // and every managed layer gets its pane/z-index. isEnforcing guards
    // re-entrancy; debounce coalesces a batch of adds into one pass.
    this.onLayerAdd = event => {
      if (
        this.isDestroyed ||
        event.layer === this.map ||
        event.layer instanceof L.Renderer
      )
        return;

      if (this.isEnforcing) {
        this.debouncedEnforce();
        return;
      }

      this.debouncedEnforce();
    };
    this.map.on("layeradd", this.onLayerAdd);

    this.loadSavedOrder();
    this.layerRegistry.normalizeGroups();
    this.enforceOrder();

    if (!this.map.foliplus) this.map.foliplus = { LayerAPI: null };
    // Expose only the LayerAPI contract (interface methods) — not the whole
    // manager — so the runtime surface stays minimal and internals stay hidden.
    this.map.foliplus.LayerAPI = {
      layers: this.layerRegistry.layers,
      registerLayer: this.registerLayer,
      unregisterLayer: this.unregisterLayer,
      bringLayerToFront: this.bringLayerToFront,
      createLayers: this.createLayers,
      createCanvas: this.createCanvas,
      extractPoints: this.extractPoints,
      getLayerPanes: this.getLayerPanes,
      getLayersByType: this.getLayersByType,
    } as LayerAPI;
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
    this.layerRegistry.replace(
      ordered.concat([...layerMap.values()].filter((v): v is LayerInfo => v != null)),
    );
  }

  saveOrder() {
    Storage.save(
      CONST.STORAGE.ORDER_KEY,
      this.layers.map(l => l.id),
      CONF.name,
    );
  }

  // ==================== Public API Methods ====================

  /**
   * Get the geometry type of a registered layer.
   * @param {string} id - Layer ID set when calling registerLayer().
   * @returns {string|null} "point" | "line" | "polygon" | "base" | null
   */
  getLayerType(id: string): string | null {
    const li = this.layerRegistry.get(id);
    if (!li) return null;
    if (li.type) return li.type;
    if (li.isBase) return CONST.GROUP.BASE;
    if (li.iconSvg) return GEOM_TYPE.CUSTOM;
    const layer = this.findLayer(li);
    if (!layer) return null;
    li.type = getGeometryType(layer);
    return li.type;
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
    const li =
      typeof idOrInfo === "string" ? this.layerRegistry.get(idOrInfo) : idOrInfo;
    if (li?.layer) return li.layer;
    return findLayer(
      this.map,
      typeof idOrInfo === "string" ? idOrInfo : (li?.id ?? ""),
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
    }
    this.panes.reset();
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
      this.ui.initTypesAndVisibility();
    }
    this.saveOrder();
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
    this.panes.reset();
    if (layer) this.panes.fallbackPaneMap.delete(L.stamp(layer));

    if (this.uiContainer) {
      const target = this.uiContainer.querySelector(
        `[${CONST.DATA.LAYER_ID}="${CSS.escape(id)}"]`,
      );
      if (target) {
        target.remove();
        if (this.ui) this.ui.reindexItems();
      }
    }
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

  createLayers(opts: CreateLayersOpts): CreateLayersAPI {
    const mainLayer = L.layerGroup();
    const graphLayer = opts.graphPane
      ? L.layerGroup([], { pane: opts.graphPane })
      : null;
    const labelLayer = opts.labelPane
      ? L.layerGroup([], { pane: opts.labelPane })
      : null;
    if (graphLayer) mainLayer.addLayer(graphLayer);
    if (labelLayer) mainLayer.addLayer(labelLayer);

    let registered = false;

    const layerOpts = {
      name: opts.name,
      id: opts.id,
      isBase: false,
      layer: mainLayer,
      paneName: opts.graphPane || null,
      iconSvg: opts.iconSvg || null,
    };
    const register = () => {
      if (!registered) {
        registered = true;
        if (opts.labelPane) this.panes.labelPanes.add(opts.labelPane);
      }
      this.registerLayer(layerOpts);
    };

    const unregister = () => {
      if (!registered) return;
      const hasContent =
        (graphLayer && graphLayer.getLayers().length > 0) ||
        (labelLayer && labelLayer.getLayers().length > 0);
      if (!hasContent) {
        registered = false;
        this.unregisterLayer(opts.id);
      }
    };

    const origAddLayer = mainLayer.addLayer.bind(mainLayer);
    const origRemoveLayer = mainLayer.removeLayer.bind(mainLayer);

    mainLayer.addLayer = (layer: LabelAwareLayer) => {
      const isLabel = layer.isLabel;
      const target = isLabel ? labelLayer : graphLayer;
      if (target) {
        if (!this.map.hasLayer(mainLayer)) register();
        const paneName = isLabel ? opts.labelPane : opts.graphPane;
        layer.options.pane = paneName;
        if (layer instanceof L.Path) {
          const { renderer } = this.panes.ensurePane(opts.graphPane!);
          layer.options.renderer = renderer ?? undefined;
        } else if (paneName) this.panes.ensurePane(paneName, false);
        const result = target.addLayer(layer);
        this.panes.reset();
        return result;
      }
      return origAddLayer(layer);
    };

    mainLayer.removeLayer = (layer: LabelAwareLayer) => {
      if (graphLayer && graphLayer.hasLayer(layer)) {
        const result = graphLayer.removeLayer(layer);
        this.panes.reset();
        return result;
      }
      if (labelLayer && labelLayer.hasLayer(layer)) {
        const result = labelLayer.removeLayer(layer);
        this.panes.reset();
        return result;
      }
      return origRemoveLayer(layer);
    };

    mainLayer.clearLayers = () => {
      if (graphLayer) graphLayer.clearLayers();
      if (labelLayer) labelLayer.clearLayers();
      if (this.map.hasLayer(mainLayer)) this.map.removeLayer(mainLayer);
      unregister();
      return mainLayer;
    };

    const addLayer = (layer: LabelAwareLayer, isLabel?: boolean) => {
      if (isLabel) layer.isLabel = true;
      mainLayer.addLayer(layer);
      return layer;
    };
    const removeLayer = (...items: Array<L.Layer | null | undefined>) => {
      items.forEach(l => {
        if (l != null) mainLayer.removeLayer(l);
      });
    };
    const clearLayers = () => {
      mainLayer.clearLayers();
    };

    return {
      mainLayer,
      addLayer,
      removeLayer,
      clearLayers,
      register,
      unregister,
      registered: () => registered,
      bringToFront: () => this.bringLayerToFront(opts.id),
    };
  }

  /**
   * Create a managed canvas element that tracks map pan/zoom.
   * @param {Object} opts
   * @returns {createCanvasAPI}
   */
  createCanvas(opts: CreateCanvasOpts): CreateCanvasAPI {
    if (!opts?.id)
      throw new Error(`[${CONF.name}] ${_(`${CONF.name}.require_canvas_id`)}`);

    const mapPane = this.map.getPanes().mapPane as HTMLElement;
    if (!mapPane)
      throw new Error(`[${CONF.name}] ${_(`${CONF.name}.mapPane_not_available`)}`);

    const canvas = dom.el("canvas", {
      class: "foliplus-heatmap-canvas",
      parent: mapPane,
    }) as HTMLCanvasElement;
    if (opts.className) canvas.classList.add(opts.className);

    const ctx = canvas.getContext("2d");

    const resize = () => {
      const container = this.map.getContainer();
      const dpr = window.devicePixelRatio || 1;
      const w = container.clientWidth;
      const h = container.clientHeight;
      if (canvas.width !== w * dpr) canvas.width = w * dpr;
      if (canvas.height !== h * dpr) canvas.height = h * dpr;
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
    };

    const updatePosition = () => {
      const pos = L.DomUtil.getPosition(mapPane);
      canvas.style.left = `${-pos.x}px`;
      canvas.style.top = `${-pos.y}px`;
    };

    const getSize = () => {
      const container = this.map.getContainer();
      return { width: container.clientWidth, height: container.clientHeight };
    };

    resize();
    updatePosition();

    let registered = false;

    const onToggle =
      opts.onToggle ||
      ((visible: boolean) => {
        canvas.classList.toggle(CONST.CLASSES.HIDDEN, !visible);
      });

    const onZIndex =
      opts.onZIndex ||
      ((z: number) => {
        canvas.style.zIndex = String(z);
      });

    const unregister = () => {
      if (!registered) return;
      registered = false;
      ctx!.setTransform(1, 0, 0, 1, 0, 0);
      ctx!.clearRect(0, 0, canvas.width, canvas.height);
      canvas.classList.add(CONST.CLASSES.HIDDEN);
      this.unregisterLayer(opts.id);
    };

    const layerOpts = {
      id: opts.id,
      name: opts.name || opts.id,
      iconSvg: opts.iconSvg || null,
      canvas,
      onToggle,
      onZIndex,
    };
    const register = () => {
      if (registered) return;
      registered = true;
      resize();
      updatePosition();
      canvas.classList.remove(CONST.CLASSES.HIDDEN);
      this.registerLayer(layerOpts);
    };

    const onMove = throttleRaf(() => updatePosition());
    this.map.on("move", onMove);

    const onResize = () => resize();
    this.map.on("resize", onResize);

    const hooks = { before: [] as Array<() => void>, after: [] as Array<() => void> };
    (canvas as CanvasWithHooks).hooks = hooks;

    return {
      canvas,
      ctx,
      resize,
      getSize,
      updatePosition,
      register,
      unregister,
      registered: () => registered,
      destroy: () => {
        this.map.off("move", onMove);
        this.map.off("resize", onResize);
        onMove.cancel();
        unregister();
        canvas.remove();
      },
      bringToFront: () => this.bringLayerToFront(opts.id),
      setZIndex: (z: number) => {
        canvas.style.zIndex = String(z);
      },
      setVisible: (v: boolean) => {
        canvas.classList.toggle(CONST.CLASSES.HIDDEN, !v);
      },
      hooks,
    };
  }

  computeZIndex(i: number, isTile: boolean): number {
    const zBase = isTile ? Z_INDEX.TILE_BASE : Z_INDEX.BASE;
    return zBase + (this.layers.length - i) * Z_INDEX.STEP;
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
      this.panes.reset();

      for (let i = 0; i < this.layers.length; i++) {
        const li = this.layers[i];
        const layer = this.findLayer(li);
        const hasLayer = layer && this.map.hasLayer(layer);
        const isTile = layer instanceof L.TileLayer;
        const z = this.computeZIndex(i, isTile);

        if (li.onZIndex) li.onZIndex(z);
        if (!hasLayer) continue;

        this.applyLayerZIndex({ li, layer, z, isTile, layersToMove });
      }

      const topZ = this.computeZIndex(0, false) + Z_INDEX.STEP;
      const pp = this.map.getPane("popupPane");
      if (pp) pp.style.zIndex = String(topZ + 1);
      const tp = this.map.getPane("tooltipPane");
      if (tp) tp.style.zIndex = String(topZ);
      // Keep markers (search/locate pins, ✕, data markers) above data layers
      // but below popup/tooltip. Data panes start at BASE (== markerPane 600),
      // so without this the whole markerPane would be hidden under overlays.
      const mp = this.map.getPane("markerPane");
      if (mp) mp.style.zIndex = String(topZ - 1);

      this.panes.migrateLayers(layersToMove);
      this.syncAttribution();
    } finally {
      this.isEnforcing = false;
    }
  }

  applyLayerZIndex({
    li,
    layer,
    z,
    isTile,
    layersToMove,
  }: {
    li: LayerInfo;
    layer: L.Layer;
    z: number;
    isTile: boolean;
    layersToMove: Array<{
      layer: L.Layer;
      paneName: string | null;
      renderer: L.SVG | null;
    }>;
  }) {
    const paneName = li.paneName;
    if (paneName) {
      const ep = this.panes.ensurePane(paneName, !isTile);
      ep.pane.style.zIndex = String(z);
      if (layer.options.pane !== paneName || !layer.options.paneSet)
        layersToMove.push({ layer, paneName, renderer: ep.renderer });
      this.panes.bumpLabelPanes(layer, z);
      return;
    }

    if (isTile) {
      (layer as L.TileLayer).setZIndex(z);
      return;
    }

    const childPanes = this.panes.discoverChildPanes(layer);
    if (childPanes.length > 0) {
      childPanes.forEach((cp: string) => {
        const needRenderer = !isTile && !this.panes.labelPanes.has(cp);
        const ep = this.panes.ensurePane(cp, needRenderer);
        ep.pane.style.zIndex = String(z);
      });
      this.panes.bumpLabelPanes(layer, z);
      layer.options.paneSet = true;
      return;
    }

    const fbName = `${FALLBACK_PANE_PREFIX}${L.stamp(layer)}`;
    this.panes.fallbackPaneMap.set(L.stamp(layer), fbName);
    const ep = this.panes.ensurePane(fbName, !isTile);
    ep.pane.style.zIndex = String(z);
    if (layer.options.pane !== fbName || !layer.options.paneSet)
      layersToMove.push({ layer, paneName: fbName, renderer: ep.renderer });
  }

  syncAttribution() {
    const attrCtrl = this.map.attributionControl;
    if (!attrCtrl) return;

    let topAttr = "";
    for (let i = 0; i < this.layers.length; i++) {
      const li = this.layers[i];
      if (!li.isBase) continue;
      const layer = this.findLayer(li);
      if (!(layer instanceof L.TileLayer) || !layer.options.attribution) continue;
      if (!topAttr && this.map.hasLayer(layer)) topAttr = layer.options.attribution;
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
    if (this.map.foliplus) this.map.foliplus.LayerAPI = null;
  }
}

export { LayerManager, patchBringToFront, unpatchBringToFront };
