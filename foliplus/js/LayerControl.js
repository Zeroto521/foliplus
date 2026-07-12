(function () {
  // ==================== Constants ====================
  const CONST = {
    name: "LayerControl",
    INIT_DELAY_MS: 300,
    Z_INDEX_BASE: 600,
    DRAG_TIMEOUT_MS: 100,
    DRAG_HINT_COOLDOWN_MS: 800,
    LAYER_RECURSION_DEPTH: 10,
    STORAGE_KEY: "_layer_order",
    COLOR_MAP_LAYER_ID: "__color_map__",
    COLOR_DEFAULT: "#cccccc",
  };

  // ==================== Runtime Guard ====================
  if (!window.foliplus || !window.foliplus.SVGs) {
    console.error(`[${CONST.name}] foliplus runtime not found, plugin disabled.`);
    return;
  }

  // ==================== Dependencies ====================
  const map = {{ this._parent.get_name() }};
  const mapContainer = map.getContainer();
  const _ = (k) => (window.foliplus && window.foliplus.gt ? window.foliplus.gt(k) : k);

  const SVGS = {
    DRAG_HANDLE: `
      <svg width="12" height="16" viewBox="0 0 12 16" fill="none" class="drag-handle">
        <circle cx="4" cy="4" r="1.5" fill="currentColor"/>
        <circle cx="8" cy="4" r="1.5" fill="currentColor"/>
        <circle cx="4" cy="8" r="1.5" fill="currentColor"/>
        <circle cx="8" cy="8" r="1.5" fill="currentColor"/>
        <circle cx="4" cy="12" r="1.5" fill="currentColor"/>
        <circle cx="8" cy="12" r="1.5" fill="currentColor"/>
      </svg>`,
    LIST: `
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
        stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="5.5" cy="5" r="2"/><line x1="10" y1="5" x2="21" y2="5"/>
        <circle cx="5.5" cy="12" r="2"/><line x1="10" y1="12" x2="21" y2="12"/>
        <circle cx="5.5" cy="19" r="2"/><line x1="10" y1="19" x2="21" y2="19"/>
      </svg>`,
    POINT: `
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
        <circle cx="12" cy="12" r="6" fill="none" stroke="currentColor"
          stroke-width="1.5"/>
      </svg>`,
    LINE: `
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
        <path d="M4 20 L10 6 L16 18 L22 4" stroke="currentColor" stroke-width="1.5"
              stroke-linecap="round" stroke-linejoin="round"/>
      </svg>`,
    POLYGON: `
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
        <polygon points="12,3 21,9 18,21 6,21 3,9" fill="none" stroke="currentColor"
                 stroke-width="1.5" stroke-linejoin="round"/>
      </svg>`,
    EMPTY: `
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
        <rect x="4" y="4" width="16" height="16" rx="2" stroke="currentColor"
          stroke-width="1.5" stroke-dasharray="4 3" fill="none"/>
      </svg>`,
    UNKNOWN: `
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
        <circle cx="12" cy="12" r="6.5" stroke="currentColor" stroke-width="1.5"
                fill="none"/>
        <text x="12" y="12.5" text-anchor="middle" dominant-baseline="central"
              font-size="12" font-weight="bold" fill="currentColor">?</text>
      </svg>`,
  };

  window.foliplus.registerHintIcon(CONST.name, SVGS.LIST);

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
      const collect = (n, d) => {
        if (!n || d > CONST.LAYER_RECURSION_DEPTH) return;
        if (n.getLayers && typeof n.getLayers === "function") {
          n.getLayers().forEach((c) => collect(c, d + 1));
        } else {
          leaves.push(n);
        }
      };
      try {
        collect(layer, 0);
      } catch (e) {}

      // No leaves at all → empty container (e.g. empty GeoDataFrame)
      if (leaves.length === 0) return "empty";

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
      if (!hasPoly && !hasLine && !hasPoint) return "unknown";
      return hasPoly ? "polygon" : hasLine ? "line" : "point";
    }

    static getTypeSVG(layer) {
      const type = this.getGeometryType(layer);
      if (type === "polygon") return SVGS.POLYGON;
      if (type === "line") return SVGS.LINE;
      if (type === "point") return SVGS.POINT;
      if (type === "empty") return SVGS.EMPTY;
      return SVGS.UNKNOWN;
    }
  }

  // ==================== Core Manager: LayerManager ====================
  class LayerManager {
    constructor(mapInstance) {
      this.map = mapInstance;
      this.layers = [];
      this.typeMap = new Map();
      this.pendingRegistrations = [];
      this.uiContainer = null;

      this.colorActive = false;
      this.currentColor = CONST.COLOR_DEFAULT;
      this.dragIdx = null;
      this.lastDragHintAt = 0;

      // Bind method context to prevent 'this' loss when called via window.foliplus.LayerControlAPI
      this.registerLayer = this.registerLayer.bind(this);
      this.unregisterLayer = this.unregisterLayer.bind(this);
      this.getLayerType = this.getLayerType.bind(this);
      this.getLayersByType = this.getLayersByType.bind(this);
      this.ensurePane = this.ensurePane.bind(this);
      this._isEnforcing = false;
      this._enforceTimer = null;
      this._isDestroyed = false;

      this.map.on("layeradd", (e) => {
        // Skip internal layers, background enforcement, and destroyed manager
        if (
          this._isEnforcing ||
          this._isDestroyed ||
          e.layer === this.map ||
          e.layer instanceof L.Renderer
        ) {
          return;
        }

        // Debounce enforcement to avoid redundant calcs during bulk additions
        if (this._enforceTimer) clearTimeout(this._enforceTimer);
        this._enforceTimer = setTimeout(() => {
          if (this._isDestroyed || !this.map || !this.map._container) return;
          this.enforceOrder();
          this._enforceTimer = null;
        }, 50);
      });

      window.foliplus.LayerControlAPI = this;
    }

    init(initialData) {
      this.layers = [...initialData];
      this._loadSavedOrder();
      this._normalizeLayerGroups();
    }

    _normalizeLayerGroups() {
      const overlays = [];
      const bases = [];
      for (const l of this.layers) {
        if (l && l.isBase) bases.push(l);
        else overlays.push(l);
      }
      this.layers = overlays.concat(bases);
    }

    _loadSavedOrder() {
      try {
        const data = localStorage.getItem(CONST.STORAGE_KEY);
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
        console.warn(`[${CONST.name}] failed to load saved layer order:`, e);
      }
    }

    _saveOrder() {
      try {
        localStorage.setItem(
          CONST.STORAGE_KEY,
          JSON.stringify(this.layers.map((l) => l.id)),
        );
      } catch (e) {
        console.warn(`[${CONST.name}] failed to save layer order:`, e);
      }
    }

    // ==================== Public API Methods ====================
    // These are exposed via window.foliplus.LayerControlAPI for runtime use.
    //
    // Usage:
    //   const api = window.foliplus.LayerControlAPI;
    //   api.registerLayer({ id: 'myLayer', name: 'My Layer', layer: leafletLayer });
    //   api.unregisterLayer('myLayer');
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
      for (const [id, info] of this.typeMap) {
        if (info.type === type) result.push({ id, name: info.name });
      }
      return result;
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
      if (!opts?.id) throw new Error(`[${CONST.name}] opts.id is required`);

      const existingIdx = this.layers.findIndex((l) => l.id === opts.id);
      if (existingIdx !== -1) this.layers.splice(existingIdx, 1);

      const layerInfo = {
        name: opts.name ?? opts.id,
        id: opts.id,
        visible: true,
        isBase: !!opts.isBase,
        paneName: opts.paneName ?? null,
        iconSvg: opts.iconSvg ?? null,
      };
      if (layerInfo.isBase) {
        const firstBaseIdx = this.layers.findIndex((l) => !!l.isBase);
        if (firstBaseIdx === -1) this.layers.push(layerInfo);
        else this.layers.splice(firstBaseIdx, 0, layerInfo);
      } else {
        this.layers.unshift(layerInfo);
      }

      if (opts.paneName) this.ensurePane(opts.paneName);
      if (opts.layer) {
        const childPanes = this._discoverChildPanes(opts.layer);
        for (const cp of childPanes) {
          const isLabel = cp.includes("label") || cp.includes("lbl");
          this.ensurePane(cp, !isLabel);
        }
      }

      // NB: window[id] provides global access for HeatmapControl/others to find
      // layers by id via scanMapLayers() fallback path.
      if (opts.layer) window[opts.id] = opts.layer;
      if (opts.layer && !this.map.hasLayer(opts.layer)) {
        this.map.addLayer(opts.layer);
      }

      this.enforceOrder();

      // Mark container layers (L.layerGroup, L.featureGroup, etc.) as
      // already-processed so subsequent enforceOrder() calls skip the
      // removeLayer/addLayer cycle.
      if (opts.paneName && opts.layer) {
        const isContainer = !(
          opts.layer instanceof L.Path || opts.layer instanceof L.Marker
        );
        if (isContainer) {
          opts.layer.options.pane = opts.paneName;
          opts.layer.options._paneSet = true;
        }
      }

      if (!this.uiContainer) {
        this.pendingRegistrations.push(opts);
        return null;
      }

      // Re-render keeps separator/group boundaries correct for both overlay/base
      // runtime registrations and avoids fragile incremental insertion logic.
      this._renderInitialList();
      this._initTypesAndVisibility();
      this._saveOrder();
      return this.uiContainer.querySelector(`[data-layer-id="${opts.id}"]`);
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

      const layer = this.map._layers[id] || window[id];
      if (layer && this.map.hasLayer(layer)) {
        this.map.removeLayer(layer);
      }
      if (window[id]) delete window[id];

      if (this.uiContainer) {
        const target = this.uiContainer.querySelector(`[data-layer-id="${id}"]`);
        if (target) {
          target.remove();
          this._reindexItems();
        }
      }
      requestAnimationFrame(() => this.map.invalidateSize({ animate: false }));
      return true;
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
        pane.classList.add("layer-pane");
      }
      let renderer = null;
      if (needRenderer) {
        renderer = this.map[`_renderer_${paneName}`];
        if (!renderer) {
          renderer = L.svg({ pane: paneName });
          renderer.addTo(this.map);
          this.map[`_renderer_${paneName}`] = renderer;
        }
      }
      return { pane, renderer };
    }

    // Core Sorting Engine
    _setLayerPaneRecursive(layer, paneName, renderer) {
      // Skip Markers — both default icons (with shadow images) and divIcon.
      // Moving them to a custom pane breaks their shadow positioning.
      // They stay in Leaflet's default markerPane (z-index 600).
      if (layer instanceof L.Marker) return;

      layer.options.pane = paneName;
      layer.options._paneSet = true;

      if (layer instanceof L.Path) {
        layer.options.renderer = renderer;
      }

      if (layer.eachLayer) {
        layer.eachLayer((l) => this._setLayerPaneRecursive(l, paneName, renderer));
      } else if (layer._layers) {
        for (const k in layer._layers) {
          if (layer._layers.hasOwnProperty(k)) {
            this._setLayerPaneRecursive(layer._layers[k], paneName, renderer);
          }
        }
      }
    }

    /** Find all custom panes used by a container's tree.
     *  This lets enforceOrder control z-index without requiring
     *  orderPane/paneName from three-layer components. */
    _discoverChildPanes(layer, depth = 0) {
      if (depth > 5) return []; // Prevent infinite recursion
      const panes = new Set();

      const check = (l) => {
        const p = l.options?.pane;
        if (p && !this._isDefaultPane(p)) {
          panes.add(p);
        }
        if (l.eachLayer) {
          this._discoverChildPanes(l, depth + 1).forEach((p2) => panes.add(p2));
        } else if (l._layers) {
          for (const k in l._layers) {
            this._discoverChildPanes(l._layers[k], depth + 1).forEach((p2) =>
              panes.add(p2),
            );
          }
        }
      };

      const selfPane = layer.options?.pane;
      if (selfPane && !this._isDefaultPane(selfPane)) {
        panes.add(selfPane);
      }

      if (layer.eachLayer) {
        layer.eachLayer(check);
      } else if (layer._layers) {
        for (const k in layer._layers) check(layer._layers[k]);
      }
      return Array.from(panes);
    }

    _isDefaultPane(pane) {
      return (
        pane === "overlayPane" ||
        pane === "markerPane" ||
        pane === "tilePane" ||
        pane === "shadowPane" ||
        pane === "mapPane" ||
        pane.startsWith("_lyr_")
      );
    }

    enforceOrder() {
      if (this._isEnforcing) return;
      this._isEnforcing = true;
      try {
        const orderedLayers = [];
        const layerInfos = new Map();

        for (let i = 0; i < this.layers.length; i++) {
          const l_id = this.layers[i].id;
          const layer = this.map._layers[l_id] || window[l_id] || null;
          if (layer && this.map.hasLayer(layer)) {
            orderedLayers.push(layer);
            layerInfos.set(L.stamp(layer), this.layers[i]);
          }
        }

        if (orderedLayers.length === 0) return;

        const layersToMove = [];
        let markerZ = 0; // highest z-index needed for markerPane
        for (let i = 0; i < orderedLayers.length; i++) {
          const lyr = orderedLayers[i];
          const info = layerInfos.get(L.stamp(lyr));
          const paneName = info?.paneName;
          const isTile = lyr instanceof L.TileLayer;

          // TileLayers use a lower z-index range (200-400) so they stay
          // below overlayPane (400) and markerPane (600) by default.
          const zBase = isTile ? 200 : CONST.Z_INDEX_BASE;
          // Scale z-index steps to allow room for sub-panes (labels, etc)
          // between major layers.
          const z = zBase + (orderedLayers.length - i) * 10;

          if (paneName) {
            const ep = this.ensurePane(paneName, !isTile);
            ep.pane.style.zIndex = z;
            if (lyr.options.pane !== paneName || !lyr.options._paneSet) {
              layersToMove.push({ layer: lyr, paneName, renderer: ep.renderer });
            }
          } else {
            // Auto-discover custom panes from container tree (three-layer
            // architecture). This ensures all internal panes (graph, label, etc.)
            // are assigned the same z-index base.
            const childPanes = this._discoverChildPanes(lyr);
            if (childPanes.length > 0) {
              childPanes.forEach((cp) => {
                const ep = this.ensurePane(cp, !isTile);
                ep.pane.style.zIndex = z;
                // Specific sub-layer logic: if label pane, it must be slightly higher
                if (cp.includes("label") || cp.includes("lbl")) {
                  ep.pane.style.zIndex = z + 1;
                }
              });
              lyr.options._paneSet = true;
              // Three-layer components use custom panes, not default markerPane.
              // Do NOT adjust markerZ — that would elevate all unmanaged point layers
              // (e.g. static GeoJSON markers) above this dynamic layer.
            } else {
              const fallbackPane = `_lyr_${L.stamp(lyr)}`;
              const ep = this.ensurePane(fallbackPane, !isTile);
              ep.pane.style.zIndex = z;
              if (!(lyr instanceof L.TileLayer)) {
                markerZ = Math.max(markerZ, z);
              }
              if (lyr.options.pane !== fallbackPane || !lyr.options._paneSet) {
                layersToMove.push({
                  layer: lyr,
                  paneName: fallbackPane,
                  renderer: ep.renderer,
                });
              }
            }
          }
        }

        // Sync markerPane z-index so non-paneName marker layers can sit
        // above/below paneName custom panes based on drag order.
        if (markerZ > 0) {
          const mp = this.map.getPane("markerPane");
          if (mp) mp.style.zIndex = markerZ;
        }

        if (layersToMove.length) {
          for (const { layer } of layersToMove) this.map.removeLayer(layer);
          for (const { layer, paneName, renderer } of layersToMove) {
            if (paneName) {
              this._setLayerPaneRecursive(layer, paneName, renderer);
            }
          }
          for (const { layer } of layersToMove) this.map.addLayer(layer);
        }
      } finally {
        this._isEnforcing = false;
      }
    }

    // UI Rendering & Event Binding
    attachUI(containerDiv) {
      this.uiContainer = containerDiv;
      this._renderInitialList();
      this._bindEvents();

      while (this.pendingRegistrations.length) {
        this.registerLayer(this.pendingRegistrations.shift());
      }

      setTimeout(() => this._initTypesAndVisibility(), CONST.INIT_DELAY_MS);
    }

    _renderInitialList() {
      let html = "";
      let hasBaseMaps = false;

      for (let i = 0; i < this.layers.length; i++) {
        const l = this.layers[i];
        if (l.isBase && !hasBaseMaps) {
          hasBaseMaps = true;
          html += `
              <div class="layer-separator-container">
              <span class="separator-label">${_(CONST.name + ".base_map_label")}</span>
              <div class="section-divider"></div>
            </div>`;
        }
        const en = LayerUtils.escapeHTML(l.name);
        html += `
          <div class="layer-item${l.isBase ? " is-base-item" : ""}" draggable="true"
               data-index="${i}" data-layer-id="${l.id}"
               title="${en}">
            ${SVGS.DRAG_HANDLE}
            <div class="checkbox-wrapper">
              <input type="checkbox" checked data-index="${i}"
                     aria-label="${en}">
            </div>
            <label title="${en}">${en}</label>
            <div class="type-icon-col">${l.iconSvg || ""}</div>
          </div>`;
      }

      html += `
        <div class="layer-item color-layer-item" draggable="false"
             data-layer-id="${CONST.COLOR_MAP_LAYER_ID}"
             title="${_(CONST.name + ".color_map_label")}">
          <div class="layer-item-spacer"></div>
          <div class="checkbox-wrapper">
            <input type="color" class="color-layer-input" value="${this.currentColor}"
                   aria-label="${_(CONST.name + ".color_map_label")}">
          </div>
          <label>${_(CONST.name + ".color_map_label")}</label>
          <div class="type-icon-col">${window.foliplus.SVGs.GLOBE}</div>
        </div>`;

      this.uiContainer.innerHTML = html;
    }

    _initTypesAndVisibility() {
      const inputs = this.uiContainer.querySelectorAll(
        '.layer-item input[type="checkbox"], .layer-item input[type="radio"]',
      );
      const typeCols = this.uiContainer.querySelectorAll(".type-icon-col");
      let anyBaseVisible = false;

      for (let i = 0; i < this.layers.length; i++) {
        const layerInfo = this.layers[i];
        const id = layerInfo.id;
        const layer = this.map._layers[id] || window[id] || null;

        if (inputs[i]) {
          inputs[i].checked =
            (layer != null && this.map.hasLayer(layer)) ||
            (layer && layer._map != null);
          const item = inputs[i].closest(".layer-item");
          if (item) {
            if (inputs[i].checked) item.classList.add("is-active");
            else item.classList.remove("is-active");
          }
        }

        if (typeCols[i]) {
          if (layerInfo.isBase) {
            typeCols[i].innerHTML = window.foliplus.SVGs.GLOBE;
            this.typeMap.set(id, { type: "base", name: layerInfo.name });
            if (inputs[i]?.checked) anyBaseVisible = true;
          } else if (layerInfo.iconSvg) {
            typeCols[i].innerHTML = layerInfo.iconSvg;
            this.typeMap.set(id, { type: "custom", name: layerInfo.name });
          } else if (layer) {
            typeCols[i].innerHTML = LayerUtils.getTypeSVG(layer);
            this.typeMap.set(id, {
              type: LayerUtils.getGeometryType(layer),
              name: layerInfo.name,
            });
          }
        }
      }

      if (!anyBaseVisible) this._showColorLayer(this.currentColor);
      this.enforceOrder();
    }

    _reindexItems() {
      const items = this.uiContainer.querySelectorAll(
        ".layer-item:not(.color-layer-item)",
      );
      for (let i = 0; i < items.length; i++) {
        items[i].dataset.index = String(i);
        const cb = items[i].querySelector('input[type="checkbox"]');
        if (cb) cb.dataset.index = String(i);
      }
    }

    // Event Handlers
    _bindEvents() {
      this.uiContainer.addEventListener("change", this._handleChange.bind(this));
      this.uiContainer.addEventListener("input", this._handleInput.bind(this));

      // Clicking anywhere on the color layer item deselects all base maps
      this.uiContainer.addEventListener("click", (e) => {
        if (e.target.closest(".color-layer-item")) {
          this._deselectAllBaseMaps(-1);
          this._showColorLayer(this.currentColor);
          this.enforceOrder();
        }
      });

      this.uiContainer.addEventListener("dragstart", this._handleDragStart.bind(this));
      this.uiContainer.addEventListener("dragover", this._handleDragOver.bind(this));
      this.uiContainer.addEventListener("dragleave", this._handleDragLeave.bind(this));
      this.uiContainer.addEventListener("drop", this._handleDrop.bind(this));
      this.uiContainer.addEventListener("dragend", this._handleDragEnd.bind(this));
    }

    _handleChange(e) {
      const target = e.target;
      if (target.classList.contains("color-layer-input")) {
        this._deselectAllBaseMaps(-1);
        this._showColorLayer(target.value);
        this.enforceOrder();
        return;
      }
      if (target.tagName.toLowerCase() !== "input" || target.type !== "checkbox")
        return;

      const idx = parseInt(target.dataset.index, 10);
      const layerInfo = this.layers[idx];
      const layer = this.map._layers[layerInfo.id] || window[layerInfo.id] || null;
      const item = target.closest(".layer-item");

      if (layerInfo.isBase) {
        this._hideColorLayer();
      }
      if (layer) {
        target.checked ? this.map.addLayer(layer) : this.map.removeLayer(layer);
      }

      if (item)
        target.checked
          ? item.classList.add("is-active")
          : item.classList.remove("is-active");
      this.enforceOrder();
    }

    _handleInput(e) {
      if (e.target.classList.contains("color-layer-input")) {
        this._showColorLayer(e.target.value);
      }
    }

    _handleDragStart(e) {
      const item = e.target.closest(".layer-item");
      if (!item) return;
      this.dragIdx = parseInt(item.dataset.index, 10);
      item.classList.add("dragging");
      e.dataTransfer.effectAllowed = "move";
    }

    _canReorderBetween(fromIdx, toIdx) {
      if (fromIdx == null || toIdx == null) return false;
      if (fromIdx < 0 || toIdx < 0) return false;
      if (fromIdx >= this.layers.length || toIdx >= this.layers.length) return false;
      const from = this.layers[fromIdx];
      const to = this.layers[toIdx];
      if (!from || !to) return false;
      // Keep drag-and-drop inside the same logical group.
      // Base maps can only reorder inside base-map group;
      // overlays can only reorder inside overlay group.
      if (!!from.isBase !== !!to.isBase) return false;

      const firstBaseIdx = this.layers.findIndex((l) => !!l.isBase);
      const hasBase = firstBaseIdx !== -1;

      // Overlay group: [0, firstBaseIdx - 1] (or whole list if no base maps)
      // Base group: [firstBaseIdx, end]
      if (!from.isBase) {
        const overlayEnd = hasBase ? firstBaseIdx - 1 : this.layers.length - 1;
        return fromIdx <= overlayEnd && toIdx <= overlayEnd;
      }

      return hasBase && fromIdx >= firstBaseIdx && toIdx >= firstBaseIdx;
    }

    _showReorderBlockedHint() {
      const now = Date.now();
      if (now - this.lastDragHintAt < CONST.DRAG_HINT_COOLDOWN_MS) return;
      this.lastDragHintAt = now;
      if (window.foliplus && typeof window.foliplus.showHint === "function") {
        window.foliplus.showHint(
          CONST.name,
          _(CONST.name + ".reorder_group_only"),
          1200,
        );
      }
    }

    _handleDragOver(e) {
      if (this.dragIdx === null) return;
      e.preventDefault();
      const item = e.target.closest(".layer-item");
      if (!item || item.classList.contains("color-layer-item")) return;

      const targetIdx = parseInt(item.dataset.index, 10);
      const allItems = this.uiContainer.querySelectorAll(".layer-item");
      allItems.forEach((i) => i.classList.remove("drag-over-top", "drag-over-bottom"));

      if (!this._canReorderBetween(this.dragIdx, targetIdx)) {
        if (e.dataTransfer) e.dataTransfer.dropEffect = "none";
        this._showReorderBlockedHint();
        return;
      }
      if (e.dataTransfer) e.dataTransfer.dropEffect = "move";

      if (targetIdx < this.dragIdx) item.classList.add("drag-over-top");
      else if (targetIdx > this.dragIdx) item.classList.add("drag-over-bottom");
    }

    _handleDragLeave(e) {
      const item = e.target.closest(".layer-item");
      if (item) item.classList.remove("drag-over-top", "drag-over-bottom");
    }

    _handleDrop(e) {
      e.preventDefault();
      const target = e.target.closest(".layer-item");
      if (this.dragIdx === null) return;
      if (!target) return;
      if (target.classList.contains("color-layer-item")) return;

      const targetIdx = parseInt(target.dataset.index, 10);
      if (this.dragIdx === targetIdx) return;
      if (!this._canReorderBetween(this.dragIdx, targetIdx)) {
        this._showReorderBlockedHint();
        return;
      }

      const moved = this.layers.splice(this.dragIdx, 1)[0];
      this.layers.splice(targetIdx, 0, moved);

      const allItems = Array.from(
        this.uiContainer.querySelectorAll(".layer-item:not(.color-layer-item)"),
      );
      const movedItem = allItems[this.dragIdx];

      if (targetIdx < this.dragIdx) {
        target.parentNode.insertBefore(movedItem, target);
      } else {
        target.parentNode.insertBefore(movedItem, target.nextSibling);
      }

      this._reindexItems();
      this.enforceOrder();
      this._saveOrder();
      this.dragIdx = null;
    }

    _handleDragEnd() {
      const allItems = this.uiContainer.querySelectorAll(".layer-item");
      allItems.forEach((i) =>
        i.classList.remove("dragging", "drag-over-top", "drag-over-bottom"),
      );
    }

    // Color Map Control Logic
    _showColorLayer(color) {
      this.colorActive = true;
      this.currentColor = color;
      mapContainer.style.background = color;

      for (let i = 0; i < this.layers.length; i++) {
        if (this.layers[i].isBase) {
          const l_id = this.layers[i].id;
          const bLayer = this.map._layers[l_id] || window[l_id] || null;
          if (bLayer && this.map.hasLayer(bLayer)) this.map.removeLayer(bLayer);
        }
      }

      const tilePane = this.map.getPane("tilePane");
      if (tilePane) {
        tilePane.style.visibility = "hidden";
        tilePane.style.opacity = "0";
      }

      const inputs = this.uiContainer.querySelectorAll(
        ".layer-item:not(.color-layer-item) input",
      );
      inputs.forEach((input, j) => {
        if (this.layers[j]?.isBase) {
          input.checked = false;
          input.closest(".layer-item")?.classList.remove("is-active");
        }
      });

      const ci = this.uiContainer.querySelector(".color-layer-input");
      if (ci) ci.value = color;
      this.uiContainer
        .querySelector(".color-layer-item")
        ?.classList.add("is-color-active");
    }

    _hideColorLayer() {
      this.colorActive = false;
      mapContainer.style.background = "";
      const tilePane = this.map.getPane("tilePane");
      if (tilePane) {
        tilePane.style.visibility = "";
        tilePane.style.opacity = "";
      }
      this.uiContainer
        .querySelector(".color-layer-item")
        ?.classList.remove("is-color-active");
    }

    _deselectAllBaseMaps(exceptIdx) {
      const inputs = this.uiContainer.querySelectorAll(
        ".layer-item:not(.color-layer-item) input",
      );
      for (let i = 0; i < this.layers.length; i++) {
        if (this.layers[i].isBase && i !== exceptIdx) {
          const l_id = this.layers[i].id;
          const bLayer = this.map._layers[l_id] || window[l_id] || null;
          if (bLayer && this.map.hasLayer(bLayer)) this.map.removeLayer(bLayer);
          if (inputs[i]) {
            inputs[i].checked = false;
            inputs[i].closest(".layer-item")?.classList.remove("is-active");
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

  const layerManager = new LayerManager(map);
  layerManager.init(initialData);

  // ==================== Leaflet Control Definition ====================
  class LayerControl extends L.Control {
    onAdd() {
      const container = L.DomUtil.create("div", "leaflet-bar leaflet-control");

      container.innerHTML = `
        <div class="map-panel ctrl-fold layer-ctrl collapsed"
             id="{{ this.get_name() }}_ctrl">
          <button class="toggle-btn" title="${_(CONST.name + ".toggle_title")}"
                  aria-label="${_(CONST.name + ".toggle_title")}">
            ${SVGS.LIST}
          </button>
          <div class="layer-panel" role="dialog"
               aria-label="${_(CONST.name + ".panel_title")}">
            <div class="panel-header" title="${_(CONST.name + ".close_title")}">
              <span class="header-title">
                <span class="header-icon">${SVGS.LIST}</span>
                ${_(CONST.name + ".panel_title")}
              </span>
              <button class="close-btn ctrl-abs-btn" title="${_(CONST.name + ".close_title")}"
                      aria-label="${_(CONST.name + ".close_title")}">
                ${window.foliplus.SVGs.CLOSE}
              </button>
            </div>
            <div class="panel-content"></div>
          </div>
        </div>
      `;

      L.DomEvent.disableClickPropagation(container);
      L.DomEvent.disableScrollPropagation(container);

      const ctrl = container.querySelector(".layer-ctrl");
      const panelContent = container.querySelector(".panel-content");

      window.foliplus.bindPanelToggle({
        container: ctrl,
        toggleBtn: ".toggle-btn",
        header: ".panel-header",
      });

      layerManager.attachUI(panelContent);

      return container;
    }
  }

  new LayerControl({ position: "{{ this.position }}" }).addTo(map);
})();
