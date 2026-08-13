import { debounce, type Debounced } from "#common/debounce.js";
import { dom } from "#common/dom.js";
import { createTranslator } from "#common/locale.js";
import * as Storage from "#common/storage.js";
import { throttleRaf } from "#common/throttle.js";
import * as CONST from "./LayerControl.const.js";
import { PaneManager } from "./LayerControl.pane.js";
import { LayerUI } from "./LayerControl.ui.js";
import * as Util from "./LayerControl.util.js";

// CONF is a free variable from the IIFE template wrapper (see BaseControl._get_template).
const foliplus = window.foliplus;
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
    if (this._path && this._path.parentNode)
      origBringToFront.call(this);
    return this;
  };
};

const unpatchBringToFront = () => {
  if (!isBringToFrontPatched) return;
  isBringToFrontPatched = false;
  L.Path.prototype.bringToFront = origBringToFront;
};

// Mutating methods blocked on the read-only view.
const MUTATING_METHODS = new Set([
  "push",
  "pop",
  "shift",
  "unshift",
  "splice",
  "reverse",
  "sort",
  "fill",
  "copyWithin",
]);

/**
 * Ordered layer info list with O(1) id index.
 *
 * **Public API (read-only, safe for external callers):**
 *   `size` / `at(i)` / `get(id)` / `has(id)` / `firstBaseIdx`
 *
 * **Internal (Manager only, not for external use):**
 *   `createLayerInfo` / `upsert` / `prepend` / `insertAt` / `remove`
 *   `moveToFront` / `reorder` / `replace` / `clear` / `normalizeGroups`
 *   `canReorderBetween` / `refreshFirstBaseIdx`
 *   `items` / `byId` / `view` / `list`
 *
 * External callers must use Manager API for mutations:
 *   `api.registerLayer({...})`   — insert/update
 *   `api.unregisterLayer(id)`    — remove
 *   `api.bringLayerToFront(id)`  — reorder
 */
class LayerRegistry {
  items: LayerInfo[];
  byId: Map<string, LayerInfo>;
  _firstBaseIdx: number;
  view: LayerInfo[];

  constructor(data: LayerInfo[] = [], map?: L.Map) {
    this.items = data.map(l => this.createLayerInfo(l, undefined, map));
    this.byId = new Map(this.items.map(l => [l.id, l]));
    this._firstBaseIdx = -1;
    this.refreshFirstBaseIdx();
    this.view = this.createReadonlyView();
  }

  /**
   * Create a layer info object with all fields populated.
   *
   * @param {Object} opts - Raw options from registerLayer().
   * @param {Object} [existingLi] - Existing layer info for re-registration.
   * @param {Object} [map] - Leaflet map. If provided, resolves `layer` from
   *   the map/window globals when `opts.layer` is absent.
   * @returns {Object} A complete layerInfo object.
   */
  createLayerInfo(opts: RegisterLayerOpts, existingLi?: LayerInfo, map?: L.Map): LayerInfo {
    return {
      name: opts.name ?? existingLi?.name ?? opts.id,
      id: opts.id,
      visible: opts.visible ?? existingLi?.visible ?? true,
      isBase: opts.isBase ?? existingLi?.isBase ?? false,
      paneName: opts.paneName ?? existingLi?.paneName ?? null,
      iconSvg: opts.iconSvg ?? existingLi?.iconSvg ?? null,
      type: null,
      layer:
        opts.layer ||
        (map && opts.id ? Util.findLayer(map, opts.id) : null) ||
        existingLi?.layer ||
        null,
      canvas: opts.canvas ?? existingLi?.canvas ?? null,
      onToggle: opts.onToggle ?? existingLi?.onToggle ?? null,
      onZIndex: opts.onZIndex ?? existingLi?.onZIndex ?? null,
    };
  }

  /** Recompute the cached first-base-layer index. */
  refreshFirstBaseIdx() {
    this._firstBaseIdx = this.items.findIndex(l => !!l.isBase);
  }

  /** Index of the first base layer, or -1 if none. */
  get firstBaseIdx() {
    return this._firstBaseIdx;
  }

  /** Create a read-only proxy over the internal array. */
  createReadonlyView() {
    return new Proxy(this.items, {
      set() {
        throw new TypeError(`[${CONF.name}] ${_(`${CONF.name}.readonly_error`)}`);
      },
      deleteProperty() {
        throw new TypeError(`[${CONF.name}] ${_(`${CONF.name}.readonly_del_error`)}`);
      },
      get(target, prop, receiver) {
        if (typeof prop === "string" && MUTATING_METHODS.has(prop)) {
          return () => {
            throw new TypeError(
              `[${CONF.name}] ${_(`${CONF.name}.readonly_method_error`).replace(`{method}`, prop)}`,
            );
          };
        }
        return Reflect.get(target, prop, receiver);
      },
    });
  }

