(function () {
  // ==================== Constants ====================
  const CONST = {
    name: "LayerControl",
    INIT_DELAY_MS: 300,
    ENFORCE_ORDER_DEBOUNCE_MS: 50,
    Z_INDEX: {
      BASE: 600,
      TILE_BASE: 200,
      STEP: 10,
    },
    RECURSION: {
      PANE_DEPTH: 5,
      LAYER_DEPTH: 10,
    },
    DRAG: {
      HINT_COOLDOWN_MS: 800,
    },
    STORAGE: {
      ORDER_KEY: "foliplus_layer_order",
      FOLD_KEY: "foliplus_fold_state",
    },
    COLOR: {
      MAP_ID: "foliplus_color_map",
      DEFAULT: "#cccccc",
    },
    RENDERER_KEY: "foliplus_renderer_",
    FALLBACK_PANE_PREFIX: "foliplus_pane_",
    CLASSES: {
      LAYER_ITEM: "foliplus-layer-item",
      ACTIVE: "active",
      CHECKBOX: "foliplus-checkbox",
      GROUP_FOLDED: "foliplus-layer-group-folded",
      COLOR_INPUT: "foliplus-color-layer-input",
      COLOR_ITEM: "foliplus-color-layer-item",
      HIDDEN: "hidden",
      DRAG_OVER_TOP: "foliplus-layer-drag-over-top",
      DRAG_OVER_BOTTOM: "foliplus-layer-drag-over-bottom",
      DRAGGING: "foliplus-layer-dragging",
      FOLD_BTN: "foliplus-layer-fold-btn",
      FOLDED: "foliplus-layer-folded",
      TYPE_ICON_COL: "foliplus-type-icon-col",
      TOGGLE_ALL: "foliplus-layer-toggle-all",
      FOLD_BTN_CTR: "foliplus-layer-sep",
      SEP_LABEL: "foliplus-layer-sep-label",
    },
    DATA: {
      INDEX: "data-index",
      LAYER_ID: "data-layer-id",
    },
    SEL: {
      LAYER_ITEM: ".foliplus-layer-item",
      COLOR_ITEM: ".foliplus-color-layer-item",
      COLOR_INPUT: ".foliplus-color-layer-input",
      TOGGLE_ALL: ".foliplus-layer-toggle-all",
    },
    GROUP: {
      OVERLAY: "overlay",
      BASE: "base",
    },
    GEOM_TYPE: {
      POINT: "point",
      LINE: "line",
      POLYGON: "polygon",
      EMPTY: "empty",
      UNKNOWN: "unknown",
    },
  };

  // ==================== Runtime Guard ====================
  const foliplus = window.foliplus || {};
  if (!foliplus || !foliplus.SVGs) {
    console.error(`[${CONST.name}] foliplus runtime not found, plugin disabled.`);
    return;
  }

  // ==================== Dependencies ====================
  const map = {{ this._parent.get_name() }};
  const mapContainer = map.getContainer();
  const _ = (k) => (foliplus.gt ? foliplus.gt(k) : k);

  // ==================== SVG Icons ====================
  const SVGs = {
    LAYERS: `
      <svg viewBox="0 0 24 24">
        <polygon points="12 2 22 7 12 12 2 7"/>
        <polygon points="2 11 12 16 22 11"/>
        <polygon points="2 16 12 21 22 16"/>
      </svg>`,
    DRAG_HANDLE: `
      <svg viewBox="0 0 24 24" class="drag-handle">
        <circle cx="8" cy="6" r="1.5" class="solid"/>
        <circle cx="16" cy="6" r="1.5" class="solid"/>
        <circle cx="8" cy="12" r="1.5" class="solid"/>
        <circle cx="16" cy="12" r="1.5" class="solid"/>
        <circle cx="8" cy="18" r="1.5" class="solid"/>
        <circle cx="16" cy="18" r="1.5" class="solid"/>
      </svg>`,
    POINT: `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="6"/></svg>`,
    LINE: `<svg viewBox="0 0 24 24"><path d="M4 20 L10 6 L16 18 L22 4"/></svg>`,
    POLYGON: `<svg viewBox="0 0 24 24"><polygon points="12,3 21,9 18,21 6,21 3,9"/></svg>`,
    EMPTY: `
      <svg viewBox="0 0 24 24">
        <rect x="4" y="4" width="16" height="16" rx="2" class="dashed"/>
      </svg>`,
    UNKNOWN: `
      <svg viewBox="0 0 24 24">
        <circle cx="12" cy="12" r="10" class="dashed"/>
        <path d="M9.5 9.5c0-1.5 1-2.5 2.5-2.5s2.5 1 2.5 2.5c0 1.5-2.5 2-2.5 4"
              fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
        <circle cx="12" cy="17" r="1.2" class="solid"/>
      </svg>`,
    COLOR: `
      <svg viewBox="0 0 24 24">
        <path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c1.1 0 2-.9 2-2v-1c0-.6.4-1 1-1h2c3.3 0 6-2.7 6-6 0-5.5-4.5-10-10-10z"/>
        <circle cx="7.5" cy="9.5" r="1.5" class="solid"/>
        <circle cx="12" cy="7" r="1.5" class="solid"/>
        <circle cx="16.5" cy="9.5" r="1.5" class="solid"/>
        <circle cx="16" cy="14" r="1" class="solid"/>
        <circle cx="8" cy="14" r="1" class="solid"/>
      </svg>`,
    FOLD: `<svg viewBox="0 0 24 24"><polyline points="18 15 12 9 6 15"/></svg>`,
    UNFOLD: `<svg viewBox="0 0 24 24"><polyline points="18 9 12 15 6 9"/></svg>`,
  };

  foliplus.registerHintIcon(CONST.name, SVGs.LAYERS);

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

  patchBringToFront();

  // ==================== Utility Class ====================
  class LayerUtils {
    static escapeHTML(str) {
      return String(str).replace(
        /[&<>"']/g,
        (m) =>
          ({
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
            '"': "&quot;",
            "'": "&#39;",
          })[m],
      );
    }

    static getGeometryType(layer) {
      const leaves = [];
      LayerUtils.forEachLeaf(layer, (l) => leaves.push(l));
      // No leaves at all → empty container (e.g. empty GeoDataFrame)
      if (leaves.length === 0) return CONST.GEOM_TYPE.EMPTY;

      let hasPoly = false,
        hasLine = false,
        hasPoint = false;
      for (const leaf of leaves) {
        if (leaf instanceof L.Polygon) hasPoly = true;
        else if (leaf instanceof L.Polyline) hasLine = true;
        else if (
          leaf instanceof L.Marker ||
          leaf instanceof L.CircleMarker ||
          leaf instanceof L.Circle
        )
          hasPoint = true;
      }
      // Has leaves but none match known types → unknown
      if (!hasPoly && !hasLine && !hasPoint) return CONST.GEOM_TYPE.UNKNOWN;
      // Mixed geometry types (e.g. GeometryCollection with Point+Line+Polygon) → unknown
      const typeCount = hasPoly + hasLine + hasPoint;
      if (typeCount > 1) return CONST.GEOM_TYPE.UNKNOWN;
      return hasPoly
        ? CONST.GEOM_TYPE.POLYGON
        : hasLine
          ? CONST.GEOM_TYPE.LINE
          : CONST.GEOM_TYPE.POINT;
    }

    static getTypeSVG(layer) {
      const type = this.getGeometryType(layer);
      if (type === CONST.GEOM_TYPE.POLYGON) return SVGs.POLYGON;
      if (type === CONST.GEOM_TYPE.LINE) return SVGs.LINE;
      if (type === CONST.GEOM_TYPE.POINT) return SVGs.POINT;
      if (type === CONST.GEOM_TYPE.EMPTY) return SVGs.EMPTY;
      return SVGs.UNKNOWN;
    }

    /** Resolve a layer by id from map._layers or window fallback. */
    static findLayer(map, id) {
      return (
        LayerManager.registry.get(id) ||
        (map._layers && map._layers[id]) ||
        window[id] ||
        null
      );
    }

    /**
     * Internal: walk a layer tree, optionally calling fn on containers.
     * @param {Object} layer - Leaflet layer.
     * @param {function} fn - Called for each visited node.
     * @param {number} depth - Internal recursion depth.
     * @param {boolean} leafOnly - If true, only call fn on non-container layers.
     */
    static traverse(layer, fn, depth, leafOnly) {
      if (!layer || depth > CONST.RECURSION.LAYER_DEPTH) return;
      const isContainer = typeof layer.eachLayer === "function";
      if (!leafOnly) fn(layer);
      if (isContainer)
        layer.eachLayer((c) => LayerUtils.traverse(c, fn, depth + 1, leafOnly));
      else if (layer._layers) {
        for (const k in layer._layers) {
          if (layer._layers.hasOwnProperty(k))
            LayerUtils.traverse(layer._layers[k], fn, depth + 1, leafOnly);
        }
      } else if (leafOnly) fn(layer);
    }

    /**
     * Walk every leaf (non-container) layer in a tree.
     * @param {Object} layer - Leaflet layer.
     * @param {function} fn - Called for each leaf with (leafLayer).
     * @param {number} [depth=0] - Internal recursion depth.
     */
    static forEachLeaf(layer, fn, depth = 0) {
      LayerUtils.traverse(layer, fn, depth, true);
    }

    /**
     * Walk all layers (including containers) in a tree, visiting each node.
     * @param {Object} layer - Leaflet layer.
     * @param {function} fn - Called for each node (container or leaf) with (nodeLayer).
     * @param {number} [depth=0] - Internal recursion depth.
     */
    static forEachLayer(layer, fn, depth = 0) {
      LayerUtils.traverse(layer, fn, depth, false);
    }
  }

  // ==================== Core Manager: LayerManager ====================
  class LayerManager {
    /** Shared registry: layerId → Leaflet layer. */
    static registry = new Map();

    constructor(mapInstance, initialData) {
      this.map = mapInstance;
      this.layers = [...initialData];
      this.typeMap = new Map();
      this.pendingRegistrations = [];
      this.uiContainer = null;

      this.isColorActive = false;
      this.currentColor = CONST.COLOR.DEFAULT;
      this.dragIdx = null;
      this.lastDragHintAt = 0;
      this.foldedGroups = new Set();

      // Bind method context to prevent 'this' loss when called via window.foliplus.LayerAPI
      this.registerLayer = this.registerLayer.bind(this);
      this.unregisterLayer = this.unregisterLayer.bind(this);
      this.getLayerType = this.getLayerType.bind(this);
      this.getLayersByType = this.getLayersByType.bind(this);
      this.findLayer = this.findLayer.bind(this);
      this.forEachLeaf = this.forEachLeaf.bind(this);
      this.extractPoints = this.extractPoints.bind(this);
      this.ensurePane = this.ensurePane.bind(this);
      this.isEnforcing = false;
      this.isDestroyed = false;

      this.defaultPanes = new Set([
        "overlayPane",
        "markerPane",
        "tilePane",
        "shadowPane",
        "mapPane",
      ]);
      this.fallbackPanes = new Set();
      this.labelPanes = new Set();

      // Cache for discoverChildPanes: layerId → string[] (pane names).
      this.paneCache = new Map();

      // UI Controller reference (set by LayerUI construction)
      this.ui = null;

      // Store callbacks keyed by layer id:
      this.layerCallbacks = new Map();

      this.debouncedEnforce = foliplus.debounce(() => {
        if (this.isDestroyed || !this.map || !this.map._container) return;
        this.enforceOrder();
      }, CONST.ENFORCE_ORDER_DEBOUNCE_MS);

      this.onLayerAdd = (e) => {
        if (
          this.isEnforcing ||
          this.isDestroyed ||
          e.layer === this.map ||
          e.layer instanceof L.Renderer
        )
          return;

        this.debouncedEnforce();
      };
      this.map.on("layeradd", this.onLayerAdd);

      this.loadSavedOrder();
      this.loadFoldState();
      this.normalizeLayerGroups();

      foliplus.LayerAPI = this;
    }

    normalizeLayerGroups() {
      const overlays = [];
      const bases = [];
      for (const l of this.layers) {
        if (l && l.isBase) bases.push(l);
        else overlays.push(l);
      }
      this.layers = overlays.concat(bases);
    }

    loadSavedOrder() {
      try {
        const data = localStorage.getItem(CONST.STORAGE.ORDER_KEY);
        if (!data) return;
        const ids = JSON.parse(data);
        if (!Array.isArray(ids)) return;
        const map = new Map(this.layers.map((l) => [l.id, l]));
        const ordered = [];
        for (const id of ids) {
          if (map.has(id)) {
            ordered.push(map.get(id));
            map.delete(id);
          }
        }
        this.layers = ordered.concat([...map.values()]);
      } catch (e) {
        console.warn(`[${CONST.name}] ${_(`${CONST.name}.load_order_fail`)}`, e);
      }
    }

    saveOrder() {
      try {
        localStorage.setItem(
          CONST.STORAGE.ORDER_KEY,
          JSON.stringify(this.layers.map((l) => l.id)),
        );
      } catch (e) {
        console.warn(`[${CONST.name}] ${_(`${CONST.name}.save_order_fail`)}`, e);
      }
    }

    loadFoldState() {
      try {
        const data = localStorage.getItem(CONST.STORAGE.FOLD_KEY);
        if (!data) return;
        const groups = JSON.parse(data);
        if (!Array.isArray(groups)) return;
        this.foldedGroups = new Set(groups);
      } catch (e) {
        console.warn(`[${CONST.name}] ${_(`${CONST.name}.load_fold_fail`)}`, e);
      }
    }

    saveFoldState() {
      try {
        localStorage.setItem(
          CONST.STORAGE.FOLD_KEY,
          JSON.stringify(Array.from(this.foldedGroups)),
        );
      } catch (e) {
        console.warn(`[${CONST.name}] ${_(`${CONST.name}.save_fold_fail`)}`, e);
      }
    }

    // ==================== Public API Methods ====================
    // These are exposed via window.foliplus.LayerAPI for runtime use.
    //
    // Usage:
    //   const api = window.foliplus.LayerAPI;
    //   api.registerLayer({ id: 'myLayer', name: 'My Layer', layer: leafletLayer });
    //   api.unregisterLayer('myLayer');
    //   api.findLayer('myLayer');
    //   const type = api.getLayerType('myLayer');
    //   const layers = api.getLayersByType('polygon');

    /**
     * Get the geometry type of a registered layer.
     * @param {string} id - Layer ID set when calling registerLayer().
     * @returns {string|null} "point" | "line" | "polygon" | "base" | null
     */
    getLayerType(id) {
      return this.typeMap.get(id)?.type ?? null;
    }

    /**
     * Get all registered layers of a given geometry type.
     * @param {string} type - "point" | "line" | "polygon" | "base"
     * @returns {Array<{id: string, name: string}>}
     */
    getLayersByType(type) {
      const result = [];
      for (const [id, info] of this.typeMap)
        if (info.type === type) result.push({ id, name: info.name });
      return result;
    }

    /**
     * Resolve a registered layer by id from map._layers or internal registry.
     * @param {string} id - Layer ID.
     * @returns {Object|null} Leaflet layer or null.
     */
    findLayer(id) {
      return LayerUtils.findLayer(this.map, id);
    }

    /**
     * Walk every leaf (non-container) layer in a registered layer tree.
     * @param {string} id - Layer ID.
     * @param {function} fn - Called for each leaf with (leafLayer).
     */
    forEachLeaf(id, fn) {
      const layer = this.findLayer(id);
      if (layer) LayerUtils.forEachLeaf(layer, fn);
    }

    /**
     * Extract all point markers (L.Marker / L.CircleMarker with .feature)
     * from a registered layer by id. Skips labels/annotations (no .feature)
     * and deduplicates by L.stamp to avoid double-counting.
     * @param {string} id - Layer ID.
     * @returns {Array<{lat: number, lng: number, marker: L.Marker|L.CircleMarker}>}
     */
    extractPoints(id) {
      const pts = [];
      const seen = {};
      this.forEachLeaf(id, (l) => {
        if (!(l instanceof L.Marker || l instanceof L.CircleMarker)) return;
        if (!l.feature) return;
        const stamp = L.stamp(l);
        if (seen[stamp]) return;
        seen[stamp] = true;
        const ll = l.getLatLng();
        pts.push({ lat: ll.lat, lng: ll.lng, marker: l });
      });
      return pts;
    }

    /**
     * Register (or re-register) a layer with the LayerManager.
     *
     * The layer appears at the top of the overlay list with a checkbox,
     * geometry type icon, and drag handle. If the UI has already been
     * rendered, a corresponding DOM item is created immediately.
     *
     * @param {Object} opts
     * @param {string} opts.id       - Unique identifier for the layer.
     * @param {string} [opts.name]   - Display name (falls back to id).
     * @param {Object} [opts.layer]  - Leaflet layer instance (L.Layer).
     * @param {boolean} [opts.isBase] - If true, grouped under "Base Map"
     *                                  separator. Draggable and multi-select
     *                                  like overlays.
     * @param {string} [opts.paneName] - Custom pane name for z-order grouping.
     * @param {string} [opts.iconSvg]  - Custom SVG icon HTML for the type column.
     * @returns {HTMLElement|null} The created DOM item, or null if UI not ready.
     */
    registerLayer(opts) {
      if (!opts?.id)
        throw new Error(`[${CONST.name}] ${_(`${CONST.name}.id_required`)}`);

      const existingIdx = this.layers.findIndex((l) => l.id === opts.id);
      const existingVisible =
        existingIdx !== -1 ? this.layers[existingIdx].visible : true;
      if (existingIdx !== -1) this.layers.splice(existingIdx, 1);

      const layerInfo = {
        name: opts.name ?? opts.id,
        id: opts.id,
        visible: existingVisible,
        isBase: !!opts.isBase,
        paneName: opts.paneName ?? null,
        iconSvg: opts.iconSvg ?? null,
      };
      if (layerInfo.isBase) {
        const firstBaseIdx = this.layers.findIndex((l) => !!l.isBase);
        if (firstBaseIdx === -1) this.layers.push(layerInfo);
        else this.layers.splice(firstBaseIdx, 0, layerInfo);
      } else this.layers.unshift(layerInfo);

      // Store callbacks for non-Leaflet layers (e.g. Canvas heatmap)
      const cbs = {};
      if (opts.onToggle) cbs.onToggle = opts.onToggle;
      if (opts.onZIndex) cbs.onZIndex = opts.onZIndex;
      if (Object.keys(cbs).length) this.layerCallbacks.set(opts.id, cbs);

      if (opts.paneName) this.ensurePane(opts.paneName);
      if (opts.layer) {
        for (const cp of this.discoverChildPanes(opts.layer))
          this.ensurePane(cp, !this.labelPanes.has(cp));

        if (/^(?:[a-zA-Z_$][a-zA-Z0-9_$]*)$/.test(opts.id))
          LayerManager.registry.set(opts.id, opts.layer);
        else
          console.warn(
            `[${CONST.name}] ${_(`${CONST.name}.invalid_id`).replace("{id}", opts.id)}`,
          );
      }
      this.paneCache.clear();
      if (
        opts.paneName &&
        opts.layer &&
        !(opts.layer instanceof L.Path || opts.layer instanceof L.Marker)
      ) {
        opts.layer.options.pane = opts.paneName;
        opts.layer.options.paneSet = true;
      }

      if (opts.layer && !this.map.hasLayer(opts.layer)) this.map.addLayer(opts.layer);
      this.enforceOrder();

      if (!this.uiContainer) {
        this.pendingRegistrations.push(opts);
        return null;
      }

      if (this.ui) {
        this.ui.renderInitialList();
        this.ui.initTypesAndVisibility();
      }
      this.saveOrder();
      return this.uiContainer.querySelector(`[${CONST.DATA.LAYER_ID}="${opts.id}"]`);
    }

    /**
     * Bring a registered layer to the front (top of z-order).
     *
     * Moves the layer to index 0 in the internal `this.layers` array,
     * re-runs enforceOrder() to recompute all pane z-indices, updates
     * the saved order, and moves the DOM item to the top of the list.
     *
     * @param {string} id - Layer ID previously passed to registerLayer().
     */
    bringLayerToFront(id) {
      const idx = this.layers.findIndex((l) => l.id === id);
      if (idx <= 0) return;
      const [item] = this.layers.splice(idx, 1);
      this.layers.unshift(item);
      this.enforceOrder();
      this.saveOrder();
      // Re-render the full list so DOM order matches `this.layers` order,
      // and re-init visibility to sync checkbox data-index attributes.
      if (this.uiContainer && this.ui) {
        this.ui.renderInitialList();
        this.ui.initTypesAndVisibility();
      }
    }

    /**
     * Unregister and remove a layer from the map and panel.
     *
     * Removes the Leaflet layer from the map, deletes the global reference,
     * and removes the corresponding DOM item from the layer list.
     *
     * @param {string} id - The layer ID previously passed to registerLayer().
     * @returns {boolean} true if layer was found and removed, false otherwise.
     */
    unregisterLayer(id) {
      const idx = this.layers.findIndex((l) => l.id === id);
      if (idx === -1) return false;
      this.layers.splice(idx, 1);

      const layer = LayerUtils.findLayer(this.map, id);
      if (layer && this.map.hasLayer(layer)) this.map.removeLayer(layer);
      LayerManager.registry.delete(id);
      this.paneCache.clear();
      // Recursively clear all sub-layers to prevent stale data on re-register
      this.clearAllLayers(layer);

      if (this.uiContainer) {
        const target = this.uiContainer.querySelector(
          `[${CONST.DATA.LAYER_ID}="${id}"]`,
        );
        if (target) {
          target.remove();
          if (this.ui) this.ui.reindexItems();
        }
      }
      requestAnimationFrame(() => this.map.invalidateSize({ animate: false }));
      this.layerCallbacks.delete(id);
      return true;
    }

    /** Recursively clear all nested sub-layers. */
    clearAllLayers(layer) {
      if (!layer) return;
      if (typeof layer.clearLayers === "function") layer.clearLayers();
      if (layer.eachLayer) layer.eachLayer((l) => this.clearAllLayers(l));
    }

    /**
     * Create a managed three-layer group (graph + label + main) for
     * components that need sub-layers with custom panes (e.g. MeasureControl).
     *
     * `mainLayer.addLayer()` is overridden to route layers by `.isLabel`:
     * - graph content (geometry) → `graphLayer`
     * - label content (divIcon markers) → `labelLayer`
     * When neither `graphPane` nor `labelPane` is given, behaves as a plain
     * `L.layerGroup` with auto-registration.
     *
     * Auto-registers with LayerControl on first content add, auto-unregisters
     * when empty.  The convenience `addLayer(layer, isLabel)` wrapper
     * sets `layer.isLabel = true` so `mainLayer.addLayer` routes correctly.
     *
     * @param {Object} opts
     * @param {string} opts.id         - Unique layer ID.
     * @param {string} opts.name       - Display name in LayerControl panel.
     * @param {string} [opts.graphPane] - Pane name for geometry (e.g. "measure_graph").
     * @param {string} [opts.labelPane] - Pane name for labels (e.g. "measure_label").
     * @param {string} [opts.iconSvg]  - SVG icon for the type column.
     * @returns {createLayersAPI}
     *
     * @typedef {Object} createLayersAPI
     * @property {L.layerGroup} mainLayer    - Root layer group (contains graphLayer + labelLayer).
     *   `.addLayer()` is overridden to route to sub-layers by `.isLabel`.
     * @property {Function} addLayer(layer, isLabel?) - Add a layer.  If `isLabel` is true,
     *   sets `layer.isLabel = true` so `mainLayer.addLayer` routes to `labelLayer`.
     *   Returns the layer for chaining.
     * @property {Function} removeLayer(...items) - Remove one or more layers. Null items
     *   silently skipped.  Auto-unregisters when all sub-layers are empty.
     * @property {Function} clearLayers()   - Clear all sub-layers, unregister from panel.
     * @property {Function} register()      - Register with LayerControl (auto-called on first
     *   `addLayer`).  Safe to call multiple times.
     * @property {Function} unregister()    - Unregister from LayerControl when empty.
     * @property {Function} registered()    - Returns `true` if currently registered.
     * @property {Function} bringToFront()  - Bring this layer to the top of z-order.
     */
    createLayers(opts) {
      const mainLayer = L.layerGroup();
      const graphLayer = opts.graphPane
        ? L.layerGroup([], { pane: opts.graphPane })
        : null;
      const labelLayer = opts.labelPane ? L.layerGroup() : null;
      if (labelLayer) labelLayer.options.pane = opts.labelPane;
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
          if (opts.labelPane) this.labelPanes.add(opts.labelPane);
        }
        this.registerLayer(layerOpts);
      };

      const unregister = () => {
        if (!registered) return;
        const hasContent =
          (graphLayer && Object.keys(graphLayer._layers || {}).length > 0) ||
          (labelLayer && Object.keys(labelLayer._layers || {}).length > 0);
        if (!hasContent) {
          registered = false;
          this.unregisterLayer(opts.id);
        }
      };

      // Save originals so overrides can fall back without recursion
      const origAddLayer = mainLayer.addLayer.bind(mainLayer);
      const origRemoveLayer = mainLayer.removeLayer.bind(mainLayer);

      // Override addLayer to route to sub-layers and auto-register on content.
      mainLayer.addLayer = (layer) => {
        const isLabel = layer.isLabel;
        const target = isLabel ? labelLayer : graphLayer;
        if (target) {
          // When mainLayer was off the map (e.g., user unchecked the layer
          // in LayerControl then clicked a tool), re-register the layer.
          // This re-checks the checkbox, re-adds mainLayer to the map,
          // and runs enforceOrder() for correct z-order.
          if (!this.map.hasLayer(mainLayer)) register();
          const paneName = isLabel ? opts.labelPane : opts.graphPane;
          layer.options.pane = paneName;
          if (layer instanceof L.Path) {
            const { renderer } = this.ensurePane(opts.graphPane);
            layer._renderer = renderer;
          } else if (paneName) this.ensurePane(paneName, false);
          return target.addLayer(layer);
        }
        return origAddLayer(layer);
      };

      mainLayer.removeLayer = (layer) => {
        if (graphLayer && graphLayer.hasLayer(layer))
          return graphLayer.removeLayer(layer);
        if (labelLayer && labelLayer.hasLayer(layer))
          return labelLayer.removeLayer(layer);
        return origRemoveLayer(layer);
      };

      mainLayer.clearLayers = () => {
        if (graphLayer) graphLayer.clearLayers();
        if (labelLayer) labelLayer.clearLayers();
        if (this.map.hasLayer(mainLayer)) this.map.removeLayer(mainLayer);
        unregister();
      };

      // ── Convenience API ──────────────────────────────────────────
      const addLayer = (layer, isLabel) => {
        if (isLabel) layer.isLabel = true;
        mainLayer.addLayer(layer);
        return layer;
      };
      const removeLayer = (...items) => {
        items.forEach((l) => {
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
     * Ensure a custom pane exists on the map.
     * Optionally creates an SVG renderer for Path layers.
     * @param {string} paneName - Pane name.
     * @param {boolean} [needRenderer=true] - Whether to create an SVG renderer.
     * @returns {Object} `{pane: HTMLElement, renderer: L.SVG|null}`
     */
    ensurePane(paneName, needRenderer = true) {
      let pane = this.map.getPane(paneName);
      if (!pane) {
        pane = this.map.createPane(paneName);
        pane.classList.add("foliplus-layer-pane");
        // Set an initial z-index so content in this pane is visible above
        // the base map before enforceOrder() runs (e.g., MeasureControl
        // dashed lines during drawing, before register() is called).
        // enforceOrder() will override this with the correct layer z-index
        // once the layer is registered.
        pane.style.zIndex = String(CONST.Z_INDEX.BASE);
      }
      let renderer = null;
      if (needRenderer) {
        const key = CONST.RENDERER_KEY + paneName;
        renderer = this.map[key];
        if (!renderer) {
          renderer = L.svg({ pane: paneName });
          renderer.addTo(this.map);
          this.map[key] = renderer;
        }
      }
      return { pane, renderer };
    }

    /**
     * Create a managed canvas element that tracks map pan/zoom.
     *
     * The canvas is placed inside `.leaflet-map-pane` and positioned at
     * `(-panX, -panY)` to cancel the mapPane CSS transform, making it
     * visually align with the viewport.  Drawing coordinates should use
     * `latLngToContainerPoint` (viewport-relative).
     *
     * Auto-registers with LayerControl on `register()`, auto-unregisters
     * on `unregister()` (clears content, hides canvas, removes panel entry).
     * The canvas hides itself via the `foliplus-heatmap-canvas.hidden` CSS class.
     *
     * Listens to map `move` (reposition) and `resize` (re-measure) events.
     * Call `destroy()` to remove all listeners and the canvas DOM element.
     *
     * @param {Object} opts
     * @param {string} opts.id       - Unique layer ID.
     * @param {string} [opts.name]   - Display name (falls back to id).
     * @param {string} [opts.iconSvg]   - SVG icon for the type column.
     * @param {string} [opts.className] - Extra CSS class for the canvas element.
     * @param {Function} [opts.onToggle] - Override visibility callback(visible).
     *   Default: toggles `foliplus-heatmap-canvas.hidden` class.
     * @param {Function} [opts.onZIndex] - Override z-index callback(z).
     *   Default: sets `canvas.style.zIndex`.
     * @returns {createCanvasAPI}
     *
     * @typedef {Object} createCanvasAPI
     * @property {HTMLCanvasElement} canvas  - Canvas element (in `.leaflet-map-pane`).
     * @property {CanvasRenderingContext2D} ctx - 2D drawing context.
     * @property {Function} resize()       - Re-measure container (respects DPR).
     *   Call after container size changes (e.g. panel expand/collapse).
     * @property {Function} getSize()      - Return `{width, height}` in CSS pixels.
     * @property {Function} updatePosition()- Recompute left/top from mapPane CSS
     *   transform offset.  Called automatically on map `move`.
     * @property {Function} register()     - Register in LayerControl panel.
     *   Calls `resize()` + `updatePosition()` + shows canvas.
     * @property {Function} unregister()   - Unregister, clear canvas, hide.
     *   Safe to call multiple times.
     * @property {Function} registered()   - Returns `true` if registered.
     * @property {Function} destroy()      - Remove canvas, unregister, cleanup
     *   listeners.  Call when the component is removed.
     * @property {Function} bringToFront() - Bring to top of z-order via
     *   LayerControl.
     * @property {Function} setZIndex(z)   - Set CSS z-index directly on canvas.
     * @property {Function} setVisible(v)  - Show/hide canvas via CSS class.
     */
    createCanvas(opts) {
      if (!opts?.id)
        throw new Error(`[${CONST.name}] ${_(`${CONST.name}.require_canvas_id`)}`);

      const mapPane = this.map._mapPane;
      if (!mapPane)
        throw new Error(`[${CONST.name}] ${_(`${CONST.name}.mapPane_not_available`)}`);

      const canvas = foliplus.dom.el("canvas", {
        class: "foliplus-heatmap-canvas",
        parent: mapPane,
      });
      if (opts.className) canvas.classList.add(opts.className);

      const ctx = canvas.getContext("2d");

      /** Resize canvas to match container dimensions (respecting DPR). */
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

      /** Update canvas left/top to cancel current mapPane transform offset. */
      const updatePosition = () => {
        const pos = L.DomUtil.getPosition(mapPane);
        canvas.style.left = `${-pos.x}px`;
        canvas.style.top = `${-pos.y}px`;
      };

      /** Get current canvas size in CSS pixels. */
      const getSize = () => {
        const container = this.map.getContainer();
        return { width: container.clientWidth, height: container.clientHeight };
      };

      resize();
      updatePosition();

      let registered = false;

      const onToggle =
        opts.onToggle ||
        ((visible) => {
          canvas.classList.toggle(CONST.CLASSES.HIDDEN, !visible);
        });

      const onZIndex =
        opts.onZIndex ||
        ((z) => {
          canvas.style.zIndex = String(z);
        });

      // Auto-unregister: unregister() clears the canvas content, hides it,
      // then removes the LayerControl entry.  Callers just call unregister().
      const unregister = () => {
        if (!registered) return;
        registered = false;
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        canvas.classList.add(CONST.CLASSES.HIDDEN);
        this.unregisterLayer(opts.id);
      };

      const layerOpts = {
        id: opts.id,
        name: opts.name || opts.id,
        iconSvg: opts.iconSvg || null,
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

      // Track map pan — update canvas position without redraw
      const onMove = () => updatePosition();
      this.map.on("move", onMove);

      // Track map resize — re-measure canvas
      const onResize = () => resize();
      this.map.on("resize", onResize);

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
          unregister();
          canvas.remove();
        },
        bringToFront: () => this.bringLayerToFront(opts.id),
        setZIndex: (z) => {
          canvas.style.zIndex = String(z);
        },
        setVisible: (v) => {
          canvas.classList.toggle(CONST.CLASSES.HIDDEN, !v);
        },
      };
    }

    // Core Sorting Engine
    setLayerPaneRecursive(layer, paneName, renderer) {
      // Skip Markers — both default icons (with shadow images) and divIcon.
      // Moving them to a custom pane breaks their shadow positioning.
      // They stay in Leaflet's default markerPane (z-index 600).
      LayerUtils.forEachLayer(layer, (l) => {
        if (l instanceof L.Marker) return;
        l.options.pane = paneName;
        l.options.paneSet = true;
        if (l instanceof L.Path) l.options.renderer = renderer;
      });
    }

    /** Find all custom panes used by a container's tree.
     *  Results are cached by layer stamp; call `paneCache.clear()`
     *  when layer structure changes (register/unregister). */
    discoverChildPanes(layer, depth = 0) {
      if (depth > CONST.RECURSION.PANE_DEPTH) return [];
      const key = L.stamp(layer);
      if (this.paneCache.has(key)) return this.paneCache.get(key);
      const panes = new Set();
      LayerUtils.forEachLayer(
        layer,
        (l) => {
          const p = l.options?.pane;
          if (p && !this.isDefaultPane(p)) panes.add(p);
        },
        depth,
      );
      const result = Array.from(panes);
      this.paneCache.set(key, result);
      return result;
    }

    isDefaultPane(pane) {
      return this.defaultPanes.has(pane) || this.fallbackPanes.has(pane);
    }

    /** Compute z-index for a layer at position i.
     *  The maximum z-index for any layer is `computeZIndex(0, false)`,
     *  used to bump popupPane above all managed panes. */
    computeZIndex(i, isTile) {
      const zBase = isTile ? CONST.Z_INDEX.TILE_BASE : CONST.Z_INDEX.BASE;
      return zBase + (this.layers.length - i) * CONST.Z_INDEX.STEP;
    }

    enforceOrder() {
      if (this.isEnforcing) return;
      this.isEnforcing = true;
      try {
        const layersToMove = [];
        let markerZ = 0;

        for (let i = 0; i < this.layers.length; i++) {
          const li = this.layers[i];
          const layer = LayerUtils.findLayer(this.map, li.id);
          const hasLayer = layer && this.map.hasLayer(layer);
          const isTile = layer instanceof L.TileLayer;
          const z = this.computeZIndex(i, isTile);

          // 1. Notify callback-only layers (e.g. Canvas heatmap)
          const cbs = this.layerCallbacks.get(li.id);
          if (cbs?.onZIndex) cbs.onZIndex(z);
          if (!hasLayer) continue;

          // 2. Apply z-index via the appropriate mechanism
          const zInfo = this.applyLayerZIndex({ li, layer, z, isTile, layersToMove });
          if (zInfo.markerZ) markerZ = Math.max(markerZ, zInfo.markerZ);
        }

        // Sync markerPane so unmanaged marker layers sit at correct z-order
        if (markerZ > 0) {
          const mp = this.map.getPane("markerPane");
          if (mp) mp.style.zIndex = markerZ;
        }

        // Bump popupPane above all managed panes so popups (e.g., marker
        // location popups) are never hidden behind graph or label panes.
        const pp = this.map.getPane("popupPane");
        if (pp)
          pp.style.zIndex = String(this.computeZIndex(0, false) + CONST.Z_INDEX.STEP);

        // 3. Migrate layers to their target panes
        this.migrateLayers(layersToMove);

        // 4. Sync attribution: only show the topmost visible base TileLayer's
        // attribution to avoid clutter when multiple base layers are visible.
        this.syncAttribution();
      } finally {
        this.isEnforcing = false;
      }
    }

    /** Bump label panes for a layer so labels render above paths.
     *  Used by both Mechanism A and Mechanism C. */
    bumpLabelPanes(layer, z) {
      const childPanes = this.discoverChildPanes(layer);
      childPanes.forEach((cp) => {
        if (this.labelPanes.has(cp)) {
          const lp = this.ensurePane(cp, false);
          lp.pane.style.zIndex = z + 1;
        }
      });
    }

    /** Apply z-index to a single layer using the appropriate mechanism. */
    applyLayerZIndex({ li, layer, z, isTile, layersToMove }) {
      const paneName = li.paneName;
      if (paneName) {
        // --- Mechanism A: Custom pane (Path layers with explicit paneName) ---
        const ep = this.ensurePane(paneName, !isTile);
        ep.pane.style.zIndex = z;
        if (layer.options.pane !== paneName || !layer.options.paneSet)
          layersToMove.push({ layer, paneName, renderer: ep.renderer });
        this.bumpLabelPanes(layer, z);
        return {};
      }

      if (isTile && typeof layer.setZIndex === "function") {
        // --- Mechanism B: TileLayer (Leaflet's own API) ---
        layer.setZIndex(z);
        return {};
      }

      // --- Mechanism C: Auto-discovered / fallback panes ---
      const childPanes = this.discoverChildPanes(layer);
      if (childPanes.length > 0) {
        // Three-layer components (HeatmapControl, MeasureControl, etc.)
        childPanes.forEach((cp) => {
          const ep = this.ensurePane(cp, !isTile);
          ep.pane.style.zIndex = z;
        });
        this.bumpLabelPanes(layer, z);
        layer.options.paneSet = true;
        return {};
      }

      // Unmanaged layer (GeoJSON, markers, etc.) → auto fallback pane
      const fbName = `${CONST.FALLBACK_PANE_PREFIX}${L.stamp(layer)}`;
      this.fallbackPanes.add(fbName);
      const ep = this.ensurePane(fbName, !isTile);
      ep.pane.style.zIndex = z;
      if (layer.options.pane !== fbName || !layer.options.paneSet)
        layersToMove.push({ layer, paneName: fbName, renderer: ep.renderer });
      return { markerZ: z };
    }

    migrateLayers(layersToMove) {
      if (!layersToMove.length) return;
      // Group by renderer container so we can batch-append via DocumentFragment.
      const groups = new Map();
      for (const { layer, paneName, renderer } of layersToMove) {
        if (!paneName) continue;
        this.setLayerPaneRecursive(layer, paneName, renderer);
        const container = renderer?._container;
        if (!container) continue;
        if (!groups.has(container)) groups.set(container, []);
        const collect = (l) => {
          if (l._path && l._path.parentNode !== container)
            groups.get(container).push(l._path);
          if (l.eachLayer) l.eachLayer(collect);
        };
        collect(layer);
      }
      // Batch-append per container to avoid repeated layout thrash
      for (const [container, paths] of groups) {
        if (!paths.length) continue;
        const frag = document.createDocumentFragment();
        for (const p of paths) frag.appendChild(p);
        container.appendChild(frag);
      }
    }

    // Live attribution: only show the topmost visible base TileLayer.
    // Prevents clutter when multiple base layers are overlapped.
    // Directly manipulates Leaflet's internal _attributions and calls _update()
    // so Leaflet's state stays consistent across layeradd/layerremove events.
    syncAttribution() {
      const attrCtrl = this.map.attributionControl;
      if (!attrCtrl) return;

      // Single pass: remove all base TileLayer attributions and track the topmost one
      let topAttr = "";
      for (let i = 0; i < this.layers.length; i++) {
        const li = this.layers[i];
        if (!li.isBase) continue;
        const layer = LayerUtils.findLayer(this.map, li.id);
        if (!(layer instanceof L.TileLayer) || !layer.options.attribution) continue;
        delete attrCtrl._attributions[layer.options.attribution];
        if (!topAttr && this.map.hasLayer(layer)) topAttr = layer.options.attribution;
      }

      // Re-add only the topmost visible one
      if (topAttr) attrCtrl._attributions[topAttr] = 1;
      attrCtrl._update();
    }

    // UI Rendering & Event Binding
    attachUI(containerDiv) {
      if (this.ui) this.ui.attachUI(containerDiv);
    }

    /** Check whether a layer at fromIdx can be reordered to toIdx.
     *  Only same-group (base↔base or overlay↔overlay) reordering is allowed. */
    canReorderBetween(fromIdx, toIdx) {
      if (fromIdx == null || toIdx == null) return false;
      if (fromIdx < 0 || toIdx < 0) return false;
      if (fromIdx >= this.layers.length || toIdx >= this.layers.length) return false;
      const from = this.layers[fromIdx];
      const to = this.layers[toIdx];
      if (!from || !to) return false;
      if (!!from.isBase !== !!to.isBase) return false;

      const firstBaseIdx = this.layers.findIndex((l) => !!l.isBase);
      const hasBase = firstBaseIdx !== -1;

      if (!from.isBase) {
        const overlayEnd = hasBase ? firstBaseIdx - 1 : this.layers.length - 1;
        return fromIdx <= overlayEnd && toIdx <= overlayEnd;
      }
      return hasBase && fromIdx >= firstBaseIdx && toIdx >= firstBaseIdx;
    }

    /** Release all resources. Called by LayerControl.onRemove(). */
    destroy() {
      this.isDestroyed = true;
      if (this.map && this.onLayerAdd) this.map.off("layeradd", this.onLayerAdd);
      if (this.debouncedEnforce) this.debouncedEnforce.cancel();
      if (this.uiContainer) {
        this.uiContainer.innerHTML = "";
        this.uiContainer = null;
      }
      this.layers = [];
      this.typeMap.clear();
      this.layerCallbacks.clear();
      this.pendingRegistrations = [];
      this.paneCache.clear();
      this.ui = null;
      LayerManager.registry.clear();
      if (foliplus.LayerAPI === this) foliplus.LayerAPI = null;
    }
  }

  // ==================== UI Controller: LayerUI ====================
  class LayerUI {
    constructor(manager) {
      this.manager = manager;
    }

    /** Alias for convenience */
    get m() {
      return this.manager;
    }

    /**
     * Attach UI to the given container div.
     * @param {HTMLElement} containerDiv - The panel-content div.
     */
    attachUI(containerDiv) {
      this.m.uiContainer = containerDiv;
      this.renderInitialList();
      this.bindEvents();

      while (this.m.pendingRegistrations.length)
        this.m.registerLayer(this.m.pendingRegistrations.shift());

      setTimeout(() => this.initTypesAndVisibility(), CONST.INIT_DELAY_MS);
    }

    renderInitialList() {
      const frag = document.createDocumentFragment();
      let hasBaseMaps = false;
      let hasOverlays = false;

      for (let i = 0; i < this.m.layers.length; i++) {
        const l = this.m.layers[i];
        if (!l.isBase && !hasOverlays) {
          hasOverlays = true;
          frag.appendChild(
            this.renderToggleAllRow(
              CONST.GROUP.OVERLAY,
              `${CONST.name}.data_layer_label`,
            ),
          );
        }
        if (l.isBase && !hasBaseMaps) {
          hasBaseMaps = true;
          frag.appendChild(
            this.renderToggleAllRow(CONST.GROUP.BASE, `${CONST.name}.base_map_label`),
          );
        }
        const group = l.isBase ? CONST.GROUP.BASE : CONST.GROUP.OVERLAY;
        const item = this.renderLayerItem(l, i);
        if (this.m.foldedGroups.has(group))
          item.classList.add(CONST.CLASSES.GROUP_FOLDED);
        frag.appendChild(item);
      }

      const colorItem = this.renderColorLayerItem();
      if (this.m.foldedGroups.has(CONST.GROUP.BASE))
        colorItem.classList.add(CONST.CLASSES.GROUP_FOLDED);
      frag.appendChild(colorItem);

      this.m.uiContainer.innerHTML = "";
      this.m.uiContainer.appendChild(frag);
    }

    renderToggleAllRow(group, labelKey) {
      const isFolded = this.m.foldedGroups.has(group);
      return foliplus.dom.el(
        "div",
        {
          class:
            `${CONST.CLASSES.FOLD_BTN_CTR} ${CONST.CLASSES.TOGGLE_ALL}` +
            (isFolded ? ` ${CONST.CLASSES.FOLDED}` : ""),
          "data-group": group,
        },
        foliplus.dom.el(
          "button",
          {
            class: CONST.CLASSES.FOLD_BTN,
            title: _(`${CONST.name}.${isFolded ? "unfold_tooltip" : "fold_tooltip"}`),
          },
          { html: isFolded ? SVGs.UNFOLD : SVGs.FOLD },
        ),
        foliplus.dom.el(
          "div",
          { class: CONST.CLASSES.CHECKBOX },
          foliplus.dom.el("input", {
            type: "checkbox",
            "data-role": "toggle-all",
            checked: "",
          }),
        ),
        foliplus.dom.el("span", { class: CONST.CLASSES.SEP_LABEL }, _(labelKey)),
        foliplus.dom.el("div", { class: "foliplus-section-divider" }),
      );
    }

    renderLayerItem(l, index) {
      const en = LayerUtils.escapeHTML(l.name);
      const children = [
        { html: SVGs.DRAG_HANDLE },
        foliplus.dom.el(
          "div",
          { class: CONST.CLASSES.CHECKBOX },
          foliplus.dom.el("input", {
            type: "checkbox",
            checked: "",
            [CONST.DATA.INDEX]: String(index),
            "aria-label": en,
          }),
        ),
        foliplus.dom.el("label", { title: en }, en),
      ];
      if (l.iconSvg)
        children.push({
          html: `<div class="${CONST.CLASSES.TYPE_ICON_COL}">${l.iconSvg}</div>`,
        });
      else
        children.push(foliplus.dom.el("div", { class: CONST.CLASSES.TYPE_ICON_COL }));
      return foliplus.dom.el(
        "div",
        {
          class: CONST.CLASSES.LAYER_ITEM,
          draggable: "true",
          [CONST.DATA.INDEX]: String(index),
          [CONST.DATA.LAYER_ID]: l.id,
          "data-layer-type": l.isBase ? CONST.GROUP.BASE : CONST.GROUP.OVERLAY,
          title: en,
        },
        ...children,
      );
    }

    renderColorLayerItem() {
      return foliplus.dom.el(
        "div",
        {
          class: `${CONST.CLASSES.LAYER_ITEM} ${CONST.CLASSES.COLOR_ITEM}`,
          draggable: "false",
          [CONST.DATA.LAYER_ID]: CONST.COLOR.MAP_ID,
          title: _(`${CONST.name}.color_map_label`),
        },
        { html: SVGs.DRAG_HANDLE },
        foliplus.dom.el(
          "div",
          { class: CONST.CLASSES.CHECKBOX },
          foliplus.dom.el("input", {
            type: "color",
            class: CONST.CLASSES.COLOR_INPUT,
            value: this.m.currentColor,
            "aria-label": _(`${CONST.name}.color_map_label`),
          }),
        ),
        foliplus.dom.el("label", null, _(`${CONST.name}.color_map_label`)),
        { html: `<div class="${CONST.CLASSES.TYPE_ICON_COL}">${SVGs.COLOR}</div>` },
      );
    }

    initTypesAndVisibility() {
      const inputs = this.m.uiContainer.querySelectorAll(
        `${CONST.SEL.LAYER_ITEM} input[type="checkbox"], ${CONST.SEL.LAYER_ITEM} input[type="radio"]`,
      );
      const typeCols = this.m.uiContainer.querySelectorAll(
        `.${CONST.CLASSES.TYPE_ICON_COL}`,
      );
      let anyBaseVisible = false;

      for (let i = 0; i < this.m.layers.length; i++) {
        const layerInfo = this.m.layers[i];
        const id = layerInfo.id;
        const layer = LayerUtils.findLayer(this.m.map, id);

        if (inputs[i]) {
          const hasLayer = layer != null;
          const isCallbackOnly = !hasLayer && this.m.layerCallbacks.has(id);
          if (isCallbackOnly) inputs[i].checked = layerInfo.visible !== false;
          else inputs[i].checked = hasLayer && this.m.map.hasLayer(layer);

          const item = inputs[i].closest(CONST.SEL.LAYER_ITEM);
          if (item) {
            if (inputs[i].checked) item.classList.add(CONST.CLASSES.ACTIVE);
            else item.classList.remove(CONST.CLASSES.ACTIVE);
          }
        }

        if (typeCols[i]) {
          if (layerInfo.isBase) {
            typeCols[i].innerHTML = foliplus.SVGs.GLOBE;
            typeCols[i].title = _(`${CONST.name}.type_base`);
            this.m.typeMap.set(id, { type: CONST.GROUP.BASE, name: layerInfo.name });
            if (inputs[i]?.checked) anyBaseVisible = true;
          } else if (layerInfo.iconSvg) {
            typeCols[i].innerHTML = layerInfo.iconSvg;
            typeCols[i].title = _(`${CONST.name}.type_custom`);
            this.m.typeMap.set(id, { type: "custom", name: layerInfo.name });
          } else if (layer) {
            const gtype = LayerUtils.getGeometryType(layer);
            typeCols[i].innerHTML = LayerUtils.getTypeSVG(layer);
            typeCols[i].title = _(`${CONST.name}.type_${gtype}`);
            this.m.typeMap.set(id, { type: gtype, name: layerInfo.name });
          }
        }
      }

      if (!anyBaseVisible) this.showColorLayer(this.m.currentColor);
      this.m.enforceOrder();
      this.syncToggleAll(CONST.GROUP.OVERLAY);
      this.syncToggleAll(CONST.GROUP.BASE);
    }

    reindexItems() {
      const items = this.m.uiContainer.querySelectorAll(
        `${CONST.SEL.LAYER_ITEM}:not(${CONST.SEL.COLOR_ITEM})`,
      );
      for (let i = 0; i < items.length; i++) {
        items[i].dataset.index = String(i);
        const cb = items[i].querySelector('input[type="checkbox"]');
        if (cb) cb.dataset.index = String(i);
      }
    }

    bindEvents() {
      this.m.uiContainer.addEventListener("change", (e) => {
        // Route: toggle-all checkbox vs. individual layer checkbox vs. color input
        const cb = e.target.closest('[data-role="toggle-all"]');
        if (cb) {
          const row = cb.closest(CONST.SEL.TOGGLE_ALL);
          this.toggleAll(row.dataset.group, cb.checked);
          return;
        }
        this.handleChange(e);
      });
      this.m.uiContainer.addEventListener("input", (e) => this.handleInput(e));
      this.m.uiContainer.addEventListener("click", (e) => {
        // Color layer item → deselect bases
        if (e.target.closest(CONST.SEL.COLOR_ITEM)) {
          this.deselectAllBaseMaps(-1);
          this.showColorLayer(this.m.currentColor);
          this.syncToggleAll(CONST.GROUP.BASE);
          this.m.enforceOrder();
          return;
        }
        // Fold toggle (toggle-all-item row, excluding its checkbox)
        const row = e.target.closest(CONST.SEL.TOGGLE_ALL);
        if (!row || e.target.closest('[data-role="toggle-all"]')) return;
        const group = row.dataset.group;
        if (this.m.foldedGroups.has(group)) this.m.foldedGroups.delete(group);
        else this.m.foldedGroups.add(group);
        this.renderInitialList();
        this.initTypesAndVisibility();
        this.m.saveFoldState();
      });
      this.m.uiContainer.addEventListener("dragstart", (e) => this.handleDragStart(e));
      this.m.uiContainer.addEventListener("dragover", (e) => this.handleDragOver(e));
      this.m.uiContainer.addEventListener("dragleave", (e) => this.handleDragLeave(e));
      this.m.uiContainer.addEventListener("drop", (e) => this.handleDrop(e));
      this.m.uiContainer.addEventListener("dragend", (e) => this.handleDragEnd(e));
    }

    getLayerItems(group) {
      return this.m.uiContainer.querySelectorAll(
        `${CONST.SEL.LAYER_ITEM}${group === CONST.GROUP.BASE ? `[data-layer-type="${CONST.GROUP.BASE}"]` : `:not([data-layer-type="${CONST.GROUP.BASE}"]):not(${CONST.SEL.COLOR_ITEM})`}`,
      );
    }

    toggleAll(group, newState) {
      const items = this.getLayerItems(group);
      items.forEach((item) => {
        const cb = item.querySelector('input[type="checkbox"]');
        if (!cb) return;
        const idx = parseInt(cb.dataset.index, 10);
        if (isNaN(idx) || idx < 0 || idx >= this.m.layers.length) return;
        const layerInfo = this.m.layers[idx];
        const layer = LayerUtils.findLayer(this.m.map, layerInfo.id);

        cb.checked = newState;
        if (newState) item.classList.add(CONST.CLASSES.ACTIVE);
        else item.classList.remove(CONST.CLASSES.ACTIVE);

        if (layer)
          newState ? this.m.map.addLayer(layer) : this.m.map.removeLayer(layer);

        const cbs = this.m.layerCallbacks.get(layerInfo.id);
        if (cbs && cbs.onToggle) cbs.onToggle(newState);

        if (!layer) layerInfo.visible = newState;
      });

      if (group === CONST.GROUP.BASE && !newState) {
        this.hideColorLayer();
        this.showColorLayer(this.m.currentColor);
      } else if (group === CONST.GROUP.BASE && newState) this.hideColorLayer();

      this.syncToggleAll(group);
      this.m.enforceOrder();
    }

    syncToggleAll(group) {
      const row = this.m.uiContainer.querySelector(
        `${CONST.SEL.TOGGLE_ALL}[data-group="${group}"]`,
      );
      if (!row) return;
      const allCb = row.querySelector('[data-role="toggle-all"]');
      if (!allCb) return;
      const items = this.getLayerItems(group);
      const checkedCount = Array.from(items).filter((item) => {
        const cb = item.querySelector('input[type="checkbox"]');
        return cb && cb.checked;
      }).length;
      const allChecked = items.length > 0 && checkedCount === items.length;
      const noneChecked = checkedCount === 0;
      allCb.checked = allChecked;
      allCb.indeterminate = !allChecked && !noneChecked;
    }

    handleChange(e) {
      const target = e.target;
      if (target.classList.contains(CONST.CLASSES.COLOR_INPUT)) {
        this.deselectAllBaseMaps(-1);
        this.showColorLayer(target.value);
        this.syncToggleAll(CONST.GROUP.BASE);
        this.m.enforceOrder();
        return;
      }
      if (target.tagName.toLowerCase() !== "input" || target.type !== "checkbox")
        return;

      const idx = parseInt(target.dataset.index, 10);
      if (isNaN(idx) || idx < 0 || idx >= this.m.layers.length) return;
      const layerInfo = this.m.layers[idx];
      const layer = LayerUtils.findLayer(this.m.map, layerInfo.id);
      const item = target.closest(CONST.SEL.LAYER_ITEM);

      if (layerInfo.isBase) this.hideColorLayer();
      if (layer)
        target.checked ? this.m.map.addLayer(layer) : this.m.map.removeLayer(layer);
      if (item)
        target.checked
          ? item.classList.add(CONST.CLASSES.ACTIVE)
          : item.classList.remove(CONST.CLASSES.ACTIVE);

      const cbs = this.m.layerCallbacks.get(layerInfo.id);
      if (cbs && cbs.onToggle) cbs.onToggle(target.checked);
      if (!layer) layerInfo.visible = target.checked;

      this.syncToggleAll(layerInfo.isBase ? CONST.GROUP.BASE : CONST.GROUP.OVERLAY);
      this.m.enforceOrder();
    }

    handleInput(e) {
      if (e.target.classList.contains(CONST.CLASSES.COLOR_INPUT))
        this.showColorLayer(e.target.value);
    }

    handleDragStart(e) {
      const item = e.target.closest(CONST.SEL.LAYER_ITEM);
      if (!item) return;
      this.m.dragIdx = parseInt(item.dataset.index, 10);
      item.classList.add(CONST.CLASSES.DRAGGING);
      e.dataTransfer.effectAllowed = "move";
    }

    showReorderBlockedHint() {
      const now = Date.now();
      if (now - this.m.lastDragHintAt < CONST.DRAG.HINT_COOLDOWN_MS) return;
      this.m.lastDragHintAt = now;
      foliplus.showHint(
        CONST.name,
        _(`${CONST.name}.reorder_group_only`),
        foliplus.HINT_DURATION.SHORT,
      );
    }

    handleDragOver(e) {
      if (this.m.dragIdx === null) return;
      e.preventDefault();
      const item = e.target.closest(CONST.SEL.LAYER_ITEM);
      if (!item || item.classList.contains(CONST.CLASSES.COLOR_ITEM)) return;

      const targetIdx = parseInt(item.dataset.index, 10);
      const allItems = this.m.uiContainer.querySelectorAll(CONST.SEL.LAYER_ITEM);
      allItems.forEach((i) =>
        i.classList.remove(CONST.CLASSES.DRAG_OVER_TOP, CONST.CLASSES.DRAG_OVER_BOTTOM),
      );

      if (!this.m.canReorderBetween(this.m.dragIdx, targetIdx)) {
        if (e.dataTransfer) e.dataTransfer.dropEffect = "none";
        this.showReorderBlockedHint();
        return;
      }
      if (e.dataTransfer) e.dataTransfer.dropEffect = "move";

      if (targetIdx < this.m.dragIdx) item.classList.add(CONST.CLASSES.DRAG_OVER_TOP);
      else if (targetIdx > this.m.dragIdx)
        item.classList.add(CONST.CLASSES.DRAG_OVER_BOTTOM);
    }

    handleDragLeave(e) {
      const item = e.target.closest(CONST.SEL.LAYER_ITEM);
      if (item)
        item.classList.remove(
          CONST.CLASSES.DRAG_OVER_TOP,
          CONST.CLASSES.DRAG_OVER_BOTTOM,
        );
    }

    handleDrop(e) {
      e.preventDefault();
      const target = e.target.closest(CONST.SEL.LAYER_ITEM);
      if (this.m.dragIdx === null) return;
      if (!target || target.classList.contains(CONST.CLASSES.COLOR_ITEM)) return;

      if (this.m.dragIdx < 0 || this.m.dragIdx >= this.m.layers.length) {
        this.m.dragIdx = null;
        return;
      }

      const targetIdx = parseInt(target.dataset.index, 10);
      if (this.m.dragIdx === targetIdx) return;
      if (!this.m.canReorderBetween(this.m.dragIdx, targetIdx)) {
        this.showReorderBlockedHint();
        return;
      }

      const moved = this.m.layers.splice(this.m.dragIdx, 1)[0];
      this.m.layers.splice(targetIdx, 0, moved);

      const movedItem = this.m.uiContainer.querySelector(
        `[${CONST.DATA.LAYER_ID}="${CSS.escape(moved.id)}"]`,
      );
      if (!movedItem) {
        this.m.dragIdx = null;
        return;
      }

      if (targetIdx < this.m.dragIdx) target.parentNode.insertBefore(movedItem, target);
      else target.parentNode.insertBefore(movedItem, target.nextSibling);

      this.reindexItems();
      this.m.enforceOrder();
      this.m.saveOrder();
      this.m.dragIdx = null;
    }

    handleDragEnd() {
      const allItems = this.m.uiContainer.querySelectorAll(CONST.SEL.LAYER_ITEM);
      allItems.forEach((i) =>
        i.classList.remove(
          CONST.CLASSES.DRAGGING,
          CONST.CLASSES.DRAG_OVER_TOP,
          CONST.CLASSES.DRAG_OVER_BOTTOM,
        ),
      );
    }

    showColorLayer(color) {
      this.m.isColorActive = true;
      this.m.currentColor = color;
      mapContainer.style.setProperty("--color-layer-bg", color);
      mapContainer.classList.add(CONST.CLASSES.ACTIVE);

      for (let i = 0; i < this.m.layers.length; i++) {
        if (this.m.layers[i].isBase) {
          const bLayer = LayerUtils.findLayer(this.m.map, this.m.layers[i].id);
          if (bLayer && this.m.map.hasLayer(bLayer)) this.m.map.removeLayer(bLayer);
        }
      }

      const tilePane = this.m.map.getPane("tilePane");
      if (tilePane) tilePane.classList.add("foliplus-layer-tile-hidden");

      const inputs = this.m.uiContainer.querySelectorAll(
        `${CONST.SEL.LAYER_ITEM}:not(${CONST.SEL.COLOR_ITEM}) input`,
      );
      inputs.forEach((input, j) => {
        if (this.m.layers[j]?.isBase) {
          input.checked = false;
          input.closest(CONST.SEL.LAYER_ITEM)?.classList.remove(CONST.CLASSES.ACTIVE);
        }
      });

      const ci = this.m.uiContainer.querySelector(CONST.SEL.COLOR_INPUT);
      if (ci) ci.value = color;
      this.m.uiContainer
        .querySelector(CONST.SEL.COLOR_ITEM)
        ?.classList.add(CONST.CLASSES.ACTIVE);
      this.syncToggleAll(CONST.GROUP.BASE);
    }

    hideColorLayer() {
      this.m.isColorActive = false;
      mapContainer.classList.remove(CONST.CLASSES.ACTIVE);
      mapContainer.style.removeProperty("--color-layer-bg");
      const tilePane = this.m.map.getPane("tilePane");
      if (tilePane) tilePane.classList.remove("foliplus-layer-tile-hidden");
      this.m.uiContainer
        .querySelector(CONST.SEL.COLOR_ITEM)
        ?.classList.remove(CONST.CLASSES.ACTIVE);
    }

    deselectAllBaseMaps(exceptIdx) {
      const inputs = this.m.uiContainer.querySelectorAll(
        `${CONST.SEL.LAYER_ITEM}:not(${CONST.SEL.COLOR_ITEM}) input`,
      );
      for (let i = 0; i < this.m.layers.length; i++) {
        if (this.m.layers[i].isBase && i !== exceptIdx) {
          const bLayer = LayerUtils.findLayer(this.m.map, this.m.layers[i].id);
          if (bLayer && this.m.map.hasLayer(bLayer)) this.m.map.removeLayer(bLayer);
          if (inputs[i]) {
            inputs[i].checked = false;
            inputs[i]
              .closest(CONST.SEL.LAYER_ITEM)
              ?.classList.remove(CONST.CLASSES.ACTIVE);
          }
        }
      }
    }
  }

  // ==================== Initialize Manager with Data ====================
  const initialData = [];
  {%- for key, val in this.overlays.items() %};
  initialData.push({
    name: {{ key | tojson }},
    id: "{{ val }}",
    visible: true,
    isBase: false,
  });
  {%- endfor %};
  {%- for key, val in this.base_layers.items() %};
  initialData.push({
    name: {{ key | tojson }},
    id: "{{ val }}",
    visible: true,
    isBase: true,
  });
  {%- endfor %};

  const layerManager = new LayerManager(map, initialData);
  layerManager.ui = new LayerUI(layerManager);

  // ==================== Leaflet Control Definition ====================
  class LayerControl extends L.Control {
    constructor(options) {
      super(options);
      this.manager = layerManager;
    }

    onAdd() {
      const container = foliplus.dom.el("div", {
        class: "leaflet-bar leaflet-control",
      });

      container.innerHTML = `
        <div class="foliplus-panel foliplus-ctrl-fold foliplus-layer-ctrl collapsed"
             id="{{ this.get_name() }}_ctrl">
          <button class="foliplus-toggle-btn" title="${_(`${CONST.name}.toggle_title`)}"
                  aria-label="${_(`${CONST.name}.toggle_title`)}">
            ${SVGs.LAYERS}
          </button>
          <div class="foliplus-layer-panel" role="dialog" aria-label="${_(`${CONST.name}.panel_title`)}">
            <div class="foliplus-panel-header" title="${_(`${CONST.name}.close_title`)}">
              <span class="foliplus-header-title">
                <span class="foliplus-header-icon">${SVGs.LAYERS}</span>
                ${_(`${CONST.name}.panel_title`)}
              </span>
              <button class="foliplus-ctrl-btn" title="${_(`${CONST.name}.close_title`)}"
                      aria-label="${_(`${CONST.name}.close_title`)}">
                ${foliplus.SVGs.CLOSE}
              </button>
            </div>
            <div class="foliplus-panel-content"></div>
          </div>
        </div>
      `;

      L.DomEvent.disableClickPropagation(container);
      L.DomEvent.disableScrollPropagation(container);

      foliplus.bindPanelToggle({
        container: container.querySelector(".foliplus-layer-ctrl"),
        toggleBtn: ".foliplus-toggle-btn",
        header: ".foliplus-panel-header",
      });

      this.manager.attachUI(container.querySelector(".foliplus-panel-content"));

      return container;
    }

    onRemove() {
      this.manager.destroy();
      unpatchBringToFront();
    }
  }

  new LayerControl({ position: "{{ this.position }}" }).addTo(map);
})();
