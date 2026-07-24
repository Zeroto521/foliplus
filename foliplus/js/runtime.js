/**
 * Shared utility namespace for all foliplus map controls.
 * Provides SVG icons, hint system, coordinate transformation, geocoding,
 * and common UI helpers.
 */
(function (window, document) {
  "use strict";
  // 1. Ensure global namespace object exists
  if (!window.foliplus || typeof window.foliplus !== "object") window.foliplus = {};
  const foliplus = window.foliplus;

  /**
   * Translate a locale key to its localized value.
   * Falls back to the key itself if no translation is found.
   *
   * @param {string} k - Locale key (e.g. 'export.btn_title', 'heatmap.title')
   * @returns {string} Localized string, or the key if not found
   *
   * @example
   *   foliplus.gt('export.btn_title') // → 'Export Map' (en) / '导出地图' (zh)
   *   foliplus.gt('nonexistent.key')  // → 'nonexistent.key'
   */
  foliplus.gt =
    foliplus.gt ||
    function (k) {
      const loc = window._LOCALE;
      return loc && loc[k] ? loc[k] : k;
    };

  // 3. Early return only if logic is already initialized
  if (foliplus._initialized) return;
  foliplus._initialized = true;

  // Private state (closure-scoped, not exposed on foliplus)
  let hintIcons = {};

  // ==================== Constants ====================
  const HINT = {
    BOTTOM_BASE: 20,
    STACK_GAP: 40,
    Z_BASE: 10000,
    DEFAULT_DURATION: 3000,
    SHORT: 1200,
    MEDIUM: 2500,
    LONG: 4000,
    PERSIST: 0,
  };
  // Expose hint duration tiers for other components
  foliplus.HINT_DURATION = {
    SHORT: HINT.SHORT,
    MEDIUM: HINT.MEDIUM,
    LONG: HINT.LONG,
    PERSIST: HINT.PERSIST,
  };
  const GEO = {
    THROTTLE_MS: 1000,
    NOMINATIM_ZOOM: 18,
  };
  const PIN = {
    SIZE: [24, 36],
    ANCHOR: [12, 36],
    POPUP_ANCHOR: [0, -36],
  };
  const POPUP = {
    MAX_WIDTH: 300,
  };
  const CLASSES = {
    COLLAPSED: "collapsed",
    EXPANDED: "expanded",
    TOGGLE_BTN: "foliplus-toggle-btn",
    LEAFLET_BAR: "leaflet-bar leaflet-control",
    MAP_HINT: "foliplus-map-hint",
  };

  // --- SVG Icons ---
  foliplus.SVGs = {
    LOADING: `<svg class="foliplus-spin" viewBox="0 0 24 24"><path d="M21 12a9 9 0 1 1-6.2-8.6"/></svg>`,
    CLOSE: `
      <svg viewBox="0 0 24 24">
        <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
      </svg>`,
    PIN_ICON: `
      <div class="foliplus-pin-wrap">
        <svg width="24" height="36" viewBox="0 0 24 36">
          <path d="M12 0C5.4 0 0 5.4 0 12c0 9 12 24 12 24s12-15 12-24 C24 5.4 18.6 0 12 0z"
              fill="#e74c3c" stroke="#fff" stroke-width="1.5"/>
        <circle cx="12" cy="12" r="4.5" fill="#fff"/>
        </svg>
      </div>`,
    LOCATE: `
      <svg viewBox="0 0 24 24">
        <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z"/>
        <circle cx="12" cy="9" r="2.5"/>
      </svg>`,
    GLOBE: `
      <svg viewBox="0 0 24 24">
        <circle cx="12" cy="12" r="10"/>
        <ellipse cx="12" cy="12" rx="4" ry="10"/>
        <line x1="2" y1="12" x2="22" y2="12"/>
      </svg>`,
  };

  // ==================== Hint / Toast System ====================
  const hintMap = new Map(); // key -> { element, timer }

  /**
   * Register an SVG icon for a hint type. The icon is prepended to the
   * hint text when `showHint(key, ...)` is called with a matching key.
   *
   * @param {string} key     - Unique hint type identifier (e.g. 'export', 'measure')
   * @param {string} iconSvg - SVG markup string to display before the text
   *
   * @example
   *   foliplus.registerHintIcon('export', '<svg>...</svg>');
   *   foliplus.showHint('export', 'Exporting...'); // shows icon + text
   */
  foliplus.registerHintIcon = (key, iconSvg) => {
    hintIcons[key] = iconSvg;
  };

  /**
   * Display a hint toast at the bottom-center of the viewport.
   * During native browser fullscreen, hints are mounted on the fullscreen
   * element so they remain visible.
   *
   * @param {string}  key      - Hint type identifier. Overrides previous hint
   *                             with the same key unless `append=true`.
   * @param {string}  text     - The hint message text.
   * @param {number}  [duration=3000] - Time in ms before auto-hide.
   *                                    Use `0` for persistent (until `hideHint`).
   * @param {boolean} [append=false] - If `true`, appends a new hint instance
   *                                   without removing existing ones with the
   *                                   same key. The instance auto-clears after
   *                                   `duration` ms. Keys are suffixed with a
   *                                   timestamp for individual removal.
   *
   * @example
   *   // Persistent hint (replaces previous 'export' hint)
   *   foliplus.showHint('export', 'Locked — zoom to adjust', 0);
   *
   *   // Temporary appended hint (does not overwrite persistent one)
   *   foliplus.showHint('export', 'Restored previous area', 3000, true);
   *
   *   // Remove all hints of a type
   *   foliplus.hideHint('export');
   *   // Remove appended instances individually
   *   foliplus.hideHint('export-1234567890');
   */
  foliplus.showHint = (key, text, duration, append) => {
    if (!append) foliplus.hideHint(key);
    const hintTarget = document.fullscreenElement || document.body;
    const cls = append
      ? `${CLASSES.MAP_HINT} ${CLASSES.MAP_HINT}-${key}-${Date.now()}`
      : `${CLASSES.MAP_HINT} ${CLASSES.MAP_HINT}-${key}`;
    const el = L.DomUtil.create("div", cls, hintTarget);
    const icon = (hintIcons && hintIcons[key]) || "";
    el.innerHTML = icon
      ? `<span class="foliplus-map-hint-icon">${icon}</span>${text}`
      : text;
    el.classList.add(CLASSES.MAP_HINT);
    if (hintTarget !== document.body && hintTarget !== document.documentElement) {
      const cs = window.getComputedStyle(hintTarget);
      if (cs.position === "static") hintTarget.style.position = "relative";
    }
    const storeKey = append ? key + "-" + Date.now() : key;
    hintMap.set(storeKey, { element: el, timer: null });

    const reposition = () => {
      let idx = 0;
      for (let v of hintMap.values()) {
        v.element.style.bottom = `${HINT.BOTTOM_BASE + idx * HINT.STACK_GAP}px`;
        v.element.style.zIndex = HINT.Z_BASE + idx;
        idx++;
      }
    };
    reposition();

    if (duration !== 0) {
      hintMap.get(storeKey).timer = setTimeout(
        () => foliplus.hideHint(storeKey),
        duration || HINT.DEFAULT_DURATION,
      );
    }
  };

  /**
   * Remove a hint (and any appended instances sharing the key prefix).
   * Repositions remaining hints after removal.
   *
   * @param {string} key - Hint key to remove (also removes `key-{timestamp}` appended instances)
   *
   * @example
   *   foliplus.hideHint('export');            // removes all export hints
   *   foliplus.hideHint('gcoord-warn');       // removes gcoord warning
   */
  foliplus.hideHint = (key) => {
    // Also clear appended instances (keys start with key+'-')
    for (const k of hintMap.keys()) {
      if (k === key || k.startsWith(key + "-")) {
        const entry = hintMap.get(k);
        if (entry.timer) clearTimeout(entry.timer);
        if (entry.element) entry.element.remove();
        hintMap.delete(k);
      }
    }

    let idx = 0;
    for (let v of hintMap.values()) {
      v.element.style.bottom = `${HINT.BOTTOM_BASE + idx * HINT.STACK_GAP}px`;
      idx++;
    }
  };

  // ==================== Coordinate Transformation ====================
  /**
   * Detect whether the map uses Baidu coordinate system (BD-09).
   * Checks L.CRS.Baidu, crs.code, and tile URL patterns.
   *
   * @param {L.Map} map - Leaflet map instance
   * @returns {boolean} True if the map uses Baidu CRS
   *
   * @example
   *   isBaiduCRS(map) // → true if Baidu tiles are used
   */
  const isBaiduCRS = (map) => {
    try {
      if (L.CRS && L.CRS.Baidu) return true;
      const crs = map.options.crs;
      if (crs && (crs.code || "").toLowerCase().includes("baidu")) return true;
      const layers = map._layers;
      for (let id in layers) {
        if (layers[id]._url && layers[id]._url.includes("bdimg.com")) return true;
      }
      return false;
    } catch (e) {
      return false;
    }
  };

  /**
   * Ensure that the gcoord library is loaded. If not, logs a warning and shows a hint.
   * @returns {boolean} True if gcoord is available, false otherwise.
   */
  function ensureGcoord() {
    if (typeof gcoord === "undefined") {
      console.warn(`[MapSearch] ${foliplus.gt("MapSearch.gcoord_warn")}`);
      foliplus.showHint(
        "MapSearch",
        `${foliplus.gt("MapSearch.gcoord_warn")}`,
        HINT.LONG,
      );
      return false;
    }
    return true;
  }

  /**
   * Detect the map's coordinate reference system type: 'BD09', 'GCJ02', or 'WGS84'.
   * @param {L.Map} map - Leaflet map instance
   * @returns {string} 'BD09' | 'GCJ02' | 'WGS84' (WGS84 indicates foreign maps that do not require conversion)
   */
  function getMapCrsType(map) {
    if (isBaiduCRS(map)) return "BD09";
    if (isDomesticMap(map)) return "GCJ02";
    return "WGS84";
  }

  /**
   * Convert map-displayed coordinates (GCJ-02 / BD-09) to WGS-84.
   * Automatically detects the map CRS (Baidu → BD09, domestic → GCJ02).
   * If gcoord library is not yet loaded, schedules async loading and
   * returns the input coordinates unchanged (with a console warning).
   *
   * @param {L.Map} map - Leaflet map instance
   * @param {number} lng - Longitude in map CRS
   * @param {number} lat - Latitude in map CRS
   * @returns {number[]} [lng, lat] in WGS-84
   *
   * @example
   *   const wgs = foliplus.toWgs84(map, 121.47, 31.23);
   *   // → [121.464, 31.225] (approx. WGS-84)
   */
  foliplus.toWgs84 = (map, lng, lat) => {
    if (!ensureGcoord()) return [lng, lat];

    const srcType = getMapCrsType(map);
    if (srcType === "WGS84") return [lng, lat];

    const src = srcType === "BD09" ? gcoord.BD09 : gcoord.GCJ02;
    return gcoord.transform([lng, lat], src, gcoord.WGS84);
  };

  /**
   * Convert WGS-84 coordinates to the map's display CRS (BD09 / GCJ02).
   * Automatically detects the map CRS. Non-domestic maps (no Baidu/AMap
   * tile patterns) are returned unchanged.
   *
   * @param {L.Map} map - Leaflet map instance
   * @param {number} lng - Longitude in WGS-84
   * @param {number} lat - Latitude in WGS-84
   * @returns {number[]} [lng, lat] in map CRS
   */
  foliplus.fromWgs84 = (map, lng, lat) => {
    if (!ensureGcoord()) return [lng, lat];

    const dstType = getMapCrsType(map);
    if (dstType === "WGS84") return [lng, lat];

    const dst = dstType === "BD09" ? gcoord.BD09 : gcoord.GCJ02;
    return gcoord.transform([lng, lat], gcoord.WGS84, dst);
  };

  /**
   * Detect whether a map uses domestic Chinese tile providers.
   * Checks Baidu, AutoNavi, Tianditu, Tencent, Google, and AMap URL patterns.
   *
   * @param {L.Map} map - Leaflet map instance
   * @returns {boolean} True if the map uses domestic tile providers
   */
  const isDomesticMap = (map) => {
    try {
      const crs = map.options.crs;
      if (crs && (crs.code || "").toLowerCase().includes("baidu")) return true;
      const layers = map._layers;
      for (let id in layers) {
        if (layers[id]._url) {
          const url = layers[id]._url;
          if (
            url.includes("bdimg.com") ||
            url.includes("autonavi") ||
            url.includes("tianditu") ||
            url.includes("gtimg.com") ||
            url.includes("googleapis") ||
            url.includes("amap.com")
          )
            return true;
        }
      }
      return false;
    } catch (e) {
      return false;
    }
  };

  // ==================== Reverse Geocoding ====================
  // Uses throttled queue (1 req/s) and response cache.
  const geoCache = {};
  let geoPromise = Promise.resolve();
  let geoLastReq = 0;

  /**
   * Reverse geocode coordinates to an address via Nominatim.
   * Results are cached. Requests are throttled to 1 req/s.
   * @param {L.Map} map Leaflet map instance
   * @param {number} lng Longitude
   * @param {number} lat Latitude
   * @returns {Promise<string>} Resolved address string
   */
  foliplus.reverseGeocode = (map, lng, lat) => {
    const key = `${lng},${lat}`;
    if (geoCache[key]) return Promise.resolve(geoCache[key]);

    const wgs = foliplus.toWgs84(map, parseFloat(lng), parseFloat(lat));
    const lang = (window._LOCALE && window._LOCALE["locale.code"]) || "en";
    const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${wgs[1]}&lon=${wgs[0]}&zoom=${GEO.NOMINATIM_ZOOM}&accept-language=${lang}`;

    geoPromise = geoPromise
      .then(() => {
        const wait = Math.max(0, GEO.THROTTLE_MS - (Date.now() - geoLastReq));
        return new Promise((r) => setTimeout(r, wait));
      })
      .then(() => {
        geoLastReq = Date.now();
        return fetch(url)
          .then((r) => r.json())
          .then((data) => {
            let addr = data.display_name || "";
            addr = addr
              .split(",")
              .map((s) => s.trim())
              .filter((s) => s && !/^\d+$/.test(s))
              .reverse()
              .join(",");
            geoCache[key] = addr || foliplus.gt("MapSearch.addr_not_found");
            return geoCache[key];
          })
          .catch(() => foliplus.gt("MeasureControl.geo_fail"));
      });
    return geoPromise;
  };

  // ==================== DOM Helpers ====================
  /**
   * Lightweight DOM builder — create elements without string concatenation.
   *
   * @example
   *   // Create a div with class and text content
   *   window.foliplus.dom.el("div", { class: "my-class" }, "Hello")
   *
   *   // Nested children
   *   window.foliplus.dom.el("div", null,
   *     window.foliplus.dom.el("span", { class: "icon" }),
   *     window.foliplus.dom.el("label", null, "Name")
   *   )
   *
   *   // Set innerHTML by passing a { html: "..." } child
   *   window.foliplus.dom.el("div", null, { html: "<svg>...</svg>" })
   */
  foliplus.dom = {
    /**
     * Create an element with attributes and children.
     * @param {string} tag - HTML tag name.
     * @param {Object|null} attrs - Attributes map (class, id, data-*, etc.).
     * @param  {...any} children - Strings (text), {html: str} (innerHTML),
     *                             or DOM elements (appendChild).
     * @returns {HTMLElement}
     */
    el(tag, attrs = {}, ...children) {
      const el = document.createElement(tag);
      if (attrs) {
        for (const [key, val] of Object.entries(attrs)) {
          if (val == null) continue;
          if (key === "class") el.className = val;
          else if (key === "style" && typeof val === "object")
            Object.assign(el.style, val);
          else el.setAttribute(key, String(val));
        }
      }
      for (const child of children) {
        if (child == null) continue;
        if (typeof child === "string" || typeof child === "number")
          el.appendChild(document.createTextNode(String(child)));
        else if (child.html) el.insertAdjacentHTML("beforeend", child.html);
        else if (child.nodeType) el.appendChild(child);
      }
      return el;
    },
  };

  /**
   * Build a popup HTML string for a location marker.
   * @param {number} lng Longitude
   * @param {number} lat Latitude
   * @param {string|null} addr Address text or null (triggers loading indicator)
   * @param {string} title Locale key for popup title (e.g. 'MeasureControl.popup_title')
   * @param {string} loading Locale key for loading text (e.g. 'MeasureControl.popup_loading')
   * @param {string} locLabel Locale key for location label (e.g. 'MeasureControl.popup_loc_label')
   * @param {string} addrLabel Locale key for address label (e.g. 'MeasureControl.popup_addr_label')
   * @returns {string} HTML string
   */
  foliplus.buildPopupHtml = (lng, lat, addr, title, loading, locLabel, addrLabel) => {
    const loadStr = foliplus.gt(loading);
    const addrHtml =
      addr && addr.includes("LOADING")
        ? { html: foliplus.SVGs.LOADING + " " + loadStr }
        : addr || loadStr;

    return window.foliplus.dom.el(
      "div",
      { class: "foliplus-popup-content" },
      window.foliplus.dom.el("b", null, foliplus.gt(title)),
      { html: "<br>" },
      foliplus.gt(locLabel) + lng + "," + lat,
      { html: "<br>" },
      foliplus.gt(addrLabel),
      typeof addrHtml === "object" ? addrHtml : addrHtml,
    ).outerHTML;
  };

  /**
   * Create a location marker with a popup and add it to the map.
   * @param {L.Map} map Leaflet map instance
   * @param {number} lng Longitude
   * @param {number} lat Latitude
   * @param {string} addr Address string (null = pending reverse geocode)
   * @param {string} title Locale key for popup title
   * @param {string} loading Locale key for loading text
   * @param {string} locLabel Locale key for location label
   * @param {string} addrLabel Locale key for address label
   * @param {L.Marker} [existing] Existing marker to remove before creating new one
   * @param {L.LayerGroup} [layerGroup] Optional layer group to add the marker to
   * @returns {L.Marker} The newly created marker
   */
  foliplus.createLocationMarker = (
    map,
    lng,
    lat,
    addr,
    title,
    loading,
    locLabel,
    addrLabel,
    existing,
    layerGroup,
  ) => {
    if (existing) map.removeLayer(existing);
    const target = layerGroup || map;
    const mk = L.marker([lat, lng], {
      icon: L.divIcon({
        className: "",
        html: foliplus.SVGs.PIN_ICON,
        iconSize: PIN.SIZE,
        iconAnchor: PIN.ANCHOR,
        popupAnchor: PIN.POPUP_ANCHOR,
      }),
    });
    target.addLayer(mk);
    mk.bindPopup(
      foliplus.buildPopupHtml(lng, lat, addr, title, loading, locLabel, addrLabel),
      { maxWidth: POPUP.MAX_WIDTH },
    );
    mk.openPopup();
    if (!addr) {
      foliplus.reverseGeocode(map, lng, lat).then((resolved) => {
        if (mk && mk.getPopup() && mk.getPopup().isOpen()) {
          mk.setPopupContent(
            foliplus.buildPopupHtml(
              lng,
              lat,
              resolved,
              title,
              loading,
              locLabel,
              addrLabel,
            ),
          );
        }
      });
    }
    return mk;
  };

  /**
   * Bind click events to toggle a panel (expand / collapse).
   * @param {object} opts
   * @param {HTMLElement} opts.container - Panel root element
   * @param {string} opts.toggleBtn - Selector for the toggle button
   * @param {string} opts.header - Selector for the header (click to collapse)
   */
  foliplus.bindPanelToggle = ({ container, toggleBtn, header }) => {
    const btn = container.querySelector(toggleBtn);
    if (btn) {
      L.DomEvent.on(btn, "click", (e) => {
        L.DomEvent.stop(e);
        container.classList.remove(CLASSES.COLLAPSED);
        container.classList.add(CLASSES.EXPANDED);
      });
    }
    const hdr = container.querySelector(header);
    if (hdr) {
      L.DomEvent.on(hdr, "click", (e) => {
        L.DomEvent.stop(e);
        container.classList.remove(CLASSES.EXPANDED);
        container.classList.add(CLASSES.COLLAPSED);
      });
    }
  };

  /**
   * Collapse a panel when clicking outside of it.
   * Sets up a MutationObserver to auto-cleanup when the container is removed.
   * @param {object} opts
   * @param {HTMLElement} opts.container - Panel element to watch
   * @returns {Function} Cleanup function to remove the click listener
   */
  foliplus.bindOutsideCollapse = ({ container }) => {
    const handler = (e) => {
      if (
        !container.contains(e.target) &&
        container.classList.contains(CLASSES.EXPANDED)
      ) {
        container.classList.remove(CLASSES.EXPANDED);
        container.classList.add(CLASSES.COLLAPSED);
      }
    };
    document.addEventListener("click", handler);

    // Auto-cleanup: remove listener when container is removed from DOM
    const cleanup = () => document.removeEventListener("click", handler);
    const obs = new MutationObserver(() => {
      if (!document.body.contains(container)) {
        cleanup();
        obs.disconnect();
      }
    });
    obs.observe(document.body, { childList: true, subtree: true });

    return cleanup;
  };

  /**
   * Create a fold (expand/collapse) control container with toggle button and toolbar.
   * Shared by MeasureControl and ExportControl for consistent UI.
   * @param {object} opts
   * @param {string} opts.cssClass - Unique CSS class, e.g. 'measure-ctrl' or 'export-ctrl'
   * @param {string} opts.toggleTitle - Tooltip for the toggle button
   * @param {string} opts.toggleSvg - SVG HTML for the toggle icon
   * @param {boolean} opts.isLeft - Whether position is left-aligned
   * @returns {object} { container, ctrl, toolBar, toggleBtn }
   */
  foliplus.createFoldControl = (opts) => {
    const container = window.foliplus.dom.el("div", {
      class: CLASSES.LEAFLET_BAR,
    });
    const ctrl = window.foliplus.dom.el("div", {
      class: `${opts.cssClass} foliplus-ctrl-fold ${CLASSES.COLLAPSED}`,
    });
    ctrl.appendChild(
      window.foliplus.dom.el(
        "button",
        { class: CLASSES.TOGGLE_BTN, title: opts.toggleTitle },
        { html: opts.toggleSvg },
      ),
    );
    ctrl.appendChild(window.foliplus.dom.el("div", { class: "foliplus-tool-bar" }));
    container.appendChild(ctrl);
    if (!opts.isLeft) ctrl.classList.add("foliplus-align-right");
    L.DomEvent.disableClickPropagation(container);
    L.DomEvent.disableScrollPropagation(container);
    return {
      container: container,
      ctrl: ctrl,
      toolBar: ctrl.querySelector(".foliplus-tool-bar"),
      toggleBtn: ctrl.querySelector(".foliplus-toggle-btn"),
    };
  };

  /**
   * Create a panel-style control with toggle button, header, and content area.
   * Used by HeatmapControl and LayerControl for consistent panel UI.
   * Automatically wires up bindPanelToggle and bindOutsideCollapse.
   * @param {object} opts
   * @param {string} opts.cssClass - Unique CSS class, e.g. 'heatmap-ctrl' or 'layer-ctrl'
   * @param {string} opts.toggleTitle - Tooltip for the toggle button
   * @param {string} opts.toggleSvg - SVG HTML for the toggle icon
   * @param {string} opts.panelTitle - Header title text
   * @param {string} opts.closeTitle - Tooltip for close button
   * @returns {object} { container, ctrl, toggleBtn, panelContent }
   */
  foliplus.createPanelControl = (opts) => {
    const container = window.foliplus.dom.el("div", {
      class: CLASSES.LEAFLET_BAR,
    });
    const ctrl = window.foliplus.dom.el("div", {
      class: `foliplus-map-panel foliplus-ctrl-fold ${opts.cssClass} ${CLASSES.COLLAPSED}`,
    });
    ctrl.appendChild(
      window.foliplus.dom.el(
        "button",
        { class: CLASSES.TOGGLE_BTN, title: opts.toggleTitle },
        { html: opts.toggleSvg },
      ),
    );
    const panelWrap = window.foliplus.dom.el("div", { class: "foliplus-panel-wrap" });
    const header = window.foliplus.dom.el("div", { class: "foliplus-panel-header" });
    header.appendChild(
      window.foliplus.dom.el(
        "span",
        { class: "foliplus-header-title" },
        window.foliplus.dom.el(
          "span",
          { class: "foliplus-header-icon" },
          { html: opts.toggleSvg },
        ),
        opts.panelTitle,
      ),
    );
    header.appendChild(
      window.foliplus.dom.el(
        "button",
        { class: "foliplus-close-btn foliplus-ctrl-btn", title: opts.closeTitle },
        { html: window.foliplus.SVGs.CLOSE },
      ),
    );
    panelWrap.appendChild(header);
    const panelContent = window.foliplus.dom.el("div", {
      class: "foliplus-panel-content",
    });
    panelWrap.appendChild(panelContent);
    ctrl.appendChild(panelWrap);
    container.appendChild(ctrl);

    L.DomEvent.disableClickPropagation(container);
    L.DomEvent.disableScrollPropagation(container);

    window.foliplus.bindPanelToggle({
      container: ctrl,
      toggleBtn: ".foliplus-toggle-btn",
      header: ".foliplus-panel-header",
    });
    window.foliplus.bindOutsideCollapse({ container: ctrl });

    return {
      container,
      ctrl,
      toggleBtn: ctrl.querySelector(".foliplus-toggle-btn"),
      panelContent,
    };
  };

  // ==================== Number Formatting ====================
  /**
   * Format a number for display.
   * @param {number} val Value to format
   * @param {string} [style='auto'] 'auto' (compact: 1.2K/1.2W/1.2M),
   *                                'comma' or 'int' (thousands separator: 1,234.6)
   * @param {string} [locale] Locale code, defaults to browser language (en/zh)
   * @returns {string} Formatted string
   */
  foliplus.formatNumber = (val, style, locale) => {
    style = style || "auto";
    locale =
      locale || (typeof window._LOCALE !== "undefined" && window._LOCALE["locale.code"]) || "en";
    const absVal = Math.abs(val);

    const fmt = (maxFrac) =>
      new Intl.NumberFormat(locale, {
        notation: style === "auto" && absVal >= 1000 ? "compact" : "standard",
        compactDisplay: "short",
        maximumFractionDigits: maxFrac,
      });

    if (style === "auto") {
      const nf = fmt(1);
      const parts = nf.formatToParts(val);
      const intStr = parts
        .filter((p) => p.type === "integer")
        .map((p) => p.value)
        .join("");
      if (intStr.length >= 3) return fmt(0).format(val);

      return nf.format(val);
    }

    return fmt(absVal >= 100 ? 0 : 1).format(val);
  };

  // ==================== Locale resolution ====================
  /**
   * Resolve the locale table for the current page by checking (in order):
   * explicit code, parent iframe path, referrer URL, document URL path,
   * HTML lang attribute, and browser language. Defaults to `tables['en']`.
   *
   * Sets `window._LOCALE` so that `foliplus.gt(key)` returns the correct translation.
   *
   * Called automatically from each control's Jinja2 template:
   *   `foliplus.resolveLocale('{{ this._LOCALE_CODE }}'{, tables...});`
   *
   * @param {string} code   - Locale code from Python (e.g. '' for auto-detect)
   * @param {Object} tables - Map of locale code → translation table
   *                          e.g. `{ en: { title: 'Export Map' }, zh: { title: '导出地图' }}`
   *
   * @example
   *   // Called from template:
   *   foliplus.resolveLocale('zh', { en: { title: 'Export Map' }, zh: { title: '导出地图' }});
   *   // → window._LOCALE = zh table
   *   foliplus.gt('export.btn_title') // → '导出地图'
   */
  foliplus.resolveLocale = (code, tables) => {
    if (!tables) return;
    let lang = "";

    // 1. Explicit code from Python (Highest priority if provided)
    if (code && tables[code]) lang = code;

    // 2. Detect from parent context if inside an iframe (e.g., ReadTheDocs/Sphinx same-origin iframe)
    if (!lang) {
      try {
        const parentWin = window.parent;
        if (parentWin && parentWin !== window) {
          // Check parent URL path
          const parentPath = parentWin.location.pathname;
          const m = parentPath.match(/\/(en|zh)\//i);
          if (m) lang = m[1].toLowerCase();

          // Check parent HTML lang attribute
          if (!lang) {
            let pLang = parentWin.document.documentElement.lang || "";
            if (pLang) {
              pLang = pLang.split("-")[0].split("_")[0].toLowerCase();
              if (tables[pLang]) lang = pLang;
            }
          }
        }
      } catch (e) {
        // Ignore cross-origin iframe security restrictions
      }
    }

    // 3. Detect from embedding referrer URL (highly reliable backup for iframes, works cross-origin)
    if (!lang && typeof document !== "undefined" && document.referrer) {
      const m = document.referrer.match(/\/(en|zh)\//i);
      if (m && tables[m[1].toLowerCase()]) lang = m[1].toLowerCase();
    }

    // 4. Detect from current window URL path (ReadTheDocs / GitHub Pages common patterns: /en/, /zh/)
    if (!lang) {
      const path = window.location.pathname;
      const m = path.match(/\/(en|zh)\//i);
      if (m && tables[m[1].toLowerCase()]) lang = m[1].toLowerCase();
    }

    // 5. HTML lang attribute (e.g. <html lang="en">)
    if (!lang || !tables[lang]) {
      let htmlLang = document.documentElement.lang || "";
      if (htmlLang) {
        htmlLang = htmlLang.split("-")[0].split("_")[0].toLowerCase();
        if (tables[htmlLang]) lang = htmlLang;
      }
    }

    // 6. Browser language
    if (!lang || !tables[lang]) {
      lang = (
        typeof navigator !== "undefined"
          ? navigator.language || navigator.userLanguage || ""
          : ""
      )
        .split("-")[0]
        .split("_")[0]
        .toLowerCase();
    }

    window._LOCALE = tables[lang] || tables["en"];
  };

  /**
   * Shared debounce utility. Returns a debounced version of `fn` that
   * delays invocation until `delayMs` ms after the last call.
   * The returned function has a `.cancel()` method to clear pending timers.
   *
   * @param {function} fn      - The function to debounce.
   * @param {number}   delayMs - Delay in milliseconds.
   * @returns {function} Debounced function with `.cancel()`.
   *
   * @example
   *   const cb = foliplus.debounce(() => save(), 200);
   *   window.addEventListener("resize", cb);    // fires at most once per 200ms
   *   cb.cancel();                               // cancel pending
   */
  foliplus.debounce = (fn, delayMs) => {
    let timer = null;
    const debounced = (...args) => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        fn(...args);
      }, delayMs);
    };
    debounced.cancel = () => {
      if (timer) clearTimeout(timer);
      timer = null;
    };
    debounced.flush = () => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
        fn();
      }
    };
    return debounced;
  };
})(window, document);
