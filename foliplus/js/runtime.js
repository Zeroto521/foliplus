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
  let _hintIcons = {};
  let _gcoordLoading = false;
  let _gcoordWarned = false;

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

  // --- SVG Icons ---
  foliplus.SVGs = {
    LOADING: `<svg class="spin" viewBox="0 0 24 24"><path d="M21 12a9 9 0 1 1-6.2-8.6"/></svg>`,
    CLOSE: `
      <svg viewBox="0 0 24 24">
        <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
      </svg>`,
    PIN_ICON: `
      <div class="pin-wrap">
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
    SEARCH: `
      <svg viewBox="0 0 24 24">
        <circle cx="10.5" cy="10.5" r="6.5"/>
        <line x1="15.5" y1="15.5" x2="21" y2="21"/>
      </svg>`,
  };

  // ==================== Hint / Toast System ====================
  const _hintMap = new Map(); // key -> { element, timer }

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
    _hintIcons[key] = iconSvg;
  };
  _hintIcons["MapSearch"] = foliplus.SVGs.SEARCH;

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
      ? `map-hint map-hint-${key}-${Date.now()}`
      : `map-hint map-hint-${key}`;
    const el = L.DomUtil.create("div", cls, hintTarget);
    const icon = (_hintIcons && _hintIcons[key]) || "";
    el.innerHTML = icon ? `<span class="map-hint-icon">${icon}</span>${text}` : text;
    el.classList.add("map-hint");
    if (hintTarget !== document.body && hintTarget !== document.documentElement) {
      const cs = window.getComputedStyle(hintTarget);
      if (cs.position === "static") hintTarget.style.position = "relative";
    }
    const storeKey = append ? key + "-" + Date.now() : key;
    _hintMap.set(storeKey, { element: el, timer: null });

    const _reposition = () => {
      let idx = 0;
      for (let v of _hintMap.values()) {
        v.element.style.bottom = `${HINT.BOTTOM_BASE + idx * HINT.STACK_GAP}px`;
        v.element.style.zIndex = HINT.Z_BASE + idx;
        idx++;
      }
    };
    _reposition();

    if (duration !== 0) {
      _hintMap.get(storeKey).timer = setTimeout(
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
    for (const k of _hintMap.keys()) {
      if (k === key || k.startsWith(key + "-")) {
        const entry = _hintMap.get(k);
        if (entry.timer) clearTimeout(entry.timer);
        if (entry.element) entry.element.remove();
        _hintMap.delete(k);
      }
    }

    let idx = 0;
    for (let v of _hintMap.values()) {
      v.element.style.bottom = `${HINT.BOTTOM_BASE + idx * HINT.STACK_GAP}px`;
      idx++;
    }
  };

  // ==================== Coordinate Transformation ====================
  /**
   * Ensure gcoord library is loaded.
   * If not loaded, dynamically injects the CDN script and returns false.
   *
   * @returns {boolean} True if gcoord is already available, false otherwise
   */
  const _ensureGcoord = () => {
    if (typeof gcoord !== "undefined") return true;
    if (!_gcoordLoading) {
      _gcoordLoading = true;
      const s = document.createElement("script");
      s.src =
        "https://cdn.jsdelivr.net/npm/gcoord@{{ this._gcoord_version }}/dist/gcoord.global.prod.js";
      s.onload = () => (_gcoordLoading = false);
      s.onerror = () => (_gcoordLoading = false);
      document.head.appendChild(s);
    }
    return false;
  };

  /**
   * Detect whether the map uses Baidu coordinate system (BD-09).
   * Checks L.CRS.Baidu, crs.code, and tile URL patterns.
   *
   * @param {L.Map} map - Leaflet map instance
   * @returns {boolean} True if the map uses Baidu CRS
   *
   * @example
   *   _isBaiduCRS(map) // → true if Baidu tiles are used
   */
  const _isBaiduCRS = (map) => {
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
   * Convert map-displayed coordinates (GCJ-02 / BD-09) to WGS-84.
   * Automatically detects the map CRS (Baidu → BD09, domestic → GCJ02).
   * If gcoord library is not yet loaded, schedules async loading and
   * returns the input coordinates unchanged (with a console warning).
   *
   * @param {L.Map} map - Leaflet map instance
   * @param {number} lat - Latitude in map CRS
   * @param {number} lng - Longitude in map CRS
   * @returns {number[]} [lat, lng] in WGS-84
   *
   * @example
   *   const wgs = foliplus.toWgs84(map, 31.23, 121.47);
   *   // → [31.225, 121.464] (approx. WGS-84)
   */
  foliplus.toWgs84 = (map, lat, lng) => {
    if (typeof gcoord !== "undefined") {
      const src = _isBaiduCRS(map) ? gcoord.BD09 : gcoord.GCJ02;
      const result = gcoord.transform([lng, lat], src, gcoord.WGS84);
      return [result[1], result[0]];
    }
    if (!_ensureGcoord()) {
      // gcoord not yet loaded — schedule warning on next access
      if (!_gcoordWarned) {
        _gcoordWarned = true;
        console.warn("[foliplus] " + foliplus.gt("gcoord.warn"));
        foliplus.showHint("MapSearch", foliplus.gt("gcoord.warn"), HINT.LONG);
      }
    }
    return [lat, lng];
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
    if (typeof gcoord === "undefined") {
      if (!_ensureGcoord()) {
        // gcoord not yet loaded — show warning and return unchanged
        if (!_gcoordWarned) {
          _gcoordWarned = true;
          console.warn("[foliplus] " + foliplus.gt("gcoord.warn"));
          foliplus.showHint("MapSearch", foliplus.gt("gcoord.warn"), HINT.LONG);
        }
        return [lng, lat];
      }
    }
    const isBaidu = _isBaiduCRS(map);
    // Baidu → BD09; non-Baidu domestic maps → GCJ02; worldwide maps → skip
    const dst = isBaidu ? gcoord.BD09 : gcoord.GCJ02;
    // Skip transformation for non-domestic maps (no Baidu/AMap tile patterns)
    if (!isBaidu && !_isDomesticMap(map)) return [lng, lat];
    return gcoord.transform([lng, lat], gcoord.WGS84, dst);
  };

  /**
   * Detect whether a map uses domestic Chinese tile providers.
   * Checks Baidu, AutoNavi, Tianditu, Tencent, Google, and AMap URL patterns.
   *
   * @param {L.Map} map - Leaflet map instance
   * @returns {boolean} True if the map uses domestic tile providers
   */
  const _isDomesticMap = (map) => {
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
   * @param {number} lat Latitude
   * @param {number} lng Longitude
   * @returns {Promise<string>} Resolved address string
   */
  foliplus.reverseGeocode = (map, lat, lng) => {
    const key = `${lat},${lng}`;
    if (geoCache[key]) return Promise.resolve(geoCache[key]);

    const wgs = foliplus.toWgs84(map, parseFloat(lat), parseFloat(lng));
    const lang = (window._LOCALE && window._LOCALE["locale.code"]) || "en";
    const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${wgs[0]}&lon=${wgs[1]}&zoom=${GEO.NOMINATIM_ZOOM}&accept-language=${lang}`;

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
   *   foliplus.dom.el("div", { class: "my-class" }, "Hello")
   *
   *   // Nested children
   *   foliplus.dom.el("div", null,
   *     foliplus.dom.el("span", { class: "icon" }),
   *     foliplus.dom.el("label", null, "Name")
   *   )
   *
   *   // Set innerHTML by passing a { _html: "..." } child
   *   foliplus.dom.el("div", null, { _html: "<svg>...</svg>" })
   */
  foliplus.dom = {
    /**
     * Create an element with attributes and children.
     * @param {string} tag - HTML tag name.
     * @param {Object|null} attrs - Attributes map (class, id, data-*, etc.).
     * @param  {...any} children - Strings (text), {_html: str} (innerHTML),
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
        else if (child._html) el.insertAdjacentHTML("beforeend", child._html);
        else if (child.nodeType) el.appendChild(child);
      }
      return el;
    },
  };

  /**
   * Build a popup HTML string for a location marker.
   * @param {number} lat Latitude
   * @param {number} lng Longitude
   * @param {string|null} addr Address text or null (triggers loading indicator)
   * @param {string} title Locale key for popup title (e.g. 'MeasureControl.popup_title')
   * @param {string} loading Locale key for loading text (e.g. 'MeasureControl.popup_loading')
   * @param {string} locLabel Locale key for location label (e.g. 'MeasureControl.popup_loc_label')
   * @param {string} addrLabel Locale key for address label (e.g. 'MeasureControl.popup_addr_label')
   * @returns {string} HTML string
   */
  foliplus.buildPopupHtml = (lat, lng, addr, title, loading, locLabel, addrLabel) => {
    const loadStr = foliplus.gt(loading);
    const addrHtml =
      addr && addr.includes("LOADING")
        ? { _html: foliplus.SVGs.LOADING + " " + loadStr }
        : addr || loadStr;

    return foliplus.dom.el(
      "div",
      { class: "popup-content" },
      foliplus.dom.el("b", null, foliplus.gt(title)),
      { _html: "<br>" },
      foliplus.gt(locLabel) + lng + "," + lat,
      { _html: "<br>" },
      foliplus.gt(addrLabel),
      typeof addrHtml === "object" ? addrHtml : addrHtml,
    ).outerHTML;
  };

  /**
   * Create a location marker with a popup and add it to the map.
   * @param {L.Map} map Leaflet map instance
   * @param {number} lat Latitude
   * @param {number} lng Longitude
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
    lat,
    lng,
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
      foliplus.buildPopupHtml(lat, lng, addr, title, loading, locLabel, addrLabel),
      { maxWidth: POPUP.MAX_WIDTH },
    );
    mk.openPopup();
    if (!addr) {
      foliplus.reverseGeocode(map, lat, lng).then((resolved) => {
        if (mk && mk.getPopup() && mk.getPopup().isOpen()) {
          mk.setPopupContent(
            foliplus.buildPopupHtml(
              lat,
              lng,
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
        container.classList.remove("collapsed");
        container.classList.add("expanded");
      });
    }
    const hdr = container.querySelector(header);
    if (hdr) {
      L.DomEvent.on(hdr, "click", (e) => {
        L.DomEvent.stop(e);
        container.classList.remove("expanded");
        container.classList.add("collapsed");
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
      if (!container.contains(e.target) && container.classList.contains("expanded")) {
        container.classList.remove("expanded");
        container.classList.add("collapsed");
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
    const container = foliplus.dom.el("div", { class: "leaflet-bar leaflet-control" });
    const ctrl = foliplus.dom.el("div", {
      class: `${opts.cssClass} ctrl-fold collapsed`,
    });
    ctrl.appendChild(
      foliplus.dom.el(
        "button",
        { class: "toggle-btn", title: opts.toggleTitle },
        { _html: opts.toggleSvg },
      ),
    );
    ctrl.appendChild(foliplus.dom.el("div", { class: "tool-bar" }));
    container.appendChild(ctrl);
    if (!opts.isLeft) ctrl.classList.add("align-right");
    L.DomEvent.disableClickPropagation(container);
    L.DomEvent.disableScrollPropagation(container);
    return {
      container: container,
      ctrl: ctrl,
      toolBar: ctrl.querySelector(".tool-bar"),
      toggleBtn: ctrl.querySelector(".toggle-btn"),
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
      locale || (typeof _LOCALE !== "undefined" && _LOCALE["locale.code"]) || "en";
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

  // ==================== Dynamic Script Loader ====================
  /**
   * Load external JS dependencies dynamically, with retry support.
   * Each dependency is an object `{ url, check, name }` where `check` is
   * a function returning `true` when the script is loaded.
   * Retries up to `maxRetries` times with `delayMs` between attempts.
   *
   * @param {Array<{url: string, check: function, name: string, localeKey?: string}>} deps
   *        Dependencies to load. Each object requires:
   *          - `url`:   CDN URL of the script
   *          - `check`: function that returns `true` when loaded
   *          - `name`:  human-readable name for error messages
   *          - `localeKey` (optional): locale key for failure toast
   * @param {function(boolean, string[])} callback
   *        Called with `(success, failedNames)` when all retries are exhausted.
   *        `success=true` if all loaded, otherwise `failedNames` lists failures.
   * @param {number} [maxRetries=0] - Max retry attempts per failed script
   * @param {number} [delayMs=3000] - Delay between retries in milliseconds
   * @param {string} [hintKey] - Optional component key to show failure toast.
   *        When provided, failure toast uses each dep's `localeKey` (or falls
   *        back to `{hintKey}.no_{name}`).
   *
   * @example
   *   foliplus.loadScripts(deps, (ok) => { if (ok) run(); }, 2, 3000, 'HeatmapControl');
   */
  foliplus.loadScripts = (deps, callback, maxRetries, delayMs, hintKey) => {
    maxRetries = maxRetries || 0;
    delayMs = delayMs || 3000;
    let retries = 0;

    const showFailureHint = (failedNames) => {
      if (!hintKey) return;
      const failedStr = failedNames.join(", ");
      let msgKey = null;
      for (const name of failedNames) {
        const dep = deps.find((d) => d.name === name);
        if (dep && dep.localeKey) {
          msgKey = dep.localeKey;
          break;
        }
      }
      msgKey = msgKey || `${hintKey}.no_${failedNames[0] || "dep"}`;
      console.error(`[${hintKey}] ${foliplus.gt(msgKey)} (${failedStr})`);
      foliplus.showHint(hintKey, foliplus.gt(msgKey), HINT.PERSIST);
    };

    const attempt = () => {
      const pending = deps.filter((d) => !d.check());
      if (pending.length === 0) return callback(true);

      let loaded = 0,
        failedCount = 0;
      pending.forEach((dep) => {
        const s = document.createElement("script");
        s.src = dep.url;
        s.onload = () => {
          setTimeout(() => {
            if (dep.check()) loaded++;
            else failedCount++;
            if (loaded + failedCount === pending.length) {
              if (failedCount === 0) callback(true);
              else if (retries < maxRetries) {
                retries++;
                setTimeout(attempt, delayMs);
              } else {
                const failedNames = pending
                  .filter((d) => !d.check())
                  .map((d) => d.name);
                callback(false, failedNames);
                showFailureHint(failedNames);
              }
            }
          }, 100);
        };
        s.onerror = () => {
          failedCount++;
          console.error(`[foliplus] ${dep.name}: ${foliplus.gt("load.script_fail")}`);
          if (loaded + failedCount === pending.length) {
            if (retries < maxRetries) {
              retries++;
              setTimeout(attempt, delayMs);
            } else {
              const failedNames = pending.filter((d) => !d.check()).map((d) => d.name);
              callback(false, failedNames);
              showFailureHint(failedNames);
            }
          }
        };
        document.head.appendChild(s);
      });
    };

    attempt();
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
    return debounced;
  };
})(window, document);
