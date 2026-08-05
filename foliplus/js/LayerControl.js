(function () {
  // ==================== Constants ====================
  const CONST = {
    name: "LayerControl",
    INIT_DELAY_MS: 300,
    ENFORCE_ORDER_DEBOUNCE_MS: 50,
    Z_INDEX: {
      BASE: 600, // Base for overlay layers (panes + markers)
      TILE_BASE: 200, // Base for tile layers (below overlays)
      STEP: 10, // Gap between consecutive layers
    },
    RECURSION: {
      PANE_DEPTH: 5,
      LAYER_DEPTH: 10,
    },
    DRAG: {
      HINT_COOLDOWN_MS: 800,
    },
    STORAGE: {
      ORDER_KEY: "foliplus_layer_order_{{ this._parent.get_name() }}",
      FOLD_KEY: "foliplus_fold_state_{{ this._parent.get_name() }}",
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
      CUSTOM: "custom",
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
        <circle cx="8" cy="6" r="1.5" fill="currentColor"/>
        <circle cx="16" cy="6" r="1.5" fill="currentColor"/>
        <circle cx="8" cy="12" r="1.5" fill="currentColor"/>
        <circle cx="16" cy="12" r="1.5" fill="currentColor"/>
        <circle cx="8" cy="18" r="1.5" fill="currentColor"/>
        <circle cx="16" cy="18" r="1.5" fill="currentColor"/>
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
        else if (leaf instanceof L.CircleMarker) hasPoint = true;
        else if (leaf instanceof L.Marker && leaf.feature) hasPoint = true;
      }
      // No known geometry types found → unknown
      if (!hasPoly && !hasLine && !hasPoint) return CONST.GEOM_TYPE.UNKNOWN;
      // Mixed geometry types → unknown (annotations without .feature are ignored)
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

    /** Resolve a layer by id from map._layers or window.
     *  Used internally by LayerRegistry (initial data resolution) and as a
     *  safety fallback when `li.layer` is unavailable (e.g. unregistered
     *  layers added directly to the map). */
    static findLayer(map, id) {
      return (map._layers && map._layers[id]) || window[id] || null;
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
          if (Object.hasOwn(layer._layers, k))
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

  // ==================== Ordered Layer Registry ====================
  // Owns the ordered layer list and its id → layerInfo index. All mutations
  // go through here so the index can never drift from the list. The exposed
  // array (`this.layers`) is a read-only view — DOM-aligned code can iterate
  // and index it, but direct mutation (push/splice/assign) is blocked so the
  // registry index can never be bypassed.
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
   *   `upsert` / `prepend` / `insertAt` / `remove` / `moveToFront`
   *   `reorder` / `replace` / `clear` / `normalizeGroups`
   *   `canReorderBetween` / `refreshFirstBaseIdx`
   *   `items` / `byId` / `view` / `list`
   *
   * External callers must use Manager API for mutations:
   *   `api.registerLayer({...})`   — insert/update
   *   `api.unregisterLayer(id)`    — remove
   *   `api.bringLayerToFront(id)`  — reorder
   */
  class LayerRegistry {
    /**
     * @param {Array} [initial=[]] - Initial layer info objects.
     * @param {Object} [map] - Leaflet map instance. If provided, resolves
     *   `li.layer` for each entry so callers can always use `li.layer`
     *   directly without a fallback (Jinja2 template entries are
     *   plain {name, id, visible, isBase} — no `layer` reference).
     */
    constructor(initial = [], map) {
      this.items = [...initial];
      this.byId = new Map(this.items.map((l) => [l.id, l]));
      // Resolve layer references for initial data entries
      if (map) {
        for (const li of this.items)
          if (!li.layer && li.id) li.layer = LayerUtils.findLayer(map, li.id);
      }
      // Cached index of the first base layer. The base group boundary is
      // stable between group mutations; caching it avoids a full-array
      // findIndex scan on every dragover (fires many times per second).
      this._firstBaseIdx = -1;
      this.refreshFirstBaseIdx();
      // Read-only view shared by both internal code and external callers.
      this.view = this.createReadonlyView();
    }

    /** Recompute the cached first-base-layer index. */
    refreshFirstBaseIdx() {
      this._firstBaseIdx = this.items.findIndex((l) => !!l.isBase);
    }

    /** Index of the first base layer, or -1 if none. */
    get firstBaseIdx() {
      return this._firstBaseIdx;
    }

    /** Create a read-only proxy over the internal array. */
    createReadonlyView() {
      return new Proxy(this.items, {
        set() {
          // Block direct index assignment (e.g. layers[0] = x).
          throw new TypeError(`[${CONST.name}] ${_(`${CONST.name}.readonly_error`)}`);
        },
        deleteProperty() {
          throw new TypeError(
            `[${CONST.name}] ${_(`${CONST.name}.readonly_del_error`)}`,
          );
        },
        get(target, prop, receiver) {
          if (typeof prop === "string" && MUTATING_METHODS.has(prop)) {
            return () => {
              throw new TypeError(
                `[${CONST.name}] ${_(`${CONST.name}.readonly_method_error`).replace(`{method}`, prop)}`,
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

    at(i) {
      return this.items[i];
    }

    get(id) {
      return this.byId.get(id);
    }

    has(id) {
      return this.byId.has(id);
    }

    indexOf(li) {
      return this.items.indexOf(li);
    }

    /** Iterate in order (keeps `for...of` and spread working). */
    [Symbol.iterator]() {
      return this.items[Symbol.iterator]();
    }

    /** Insert or update in place — never reorders an existing layer. */
    upsert(layerInfo) {
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
    prepend(layerInfo) {
      this.items.unshift(layerInfo);
      this.byId.set(layerInfo.id, layerInfo);
      this.refreshFirstBaseIdx();
      return layerInfo;
    }

    /** Insert before the given index (used for new base layers). */
    insertAt(layerInfo, idx) {
      this.items.splice(idx, 0, layerInfo);
      this.byId.set(layerInfo.id, layerInfo);
      this.refreshFirstBaseIdx();
      return layerInfo;
    }

    remove(id) {
      const li = this.byId.get(id);
      if (!li) return null;
      const idx = this.items.indexOf(li);
      if (idx !== -1) this.items.splice(idx, 1);
      this.byId.delete(id);
      this.refreshFirstBaseIdx();
      return li;
    }

    /** Move an existing layer to index 0 (bring to front).
     *  Callers guarantee the layer is an overlay (bringLayerToFront
     *  rejects base layers), so the base/overlay boundary never moves
     *  and refreshFirstBaseIdx is skipped. */
    moveToFront(id) {
      const li = this.byId.get(id);
      if (!li) return null;
      const idx = this.items.indexOf(li);
      if (idx <= 0) return li;
      this.items.splice(idx, 1);
      this.items.unshift(li);
      return li;
    }

    /** Swap order of two positions (drag-and-drop).
     *  Callers guarantee same-group reordering (canReorderBetween), so
     *  the base/overlay boundary never moves and refreshFirstBaseIdx
     *  is skipped. */
    reorder(fromIdx, toIdx) {
      const [moved] = this.items.splice(fromIdx, 1);
      this.items.splice(toIdx, 0, moved);
    }

    /** Rebuild both list and index from a new ordered array.
     *  Mutates the existing array in place so external references
     *  (`manager.layers`) keep pointing at the same instance. */
    replace(newList) {
      this.items.splice(0, this.items.length, ...newList);
      this.byId = new Map(this.items.map((l) => [l.id, l]));
      this.refreshFirstBaseIdx();
    }

    clear() {
      this.items.splice(0, this.items.length);
      this.byId.clear();
      this.refreshFirstBaseIdx();
    }

    /**
     * Reorder so all overlays come before all base layers.
     *  Mutates the existing array in place so external references
     *  (`manager.layers`) keep pointing at the same instance. */
    normalizeGroups() {
      const overlays = [];
      const bases = [];
      for (const l of this.items) {
        if (l && l.isBase) bases.push(l);
        else overlays.push(l);
      }
      this.items.splice(0, this.items.length, ...overlays.concat(bases));
      this.byId = new Map(this.items.map((l) => [l.id, l]));
      this.refreshFirstBaseIdx();
    }

    /**
     * Check whether a layer at fromIdx can be reordered to toIdx.
     * Only same-group (base↔base or overlay↔overlay) reordering is allowed. */
    canReorderBetween(fromIdx, toIdx) {
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

  // ==================== Pane Manager: PaneManager ====================
  // Responsibility split — "who orders, who hosts":
  //
  //   Layer (LayerRegistry) decides ORDER + VISIBILITY:
  //     - list order → computeZIndex() derives each layer's z-index number
  //     - visibility → map.hasLayer(layer) / addLayer-removeLayer
  //     - declares its main pane via layerInfo.paneName
  //
  //   Pane (PaneManager) HOSTS content and carries that number:
  //     - a layer's content may span several panes (graphPane + labelPane),
  //       discovered from the layer tree (discoverChildPanes, cached)
  //     - enforceOrder writes the layer's z-index onto every pane the
  //       layer's content lives in (applyLayerZIndex)
  //     - intra-layer order: label panes are bumped above paths
  //       (bumpLabelPanes → z + 1)
  //
  //   LayerManager ORCHESTRATES: reads layer order → computes z → hands
  //   it to PaneManager to land on the panes.
  //
  // Purely map-scoped and independent of the layer registry/UI, so the
  // z-order primitives are reusable across controls. The mechanism
  // *selection* (applyLayerZIndex) stays on the Manager because it
  // depends on the layer registry and z-index computation.
  class PaneManager {
    constructor(map) {
      this.map = map;
      this.defaultPanes = new Set([
        "overlayPane",
        "markerPane",
        "tilePane",
        "shadowPane",
        "mapPane",
      ]);
      this.labelPanes = new Set();

      // Cache for discoverChildPanes: layerId → string[] (pane names).
      this.paneCache = new Map();

      // Explicit registry: layer stamp → fallback pane name.
      this.fallbackPaneMap = new Map();
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

    /** Find all custom panes used by a container's tree.
     *  Results are cached by layer stamp; call `reset()`
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
      return this.defaultPanes.has(pane) || pane.startsWith(CONST.FALLBACK_PANE_PREFIX);
    }

    /** Find all panes a layer's content lives in, including fallback panes.
     *  Unlike discoverChildPanes(), this includes auto-created fallback panes
     *  (`foliplus_pane_*`) so ExportControl can find paths that were moved
     *  there by migrateLayers().
     *  Results are NOT cached because fallback panes are assigned lazily.
     *
     *  NOTE: For a layer that has no custom panes and no assigned fallback
     *  pane, the caller must verify `map.hasLayer(layer)` before trusting the
     *  returned default (`overlayPane`/`markerPane`), since an unmanaged or
     *  removed layer may not actually be rendered. */
    getLayerPanes(layer) {
      const panes = this.discoverChildPanes(layer);
      if (panes.length > 0) return panes;
      // Check if a fallback pane was assigned to this layer
      const fbName = this.fallbackPaneMap.get(L.stamp(layer));
      if (fbName) return [fbName];
      return ["overlayPane", "markerPane"];
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

    /**
     * Move layer DOM content into target panes, batched via
     * DocumentFragment to avoid repeated layout thrash.
     * @param {Array<{layer: Object, paneName: string, renderer: Object}>} layersToMove
     */
    migrateLayers(layersToMove) {
      if (!layersToMove.length) return;
      // Group by renderer container so we can batch-append via DocumentFragment.
      const groups = new Map();
      const markerGroups = new Map();
      for (const { layer, paneName, renderer } of layersToMove) {
        if (!paneName) continue;
        const container = renderer?._container;
        if (!container) continue;
        // For markers, we need the pane div (not the SVG renderer container)
        const paneEl = this.map.getPane(paneName);
        if (!groups.has(container)) groups.set(container, []);
        // Single pass: set options + move DOM to avoid double traversal.
        // Container layers (eachLayer) keep their options unpolluted — only
        // leaf layers get pane/paneSet so re-migration stays possible when a
        // layer's paneName changes.
        const collect = (l) => {
          if (l.eachLayer) {
            l.eachLayer(collect);
            return;
          }
          l.options.pane = paneName;
          l.options.paneSet = true;
          if (l instanceof L.Path) l.options.renderer = renderer;
          if (l._path && l._path.parentNode !== container)
            groups.get(container).push(l._path);
          // Move marker icon/shadow to the pane element (not SVG renderer)
          if (l instanceof L.Marker && paneEl) {
            if (l._shadow && l._shadow.parentNode !== paneEl) {
              if (!markerGroups.has(paneEl)) markerGroups.set(paneEl, []);
              markerGroups.get(paneEl).push(l._shadow);
            }
            if (l._icon && l._icon.parentNode !== paneEl) {
              if (!markerGroups.has(paneEl)) markerGroups.set(paneEl, []);
              markerGroups.get(paneEl).push(l._icon);
            }
          }
        };
        collect(layer);
      }
      // Batch-append paths per container to avoid repeated layout thrash
      for (const [container, paths] of groups) {
        if (!paths.length) continue;
        const frag = document.createDocumentFragment();
        for (const p of paths) frag.appendChild(p);
        container.appendChild(frag);
      }
      // Batch-append markers per pane element
      for (const [paneEl, markers] of markerGroups) {
        if (!markers.length) continue;
        const frag = document.createDocumentFragment();
        for (const m of markers) frag.appendChild(m);
        paneEl.appendChild(frag);
      }
    }

    /** Invalidate the child-pane discovery cache. */
    reset() {
      this.paneCache.clear();
    }

    /** Release all pane state. Called by LayerManager.destroy(). */
    destroy() {
      this.paneCache.clear();
      this.fallbackPaneMap.clear();
      this.labelPanes.clear();
    }
  }

  // ==================== Core Manager: LayerManager ====================
  class LayerManager {
    constructor(mapInstance, initialData) {
      this.map = mapInstance;
      // Each entry: {id, name, visible, isBase, paneName, iconSvg,
      //              type, layer, canvas, onToggle, onZIndex}
      // `layer` is resolved by LayerRegistry from map._layers for init data.
      this.layerRegistry = new LayerRegistry(initialData, this.map);
      // `this.layers` is the registry's ordered array — kept as a direct
      // reference so DOM-aligned code (data-index = array index) is unchanged.
      this.layers = this.layerRegistry.list;
      this.pendingRegistrations = [];
      this.uiContainer = null;

      // Bind method context to prevent 'this' loss when called via window.foliplus.LayerAPI
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

      // Pane lifecycle is delegated to a dedicated PaneManager. The bound
      // method below keeps the public API contract (api.getLayerPanes) for
      // external callers — ExportControl reads a layer's panes when
      // rendering an export. ensurePane is not part of the public API:
      // no consumer outside LayerControl needs it.
      this.panes = new PaneManager(mapInstance);
      this.getLayerPanes = this.panes.getLayerPanes.bind(this.panes);

      // Last attribution string applied, so syncAttribution can skip
      // rebuilding the attribution DOM when the top layer's attribution
      // is unchanged across enforceOrder runs.
      this.lastAttribution = null;

      // UI Controller reference (set by LayerUI construction)
      this.ui = null;

      this.debouncedEnforce = foliplus.debounce(() => {
        if (this.isDestroyed || !this.map || !this.map._container) return;
        this.enforceOrder();
      }, CONST.ENFORCE_ORDER_DEBOUNCE_MS);

      this.onLayerAdd = (e) => {
        if (this.isDestroyed || e.layer === this.map || e.layer instanceof L.Renderer)
          return;

        // Skip unmanaged layers (TileLayer, plain L.layerGroup, etc.)
        // that don't have a custom pane or fallback pane assigned by us.
        if (
          !(e.layer instanceof L.Path || e.layer instanceof L.Marker) &&
          !e.layer.options?.paneName
        )
          return;

        if (this.isEnforcing) {
          // enforceOrder is in flight; the layer was added mid-reorder.
          // Reschedule so it still gets z-indexed once the guard clears.
          this.debouncedEnforce();
          return;
        }

        this.debouncedEnforce();
      };
      this.map.on("layeradd", this.onLayerAdd);

      this.loadSavedOrder();
      this.layerRegistry.normalizeGroups();

      // Expose the manager as the public LayerAPI. The full instance is
      // attached so tests and debuggers can reach internals, but the stable
      // public contract is the bound methods and properties below:
      //
      //   **Read (safe for any caller):**
      //   `layerRegistry`       — read-only data source (size/at/get/has/firstBaseIdx)
      //   `layers`              — read-only view of the ordered array (indexed access)
      //   `findLayer(id)`       — resolve Leaflet layer by id
      //   `getLayerType(id)`    — geometry type of a layer
      //   `getLayersByType(t)`  — layers matching a geometry type
      //   `forEachLeaf(id, fn)` — walk leaf layers
      //   `extractPoints(id)`   — get point markers from a layer
      //
      //   **Write (via Manager API — triggers map + UI + persistence):**
      //   `registerLayer({...})`       — insert/update
      //   `unregisterLayer(id)`        — remove
      //   `bringLayerToFront(id)`      — reorder
      //
      //   **Factory (also write, but return new objects):**
      //   `createLayers({...})`  — managed three-layer group
      //   `createCanvas({...})`  — managed canvas element
      //
      //   **Pane helpers (read-only):**
      //   `getLayerPanes(layer)` — discover all panes a layer's content lives in
      //
      //   **Internal — do not rely on:**
      //   `map`, `ui`, `uiContainer`, `paneCache`, `fallbackPaneMap`,
      //   `pendingRegistrations`, `foldedGroups`, `debouncedEnforce`, etc.
      //   Mutate layers only through registerLayer/unregisterLayer/bringLayerToFront.
      foliplus.LayerAPI = this;
    }

    loadSavedOrder() {
      const data = foliplus.storage.load(CONST.STORAGE.ORDER_KEY, CONST.name);
      if (!data || !Array.isArray(data)) return;
      const layerMap = new Map(this.layers.map((l) => [l.id, l]));
      const ordered = [];
      for (const id of data) {
        if (layerMap.has(id)) {
          ordered.push(layerMap.get(id));
          layerMap.delete(id);
        }
      }
      this.layerRegistry.replace(ordered.concat([...layerMap.values()]));
    }

    saveOrder() {
      foliplus.storage.save(
        CONST.STORAGE.ORDER_KEY,
        this.layers.map((l) => l.id),
        CONST.name,
      );
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
      const li = this.layerRegistry.get(id);
      if (!li) return null;
      if (li.type) return li.type;
      if (li.isBase) return CONST.GROUP.BASE;
      if (li.iconSvg) return CONST.GEOM_TYPE.CUSTOM;
      // Type not yet assigned by initTypesAndVisibility — infer it lazily.
      // `li.layer` is resolved at init or register time, so this fallback
      // is rarely needed (only for layers added directly to map without
      // going through registerLayer).
      const layer = li.layer || LayerUtils.findLayer(this.map, id);
      if (!layer) return null;
      li.type = LayerUtils.getGeometryType(layer);
      return li.type;
    }

    /**
     * Get all registered layers of a given geometry type.
     * @param {string} type - "point" | "line" | "polygon" | "base"
     * @returns {Array<{id: string, name: string, layer: Object}>}
     *   `layer` is always populated (resolved at init or register time).
     */
    getLayersByType(type) {
      return this.layers
        .filter((l) => this.getLayerType(l.id) === type)
        .map((l) => ({
          id: l.id,
          name: l.name,
          layer: l.layer || LayerUtils.findLayer(this.map, l.id), // safety fallback
        }));
    }

    /**
     * Resolve a registered layer by id, searching layerInfo then map._layers.
     * Most layers have `li.layer` resolved at init (by LayerRegistry) or
     * register time; the fallback handles edge cases (e.g. layers added
     * directly to the map without going through registerLayer).
     * @param {string} id - Layer ID.
     * @returns {Object|null} Leaflet layer or null.
     */
    findLayer(id) {
      const li = this.layerRegistry.get(id);
      if (li?.layer) return li.layer;
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
      const seen = new Set();
      this.forEachLeaf(id, (l) => {
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

      const existingLi = this.layerRegistry.get(opts.id);
      const existingIdx = existingLi ? this.layerRegistry.indexOf(existingLi) : -1;
      const existingVisible = existingLi ? existingLi.visible : true;
      const layerInfo = {
        name: opts.name ?? opts.id,
        id: opts.id,
        visible: existingVisible,
        isBase: !!opts.isBase,
        paneName: opts.paneName ?? null,
        iconSvg: opts.iconSvg ?? null,
        type: null,
        layer: opts.layer || null,
        canvas: opts.canvas || null,
        onToggle: opts.onToggle || null,
        onZIndex: opts.onZIndex || null,
      };

      if (existingIdx !== -1) {
        // Idempotent re-registration: update fields in place, keep position.
        // Do NOT splice+unshift — that would silently destroy the user's
        // drag order (e.g. MeasureControl.setMode calls register() on every
        // tool switch) and persist the accidental order via saveOrder.
        this.layerRegistry.upsert(layerInfo);
      } else if (layerInfo.isBase) {
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
      // Clear stale fallback mapping so enforceOrder re-creates it
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
        // UI not rendered yet — queue the layerInfo and defer reordering.
        // The initial paint (attachUI → initTypesAndVisibility) runs a
        // synchronous enforceOrder, so a debounced call here just keeps the
        // map z-order sane if addLayer raced ahead of panel attach.
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
     *
     * Moves the layer to index 0 in the internal `this.layers` array,
     * re-runs enforceOrder() to recompute all pane z-indices, updates
     * the saved order, and moves the DOM item to the top of the list.
     *
     * @param {string} id - Layer ID previously passed to registerLayer().
     */
    bringLayerToFront(id) {
      const item = this.layerRegistry.get(id);
      if (!item) return;
      const idx = this.layerRegistry.indexOf(item);
      if (idx <= 0) return;
      // Bringing a base layer to index 0 would break the overlay-before-base
      // invariant and corrupt the cached group boundary — ignore it.
      if (item?.isBase) return;
      this.layerRegistry.moveToFront(id);
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
      const layerInfo = this.layerRegistry.remove(id);
      if (!layerInfo) return false;

      const layer = layerInfo.layer || LayerUtils.findLayer(this.map, id); // safety fallback
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

    /** Recursively clear all nested sub-layers.
     *  Leaflet's clearLayers() removes direct children; nested groups remove
     *  their own children via onRemove, so a single clearLayers suffices. */
    clearAllLayers(layer) {
      if (!layer) return;
      if (typeof layer.clearLayers === "function") layer.clearLayers();
      else if (layer.eachLayer) layer.eachLayer((l) => this.clearAllLayers(l));
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
          if (opts.labelPane) this.panes.labelPanes.add(opts.labelPane);
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
            const { renderer } = this.panes.ensurePane(opts.graphPane);
            layer._renderer = renderer;
          } else if (paneName) this.panes.ensurePane(paneName, false);
          const result = target.addLayer(layer);
          // Content tree changed — invalidate cached pane discovery.
          this.panes.reset();
          return result;
        }
        return origAddLayer(layer);
      };

      mainLayer.removeLayer = (layer) => {
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
     * @property {Object} hooks
     *   Lifecycle hooks: `{ before: Array.<Function>, after: Array.<Function> }`.
     *   Push to `before` to prepare for full-content rendering, to `after`
     *   to restore normal state. Used by ExportControl.
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

      // Track map pan — update canvas position without redraw
      const onMove = () => updatePosition();
      this.map.on("move", onMove);

      // Track map resize — re-measure canvas
      const onResize = () => resize();
      this.map.on("resize", onResize);

      // Lifecycle hooks for full-content capture (e.g. ExportControl). Push functions
      // to `before` to prepare for capture, and to `after` to restore normal state.
      const hooks = { before: [], after: [] };
      canvas.hooks = hooks;

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
        hooks,
      };
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

        // The layer tree may have changed since the last pass (e.g. a GeoJSON
        // layer filled via addData after registration, or a createLayers
        // content add that did not go through the override). Re-discover
        // custom panes each pass so stale cache entries never cause a layer
        // to be mis-assigned to a fallback pane (breaking its z-order).
        this.panes.reset();

        for (let i = 0; i < this.layers.length; i++) {
          const li = this.layers[i];
          const layer = this.findLayer(li.id);
          const hasLayer = layer && this.map.hasLayer(layer);
          const isTile = layer instanceof L.TileLayer;
          const z = this.computeZIndex(i, isTile);

          // 1. Notify callback-only layers (e.g. Canvas heatmap) via z-index callback
          if (li.onZIndex) li.onZIndex(z);
          if (!hasLayer) continue;

          // 2. Apply z-index via the appropriate mechanism
          this.applyLayerZIndex({ li, layer, z, isTile, layersToMove });
        }

        // Bump popupPane and tooltipPane above all managed panes so popups and
        // hover tooltips (e.g., GeoJsonTooltip) are never hidden behind graph or
        // label panes.  popupPane gets one extra step so it renders above
        // tooltipPane when both are open (matching Leaflet default ordering).
        const topZ = this.computeZIndex(0, false) + CONST.Z_INDEX.STEP;
        const pp = this.map.getPane("popupPane");
        if (pp) pp.style.zIndex = String(topZ + 1);
        const tp = this.map.getPane("tooltipPane");
        if (tp) tp.style.zIndex = String(topZ);

        // 3. Migrate layers to their target panes
        this.panes.migrateLayers(layersToMove);

        // 4. Sync attribution: only show the topmost visible base TileLayer's
        // attribution to avoid clutter when multiple base layers are visible.
        this.syncAttribution();
      } finally {
        this.isEnforcing = false;
      }
    }

    /** Apply z-index to a single layer using the appropriate mechanism. */
    applyLayerZIndex({ li, layer, z, isTile, layersToMove }) {
      const paneName = li.paneName;
      if (paneName) {
        // --- Mechanism A: Custom pane (Path layers with explicit paneName) ---
        const ep = this.panes.ensurePane(paneName, !isTile);
        ep.pane.style.zIndex = z;
        if (layer.options.pane !== paneName || !layer.options.paneSet)
          layersToMove.push({ layer, paneName, renderer: ep.renderer });
        this.panes.bumpLabelPanes(layer, z);
        return;
      }

      if (isTile && typeof layer.setZIndex === "function") {
        // --- Mechanism B: TileLayer (Leaflet's own API) ---
        layer.setZIndex(z);
        return;
      }

      // --- Mechanism C: Auto-discovered / fallback panes ---
      const childPanes = this.panes.discoverChildPanes(layer);
      if (childPanes.length > 0) {
        // Three-layer components (HeatmapControl, MeasureControl, etc.)
        childPanes.forEach((cp) => {
          const ep = this.panes.ensurePane(cp, !isTile);
          ep.pane.style.zIndex = z;
        });
        this.panes.bumpLabelPanes(layer, z);
        layer.options.paneSet = true;
        return;
      }

      // Unmanaged layer (GeoJSON, markers, etc.) → auto fallback pane
      const fbName = `${CONST.FALLBACK_PANE_PREFIX}${L.stamp(layer)}`;
      this.panes.fallbackPaneMap.set(L.stamp(layer), fbName);
      const ep = this.panes.ensurePane(fbName, !isTile);
      ep.pane.style.zIndex = z;
      if (layer.options.pane !== fbName || !layer.options.paneSet)
        layersToMove.push({ layer, paneName: fbName, renderer: ep.renderer });
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
        const layer = this.findLayer(li.id);
        if (!(layer instanceof L.TileLayer) || !layer.options.attribution) continue;
        delete attrCtrl._attributions[layer.options.attribution];
        if (!topAttr && this.map.hasLayer(layer)) topAttr = layer.options.attribution;
      }

      // Re-add only the topmost visible one
      if (topAttr) attrCtrl._attributions[topAttr] = 1;

      // Skip DOM rebuild when the top attribution did not change (enforceOrder
      // calls syncAttribution on every run; rebuilding attribution HTML each
      // time is wasteful during drag/toggle churn).
      if (topAttr === this.lastAttribution) return;
      this.lastAttribution = topAttr;
      attrCtrl._update();
    }

    // UI Rendering & Event Binding
    attachUI(containerDiv) {
      if (this.ui) this.ui.attachUI(containerDiv);
    }

    /** Check whether a layer at fromIdx can be reordered to toIdx.
     *  Only same-group (base↔base or overlay↔overlay) reordering is allowed.
     *  Delegates to LayerRegistry for the pure-data check. */
    canReorderBetween(fromIdx, toIdx) {
      return this.layerRegistry.canReorderBetween(fromIdx, toIdx);
    }

    /** Release all resources. Called by LayerControl.onRemove(). */
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
      if (foliplus.LayerAPI === this) foliplus.LayerAPI = null;
    }
  }

  // ==================== UI Controller: LayerUI ====================
  class LayerUI {
    constructor(manager) {
      this.manager = manager;
      this.foldedGroups = new Set();
      this.isColorActive = false;
      this.currentColor = CONST.COLOR.DEFAULT;
      this.dragIdx = null;
      this.lastDragHintAt = 0;
      this.lastDragOverItem = null;
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
      this.loadFoldState();
      this.renderInitialList();
      this.bindEvents();

      while (this.m.pendingRegistrations.length) {
        const li = this.m.pendingRegistrations.shift();
        // Batch-insert without reindexing each item; reindex once below.
        this.insertLayerItem(li, { reindex: false });
      }
      this.reindexItems();

      setTimeout(() => this.initTypesAndVisibility(), CONST.INIT_DELAY_MS);
    }

    /** Load fold state from localStorage. */
    loadFoldState() {
      const data = foliplus.storage.load(CONST.STORAGE.FOLD_KEY, CONST.name);
      if (Array.isArray(data)) this.foldedGroups = new Set(data);
    }

    /** Save fold state to localStorage. */
    saveFoldState() {
      foliplus.storage.save(
        CONST.STORAGE.FOLD_KEY,
        Array.from(this.foldedGroups),
        CONST.name,
      );
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
        if (this.foldedGroups.has(group))
          item.classList.add(CONST.CLASSES.GROUP_FOLDED);
        frag.appendChild(item);
      }

      const colorItem = this.renderColorLayerItem();
      if (this.foldedGroups.has(CONST.GROUP.BASE))
        colorItem.classList.add(CONST.CLASSES.GROUP_FOLDED);
      frag.appendChild(colorItem);

      this.m.uiContainer.innerHTML = "";
      this.m.uiContainer.appendChild(frag);
    }

    /** Insert a single layer item (plus its group separator if needed)
     *  without rebuilding the whole list. O(n) worst case for reindexing,
     *  but avoids wiping and re-creating every item on each registration.
     *  @param {Object} layerInfo - Layer info to insert.
     *  @param {Object} [opts] - Insert options.
     *  @param {boolean} [opts.reindex=true] - Reindex all items after insert.
     *    Pass false when batch-inserting so the caller can reindex once. */
    insertLayerItem(layerInfo, { reindex = true } = {}) {
      const idx = this.m.layerRegistry.indexOf(layerInfo);
      if (idx === -1) return;
      const container = this.m.uiContainer;
      const group = layerInfo.isBase ? CONST.GROUP.BASE : CONST.GROUP.OVERLAY;

      // Locate the DOM anchor: the first item of this group.
      const anchorSel =
        group === CONST.GROUP.BASE
          ? `${CONST.SEL.LAYER_ITEM}[data-layer-type="${CONST.GROUP.BASE}"]`
          : `${CONST.SEL.LAYER_ITEM}:not([data-layer-type="${CONST.GROUP.BASE}"]):not(${CONST.SEL.COLOR_ITEM})`;
      const firstOfGroup = container.querySelector(anchorSel);

      const frag = document.createDocumentFragment();
      // Insert the group separator row if this group had no items yet.
      if (!firstOfGroup) {
        frag.appendChild(
          this.renderToggleAllRow(
            group,
            group === CONST.GROUP.BASE
              ? `${CONST.name}.base_map_label`
              : `${CONST.name}.data_layer_label`,
          ),
        );
      }
      const item = this.renderLayerItem(layerInfo, idx);
      if (this.foldedGroups.has(group)) item.classList.add(CONST.CLASSES.GROUP_FOLDED);
      frag.appendChild(item);

      if (!firstOfGroup) {
        // New group: separator row + item go right before the first item of
        // the following group (or the color layer item at the end).
        const nextGroupSel =
          group === CONST.GROUP.BASE
            ? CONST.SEL.COLOR_ITEM
            : `${CONST.SEL.LAYER_ITEM}[data-layer-type="${CONST.GROUP.BASE}"]`;
        const nextAnchor = container.querySelector(nextGroupSel);
        if (nextAnchor) container.insertBefore(frag, nextAnchor);
        else container.appendChild(frag);
      } else container.insertBefore(frag, firstOfGroup);

      if (reindex) this.reindexItems();
    }

    /** Update an existing item in place after an idempotent re-registration. */
    updateLayerItem(layerInfo, idx) {
      const item = this.m.uiContainer.querySelector(
        `[${CONST.DATA.LAYER_ID}="${CSS.escape(layerInfo.id)}"]`,
      );
      if (!item) return;
      item.dataset.index = String(idx);
      const label = item.querySelector("label");
      if (label) label.textContent = layerInfo.name;
      const cb = item.querySelector('input[type="checkbox"]');
      if (cb) {
        cb.dataset.index = String(idx);
        cb.setAttribute("aria-label", LayerUtils.escapeHTML(layerInfo.name));
        cb.title = LayerUtils.escapeHTML(layerInfo.name);
      }
    }

    renderToggleAllRow(group, labelKey) {
      const isFolded = this.foldedGroups.has(group);
      return foliplus.dom.el(
        "div",
        {
          class:
            `${CONST.CLASSES.FOLD_BTN_CTR} ${CONST.CLASSES.TOGGLE_ALL}` +
            (isFolded ? ` ${CONST.CLASSES.FOLDED}` : ""),
          "data-group": group,
          title: _(`${CONST.name}.${isFolded ? "unfold_tooltip" : "fold_tooltip"}`),
        },
        foliplus.dom.el(
          "button",
          {
            class: CONST.CLASSES.FOLD_BTN,
          },
          { html: SVGs.FOLD },
        ),
        foliplus.dom.el(
          "div",
          { class: CONST.CLASSES.CHECKBOX },
          foliplus.dom.el("input", {
            type: "checkbox",
            "data-role": "toggle-all",
            checked: "",
            title: _(`${CONST.name}.toggle_all_deselect_tooltip`),
          }),
        ),
        foliplus.dom.el("span", { class: CONST.CLASSES.SEP_LABEL }, _(labelKey)),
        foliplus.dom.el("div", { class: "foliplus-section-divider" }),
      );
    }

    renderLayerItem(l, idx) {
      const en = LayerUtils.escapeHTML(l.name);
      const children = [
        foliplus.dom.el(
          "span",
          { title: _(`${CONST.name}.drag_tooltip`) },
          { html: SVGs.DRAG_HANDLE },
        ),
        foliplus.dom.el(
          "div",
          { class: CONST.CLASSES.CHECKBOX },
          foliplus.dom.el("input", {
            type: "checkbox",
            checked: "",
            [CONST.DATA.INDEX]: String(idx),
            "aria-label": en,
            title: en,
          }),
        ),
        foliplus.dom.el("label", null, en),
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
          [CONST.DATA.INDEX]: String(idx),
          [CONST.DATA.LAYER_ID]: l.id,
          "data-layer-type": l.isBase ? CONST.GROUP.BASE : CONST.GROUP.OVERLAY,
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
            value: this.currentColor,
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
        const layer = this.m.findLayer(id);

        if (inputs[i]) {
          const hasLayer = layer != null;
          const isCallbackOnly = !hasLayer && layerInfo.onToggle;
          if (isCallbackOnly) inputs[i].checked = layerInfo.visible !== false;
          else inputs[i].checked = hasLayer && this.m.map.hasLayer(layer);

          inputs[i].title = _(
            `${CONST.name}.${inputs[i].checked ? "deselect_tooltip" : "select_tooltip"}`,
          );

          const item = inputs[i].closest(CONST.SEL.LAYER_ITEM);
          if (item) {
            if (inputs[i].checked) item.classList.add(CONST.CLASSES.ACTIVE);
            else item.classList.remove(CONST.CLASSES.ACTIVE);
          }
        }

        if (typeCols[i]) {
          let typeKey;
          if (layerInfo.isBase) {
            typeCols[i].innerHTML = foliplus.SVGs.GLOBE;
            typeKey = `${CONST.name}.type_base`;
            layerInfo.type = CONST.GROUP.BASE;
            if (inputs[i]?.checked) anyBaseVisible = true;
          } else if (layerInfo.iconSvg) {
            typeCols[i].innerHTML = layerInfo.iconSvg;
            typeKey = `${CONST.name}.type_custom`;
            layerInfo.type = CONST.GEOM_TYPE.CUSTOM;
          } else if (layer) {
            const gtype = LayerUtils.getGeometryType(layer);
            typeCols[i].innerHTML = LayerUtils.getTypeSVG(layer);
            typeKey = `${CONST.name}.type_${gtype}`;
            layerInfo.type = gtype;
          } else typeKey = `${CONST.name}.type_unknown`;

          const item = inputs[i]?.closest(CONST.SEL.LAYER_ITEM);
          if (item) item.title = _(typeKey);
        }
      }

      if (!anyBaseVisible) this.showColorLayer(this.currentColor);
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
      const container = this.m.uiContainer;
      if (!container) return;

      this.onChange = (e) => {
        // Route: toggle-all checkbox vs. individual layer checkbox vs. color input
        const cb = e.target.closest('[data-role="toggle-all"]');
        if (cb) {
          const row = cb.closest(CONST.SEL.TOGGLE_ALL);
          this.toggleAll(row.dataset.group, cb.checked);
          return;
        }
        this.handleChange(e);
      };
      this.onInput = (e) => this.handleInput(e);
      this.onClick = (e) => {
        // Color layer item → deselect bases
        if (e.target.closest(CONST.SEL.COLOR_ITEM)) {
          this.deselectAllBaseMaps(-1);
          this.showColorLayer(this.currentColor);
          this.syncToggleAll(CONST.GROUP.BASE);
          this.m.enforceOrder();
          return;
        }
        // Fold toggle (toggle-all-item row, excluding its checkbox)
        const row = e.target.closest(CONST.SEL.TOGGLE_ALL);
        if (!row || e.target.closest('[data-role="toggle-all"]')) return;
        const group = row.dataset.group;
        if (this.foldedGroups.has(group)) this.foldedGroups.delete(group);
        else this.foldedGroups.add(group);
        this.renderInitialList();
        this.initTypesAndVisibility();
        this.saveFoldState();
      };

      this.onDragStart = (e) => this.handleDragStart(e);
      this.onDragOver = (e) => this.handleDragOver(e);
      this.onDragLeave = (e) => this.handleDragLeave(e);
      this.onDrop = (e) => this.handleDrop(e);
      this.onDragEnd = (e) => this.handleDragEnd(e);

      container.addEventListener("change", this.onChange);
      container.addEventListener("input", this.onInput);
      container.addEventListener("click", this.onClick);
      container.addEventListener("dragstart", this.onDragStart);
      container.addEventListener("dragover", this.onDragOver);
      container.addEventListener("dragleave", this.onDragLeave);
      container.addEventListener("drop", this.onDrop);
      container.addEventListener("dragend", this.onDragEnd);
    }

    /** Detach UI event listeners (called from LayerManager.destroy). */
    unbindEvents() {
      const container = this.m.uiContainer;
      if (!container) return;
      if (this.onChange) container.removeEventListener("change", this.onChange);
      if (this.onInput) container.removeEventListener("input", this.onInput);
      if (this.onClick) container.removeEventListener("click", this.onClick);
      if (this.onDragStart)
        container.removeEventListener("dragstart", this.onDragStart);
      if (this.onDragOver) container.removeEventListener("dragover", this.onDragOver);
      if (this.onDragLeave)
        container.removeEventListener("dragleave", this.onDragLeave);
      if (this.onDrop) container.removeEventListener("drop", this.onDrop);
      if (this.onDragEnd) container.removeEventListener("dragend", this.onDragEnd);
      this.onChange = this.onInput = this.onClick = null;
      this.onDragStart = this.onDragOver = this.onDragLeave = null;
      this.onDrop = this.onDragEnd = null;
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
        const layer = this.m.findLayer(layerInfo.id);

        cb.checked = newState;
        cb.title = _(
          `${CONST.name}.${newState ? "deselect_tooltip" : "select_tooltip"}`,
        );
        if (newState) item.classList.add(CONST.CLASSES.ACTIVE);
        else item.classList.remove(CONST.CLASSES.ACTIVE);

        if (layer)
          newState ? this.m.map.addLayer(layer) : this.m.map.removeLayer(layer);
        if (newState && layer) layer.options.paneSet = false;
        if (layerInfo.onToggle) layerInfo.onToggle(newState);
        if (!layer) layerInfo.visible = newState;
      });

      if (group === CONST.GROUP.BASE && !newState) {
        this.hideColorLayer();
        this.showColorLayer(this.currentColor);
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
      allCb.title = _(
        `${CONST.name}.${allChecked ? "toggle_all_deselect_tooltip" : "toggle_all_select_tooltip"}`,
      );
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
      const layer = this.m.findLayer(layerInfo.id);
      const item = target.closest(CONST.SEL.LAYER_ITEM);

      if (layerInfo.isBase) this.hideColorLayer();
      if (layer)
        target.checked ? this.m.map.addLayer(layer) : this.m.map.removeLayer(layer);
      // Reset paneSet on re-add so enforceOrder re-moves the layer's paths
      // to the correct fallback pane (map.removeLayer strips them from the
      // custom pane; map.addLayer puts them back in the default pane).
      if (target.checked && layer) layer.options.paneSet = false;
      if (item)
        target.checked
          ? item.classList.add(CONST.CLASSES.ACTIVE)
          : item.classList.remove(CONST.CLASSES.ACTIVE);

      target.title = _(
        `${CONST.name}.${target.checked ? "deselect_tooltip" : "select_tooltip"}`,
      );

      if (layerInfo.onToggle) layerInfo.onToggle(target.checked);
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
      this.dragIdx = parseInt(item.dataset.index, 10);
      item.classList.add(CONST.CLASSES.DRAGGING);
      e.dataTransfer.effectAllowed = "move";
    }

    showReorderBlockedHint() {
      const now = Date.now();
      if (now - this.lastDragHintAt < CONST.DRAG.HINT_COOLDOWN_MS) return;
      this.lastDragHintAt = now;
      foliplus.showHint(
        CONST.name,
        _(`${CONST.name}.reorder_group_only`),
        foliplus.HINT_DURATION.SHORT,
      );
    }

    handleDragOver(e) {
      if (this.dragIdx === null) return;
      e.preventDefault();
      const item = e.target.closest(CONST.SEL.LAYER_ITEM);
      if (!item || item.classList.contains(CONST.CLASSES.COLOR_ITEM)) return;

      const targetIdx = parseInt(item.dataset.index, 10);
      // Only clear the previously highlighted item instead of scanning every
      // item on each dragover event (fires many times per second while dragging).
      const prev = this.lastDragOverItem;
      if (prev && prev !== item)
        prev.classList.remove(
          CONST.CLASSES.DRAG_OVER_TOP,
          CONST.CLASSES.DRAG_OVER_BOTTOM,
        );
      item.classList.remove(
        CONST.CLASSES.DRAG_OVER_TOP,
        CONST.CLASSES.DRAG_OVER_BOTTOM,
      );
      this.lastDragOverItem = item;

      if (!this.m.canReorderBetween(this.dragIdx, targetIdx)) {
        if (e.dataTransfer) e.dataTransfer.dropEffect = "none";
        this.showReorderBlockedHint();
        return;
      }
      if (e.dataTransfer) e.dataTransfer.dropEffect = "move";

      if (targetIdx < this.dragIdx) item.classList.add(CONST.CLASSES.DRAG_OVER_TOP);
      else if (targetIdx > this.dragIdx)
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
      if (this.dragIdx === null) return;
      if (!target || target.classList.contains(CONST.CLASSES.COLOR_ITEM)) return;

      if (this.dragIdx < 0 || this.dragIdx >= this.m.layers.length) {
        this.dragIdx = null;
        return;
      }

      const targetIdx = parseInt(target.dataset.index, 10);
      if (this.dragIdx === targetIdx) return;
      if (!this.m.canReorderBetween(this.dragIdx, targetIdx)) {
        this.showReorderBlockedHint();
        return;
      }

      // Reorder via the registry so the array + index stay consistent.
      this.m.layerRegistry.reorder(this.dragIdx, targetIdx);
      const moved = this.m.layers[targetIdx];

      const movedItem = this.m.uiContainer.querySelector(
        `[${CONST.DATA.LAYER_ID}="${CSS.escape(moved.id)}"]`,
      );
      if (!movedItem) {
        this.dragIdx = null;
        return;
      }

      if (targetIdx < this.dragIdx) target.parentNode.insertBefore(movedItem, target);
      else target.parentNode.insertBefore(movedItem, target.nextSibling);

      this.reindexItems();
      this.m.enforceOrder();
      this.m.saveOrder();
      this.dragIdx = null;
    }

    handleDragEnd() {
      this.lastDragOverItem = null;
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
      this.isColorActive = true;
      this.currentColor = color;
      mapContainer.style.setProperty("--color-layer-bg", color);
      mapContainer.classList.add(CONST.CLASSES.ACTIVE);

      for (let i = 0; i < this.m.layers.length; i++) {
        if (this.m.layers[i].isBase) {
          const bLayer = this.m.findLayer(this.m.layers[i].id);
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
      this.isColorActive = false;
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
      for (let i = 0; i < this.m.layers.length; i++)
        if (this.m.layers[i].isBase && i !== exceptIdx) {
          const bLayer = this.m.findLayer(this.m.layers[i].id);
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
      patchBringToFront();
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