  /** The ordered list array (read-only view; mutate via methods). */
  get list() {
    return this.view;
  }

  get size() {
    return this.items.length;
  }

  at(i: number) {
    return this.items[i];
  }

  get(id: string) {
    return this.byId.get(id);
  }

  has(id: string) {
    return this.byId.has(id);
  }

  indexOf(li: LayerInfo) {
    return this.items.indexOf(li);
  }

  /** Iterate in order (keeps `for...of` and spread working). */
  [Symbol.iterator]() {
    return this.items[Symbol.iterator]();
  }

  /** Insert or update in place — never reorders an existing layer. */
  upsert(layerInfo: LayerInfo): LayerInfo {
    const existing = this.byId.get(layerInfo.id);
    if (existing) {
      const idx = this.items.indexOf(existing);
      this.items[idx] = layerInfo;
    } else {
      this.items.push(layerInfo);
      this.refreshFirstBaseIdx();
    }
    this.byId.set(layerInfo.id, layerInfo);
    return layerInfo;
  }

  /** Insert at the front (used for new overlay layers). */
  prepend(layerInfo: LayerInfo): LayerInfo {
    this.items.unshift(layerInfo);
    this.byId.set(layerInfo.id, layerInfo);
    this.refreshFirstBaseIdx();
    return layerInfo;
  }

  /** Insert before the given index (used for new base layers). */
  insertAt(layerInfo: LayerInfo, idx: number): LayerInfo {
    this.items.splice(idx, 0, layerInfo);
    this.byId.set(layerInfo.id, layerInfo);
    this.refreshFirstBaseIdx();
    return layerInfo;
  }

  remove(id: string): LayerInfo | null {
    const li = this.byId.get(id);
    if (!li) return null;
    const idx = this.items.indexOf(li);
    if (idx !== -1) this.items.splice(idx, 1);
    this.byId.delete(id);
    this.refreshFirstBaseIdx();
    return li;
  }

  /** Move an existing layer to index 0 (bring to front). */
  moveToFront(id: string): LayerInfo | null {
    const li = this.byId.get(id);
    if (!li) return null;
    const idx = this.items.indexOf(li);
    if (idx <= 0) return li;
    this.items.splice(idx, 1);
    this.items.unshift(li);
    return li;
  }

  /** Swap order of two positions (drag-and-drop). */
  reorder(fromIdx: number, toIdx: number) {
    const [moved] = this.items.splice(fromIdx, 1);
    this.items.splice(toIdx, 0, moved);
  }

  /** Rebuild both list and index from a new ordered array. */
  replace(newList: LayerInfo[]) {
    this.items.splice(0, this.items.length, ...newList);
    this.byId = new Map(this.items.map(l => [l.id, l]));
    this.refreshFirstBaseIdx();
  }

  clear() {
    this.items.splice(0, this.items.length);
    this.byId.clear();
    this.refreshFirstBaseIdx();
  }

  /**
   * Reorder so all overlays come before all base layers. */
  normalizeGroups() {
    const overlays = [];
    const bases = [];
    for (const li of this.items) {
      if (li && li.isBase) bases.push(li);
      else overlays.push(li);
    }
    this.items.splice(0, this.items.length, ...overlays.concat(bases));
    this.byId = new Map(this.items.map(l => [l.id, l]));
    this.refreshFirstBaseIdx();
  }

  /**
   * Check whether a layer at fromIdx can be reordered to toIdx.
   * Only same-group (base↔base or overlay↔overlay) reordering is allowed. */
  canReorderBetween(fromIdx: number, toIdx: number): boolean {
    if (fromIdx == null || toIdx == null) return false;
    if (fromIdx < 0 || toIdx < 0) return false;
    if (fromIdx >= this.items.length || toIdx >= this.items.length) return false;
    const from = this.items[fromIdx];
    const to = this.items[toIdx];
    if (!from || !to) return false;
    if (!!from.isBase !== !!to.isBase) return false;

    const firstBaseIdx = this._firstBaseIdx;
    const hasBase = firstBaseIdx !== -1;

    if (!from.isBase) {
      const overlayEnd = hasBase ? firstBaseIdx - 1 : this.items.length - 1;
      return fromIdx <= overlayEnd && toIdx <= overlayEnd;
    }
    return hasBase && fromIdx >= firstBaseIdx && toIdx >= firstBaseIdx;
  }
}

/** Options for registerLayer. */
interface RegisterLayerOpts {
  id: string;
  name?: string | null;
  layer?: L.Layer | null;
  isBase?: boolean;
  paneName?: string | null;
  iconSvg?: string | null;
  visible?: boolean;
  canvas?: HTMLCanvasElement | null;
  onToggle?: ((visible: boolean) => void) | null;
  onZIndex?: ((z: number) => void) | null;
  [key: string]: unknown;
}

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
  onLayerAdd: (e: L.LeafletEvent) => void;
  getLayerPanes: (layer: L.Layer) => string[];

  constructor(mapInstance: L.Map, data: LayerInfo[]) {
    this.map = mapInstance;
    this.layerRegistry = new LayerRegistry(data, this.map);
    this.layers = this.layerRegistry.list;
    this.pendingRegistrations = [];
    this.uiContainer = null;

    // Bind method context
    this.registerLayer = this.registerLayer.bind(this);
    this.unregisterLayer = this.unregisterLayer.bind(this);
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

    this.onLayerAdd = e => {
      if (this.isDestroyed || e.layer === this.map || e.layer instanceof L.Renderer)
        return;

      if (
        !(e.layer instanceof L.Path || e.layer instanceof L.Marker) &&
        !e.layer.options?.paneName
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

    foliplus.LayerAPI = this as unknown as LayerAPI;
  }

  loadSavedOrder() {
    const data = Storage.load(CONST.STORAGE.ORDER_KEY, CONF.name);
    if (!data || !Array.isArray(data)) return;
    const layerMap = new Map(this.layers.map(l => [l.id, l]));
    const ordered: LayerInfo[] = [];
    for (const id of data) {
      if (layerMap.has(id)) {
        ordered.push(layerMap.get(id)!);
        layerMap.delete(id);
      }
    }
    this.layerRegistry.replace(ordered.concat([...layerMap.values()].filter((v): v is LayerInfo => v != null)));
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
    if (li.iconSvg) return CONST.GEOM_TYPE.CUSTOM;
    const layer = this.findLayer(li);
    if (!layer) return null;
    li.type = Util.getGeometryType(layer);
    return li.type;
  }

  /**
   * Get all registered layers of a given geometry type.
   * @param {string} type - "point" | "line" | "polygon" | "base"
   * @returns {Array<{id: string, name: string, layer: Object}>}
   */
  getLayersByType(type: string): Array<{ id: string; name: string; layer: L.Layer | null }> {
    return this.layers
      .filter(l => this.getLayerType(l.id) === type)
      .map(l => ({ id: l.id, name: l.name, layer: this.findLayer(l) }));
  }

  findLayer(idOrInfo: string | LayerInfo): L.Layer | null {
    const li =
      typeof idOrInfo === "string" ? this.layerRegistry.get(idOrInfo) : idOrInfo;
    if (li?.layer) return li.layer;
    return Util.findLayer(this.map, typeof idOrInfo === "string" ? idOrInfo : li?.id ?? "");
  }

  forEachLeaf(id: string, fn: (layer: L.Layer) => void) {
    const layer = this.findLayer(id);
    if (layer) Util.forEachLeaf(layer, fn);
  }

  /**
   * Extract all point markers from a registered layer by id.
   * @param {string} id - Layer ID.
   * @returns {Array<{lat: number, lng: number, marker: L.Marker|L.CircleMarker}>}
   */
  extractPoints(id: string): Array<{ lat: number; lng: number; marker: L.Marker | L.CircleMarker }> {
    const pts: Array<{ lat: number; lng: number; marker: L.Marker | L.CircleMarker }> = [];
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
    if (typeof (layer as any).clearLayers === "function") (layer as any).clearLayers();
    else if ((layer as any).eachLayer) (layer as any).eachLayer((l: L.Layer) => this.clearAllLayers(l));
  }

  createLayers(opts: CreateLayersOpts): CreateLayersAPI {
    const mainLayer = L.layerGroup();
    const graphLayer = opts.graphPane
      ? L.layerGroup([], { pane: opts.graphPane })
      : null;
    const labelLayer = opts.labelPane ? L.layerGroup() : null;
    if (labelLayer) (labelLayer as any).options.pane = opts.labelPane;
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

    mainLayer.addLayer = (layer: any) => {
      const isLabel = (layer as any).isLabel;
      const target = isLabel ? labelLayer : graphLayer;
      if (target) {
        if (!this.map.hasLayer(mainLayer)) register();
        const paneName = isLabel ? opts.labelPane : opts.graphPane;
        layer.options.pane = paneName;
        if (layer instanceof L.Path) {
          const { renderer } = this.panes.ensurePane(opts.graphPane!);
          (layer.options as any).renderer = renderer;
        } else if (paneName) this.panes.ensurePane(paneName, false);
        const result = target.addLayer(layer);
        this.panes.reset();
        return result;
      }
      return origAddLayer(layer);
    };

    mainLayer.removeLayer = (layer: any) => {
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

    (mainLayer as any).clearLayers = () => {
      if (graphLayer) graphLayer.clearLayers();
      if (labelLayer) labelLayer.clearLayers();
      if (this.map.hasLayer(mainLayer)) this.map.removeLayer(mainLayer);
      unregister();
    };

    const addLayer = (layer: any, isLabel?: boolean) => {
      if (isLabel) (layer as any).isLabel = true;
      mainLayer.addLayer(layer);
      return layer;
    };
    const removeLayer = (...items: any[]) => {
      items.forEach(l => {
        if (l != null) mainLayer.removeLayer(l);
      });
    };
    const clearLayers = () => {
      (mainLayer as any).clearLayers();
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
    (canvas as any).hooks = hooks;

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
        (onMove as any).cancel();
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
    const zBase = isTile ? CONST.Z_INDEX.TILE_BASE : CONST.Z_INDEX.BASE;
    return zBase + (this.layers.length - i) * CONST.Z_INDEX.STEP;
  }

  enforceOrder() {
    if (this.isEnforcing) return;
    this.isEnforcing = true;
    try {
      const layersToMove: Array<{ layer: any; paneName: string; renderer: any }> = [];
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

      const topZ = this.computeZIndex(0, false) + CONST.Z_INDEX.STEP;
      const pp = this.map.getPane("popupPane");
      if (pp) pp.style.zIndex = String(topZ + 1);
      const tp = this.map.getPane("tooltipPane");
      if (tp) tp.style.zIndex = String(topZ);

      this.panes.migrateLayers(layersToMove);
      this.syncAttribution();
    } finally {
      this.isEnforcing = false;
    }
  }

  applyLayerZIndex({ li, layer, z, isTile, layersToMove }: { li: any; layer: any; z: number; isTile: boolean; layersToMove: any[] }) {
    const paneName = li.paneName;
    if (paneName) {
      const ep = this.panes.ensurePane(paneName, !isTile);
      ep.pane.style.zIndex = String(z);
      if (layer.options.pane !== paneName || !layer.options.paneSet)
        layersToMove.push({ layer, paneName, renderer: ep.renderer });
      this.panes.bumpLabelPanes(layer, z);
      return;
    }

    if (isTile && typeof layer.setZIndex === "function") {
      layer.setZIndex(z);
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

    const fbName = `${CONST.FALLBACK_PANE_PREFIX}${L.stamp(layer)}`;
    this.panes.fallbackPaneMap.set(L.stamp(layer), fbName);
    const ep = this.panes.ensurePane(fbName, !isTile);
    ep.pane.style.zIndex = String(z);
    if (layer.options.pane !== fbName || !layer.options.paneSet)
      layersToMove.push({ layer, paneName: fbName, renderer: ep.renderer });
  }

  syncAttribution() {
    const attrCtrl = (this.map as any).attributionControl;
    if (!attrCtrl) return;

    let topAttr = "";
    for (let i = 0; i < this.layers.length; i++) {
      const li = this.layers[i];
      if (!li.isBase) continue;
      const layer = this.findLayer(li);
      if (!(layer instanceof L.TileLayer) || !(layer.options as any).attribution) continue;
      delete attrCtrl._attributions[(layer.options as any).attribution];
      if (!topAttr && this.map.hasLayer(layer)) topAttr = (layer.options as any).attribution;
    }

    if (topAttr) attrCtrl._attributions[topAttr] = 1;
    if (topAttr === this.lastAttribution) return;
    this.lastAttribution = topAttr;
    attrCtrl._update();
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
    if (this.debouncedEnforce) (this.debouncedEnforce as any).cancel();
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
    if (foliplus.LayerAPI === this) foliplus.LayerAPI = null;
  }
}

export { LayerManager, LayerRegistry, patchBringToFront, unpatchBringToFront };
