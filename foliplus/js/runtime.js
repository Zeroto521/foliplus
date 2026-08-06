/**
 * Shared utility namespace for all foliplus map controls.
 * Provides SVG icons, hint system, coordinate transformation, geocoding,
 * and common UI helpers.
 */
(function (window, document) {
  "use strict";
  // Ensure the global namespace object exists.
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
    ((k) => {
      const loc = window._LOCALE;
      return loc && loc[k] ? loc[k] : k;
    });

  // Bail out if the shared runtime has already been initialized (it is inlined
  // once per map, but this guard keeps it idempotent across reloads/embeds).
  if (foliplus.isInitialized) return;
  foliplus.isInitialized = true;

  // ==================== Constants ====================
  // Private state (closure-scoped, not exposed on foliplus)
  //
  // Z-index: hints start at 10000 and stack upward via
  //   element.style.zIndex = CONST.HINT.Z_BASE + stackIndex
  // Map content (panes) sits at 0-600, controls at 800-9990,
  // export overlay at 9500-9700, fullscreen at 99999.
  const CONST = {
    HINT: {
      BOTTOM_BASE: 20,
      STACK_GAP: 40,
      Z_BASE: 10000,
      DEFAULT_DURATION: 3000,
      SHORT: 1200,
      MEDIUM: 2500,
      LONG: 4000,
      PERSIST: 0,
    },
    PIN: {
      SIZE: [24, 36],
      ANCHOR: [12, 36],
      POPUP_ANCHOR: [0, -36],
      Z_OFFSET: 10000,
    },
    POPUP: {
      MAX_WIDTH: 300,
    },
    CLASSES: {
      COLLAPSED: "collapsed",
      EXPANDED: "expanded",
      FOLD: "foliplus-ctrl-fold",
      TOGGLE_BTN: "foliplus-toggle-btn",
      LEAFLET_BAR: "leaflet-bar leaflet-control",
      HINT: "foliplus-hint",
    },
    BOOL_PROPS: new Set([
      "checked",
      "selected",
      "disabled",
      "readOnly",
      "indeterminate",
      "defaultChecked",
    ]),
    PROPS: new Set(["value", "defaultValue"]),
    EVENTS: new Set([
      "onclick",
      "ondblclick",
      "onchange",
      "oninput",
      "onmouseover",
      "onmouseout",
      "onkeydown",
      "onkeyup",
      "onkeypress",
      "onsubmit",
      "onfocus",
      "onblur",
      "onload",
      "onerror",
      "onwheel",
      "onpointerdown",
      "onpointermove",
      "onpointerup",
      "ontouchstart",
      "ontouchmove",
      "ontouchend",
      "onmousedown",
      "onmousemove",
      "onmouseup",
    ]),
  };

  const hintIcons = {};
  const hintMap = new Map(); // key -> { element, timer }

  // Reposition all visible hints in a vertical stack (bottom-up).
  const repositionHints = () => {
    let idx = 0;
    for (const v of hintMap.values()) {
      v.element.style.bottom = `${CONST.HINT.BOTTOM_BASE + idx * CONST.HINT.STACK_GAP}px`;
      v.element.style.zIndex = CONST.HINT.Z_BASE + idx;
      idx++;
    }
  };

  // Expose hint duration tiers for other components
  foliplus.HINT_DURATION = {
    SHORT: CONST.HINT.SHORT,
    MEDIUM: CONST.HINT.MEDIUM,
    LONG: CONST.HINT.LONG,
    PERSIST: CONST.HINT.PERSIST,
  };

  foliplus.NOMINATIM = {
    URL: "https://nominatim.openstreetmap.org",
    FORMAT: "jsonv2",
    THROTTLE_MS: 1000,
    ZOOM: 18,
  };

  // --- SVG Icons ---
  foliplus.SVGs = {
    LOADING: `<svg class="foliplus-spin" viewBox="0 0 24 24"><path d="M21 12a9 9 0 1 1-6.2-8.6"/></svg>`,
    CLOSE: `
      <svg viewBox="0 0 24 24">
        <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
      </svg>`,
    PIN_ICON: `
      <div class="foliplus-pin">
        <svg width="24" height="36" viewBox="0 0 24 36">
          <path d="M12 0C5.4 0 0 5.4 0 12c0 9 12 24 12 24s12-15 12-24 C24 5.4 18.6 0 12 0z"
              fill="currentColor" stroke="#fff" stroke-width="1.5"/>
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
      ? `${CONST.CLASSES.HINT} ${CONST.CLASSES.HINT}-${key}-${Date.now()}`
      : `${CONST.CLASSES.HINT} ${CONST.CLASSES.HINT}-${key}`;
    const el = document.createElement("div");
    el.className = cls;
    hintTarget.appendChild(el);
    const icon = (hintIcons && hintIcons[key]) || "";
    el.innerHTML = icon
      ? `<span class="foliplus-hint-icon">${icon}</span>${text}`
      : text;
    el.classList.add(CONST.CLASSES.HINT);
    if (hintTarget !== document.body && hintTarget !== document.documentElement) {
      const cs = window.getComputedStyle(hintTarget);
      if (cs.position === "static") hintTarget.style.position = "relative";
    }
    const storeKey = append ? `${key}-${Date.now()}` : key;
    hintMap.set(storeKey, { element: el, timer: null });

    repositionHints();

    if (duration !== 0) {
      hintMap.get(storeKey).timer = setTimeout(
        () => foliplus.hideHint(storeKey),
        duration || CONST.HINT.DEFAULT_DURATION,
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
      if (k === key || k.startsWith(`${key}-`)) {
        const entry = hintMap.get(k);
        if (entry.timer) clearTimeout(entry.timer);
        if (entry.element) entry.element.remove();
        hintMap.delete(k);
      }
    }

    repositionHints();
  };

  // Re-parent all live hints when fullscreen state changes so they remain
  // visible regardless of whether the browser is in fullscreen or not.
  const reparentHints = () => {
    if (hintMap.size === 0) return;
    const newTarget = document.fullscreenElement || document.body;
    if (newTarget !== document.body && newTarget !== document.documentElement) {
      const cs = window.getComputedStyle(newTarget);
      if (cs.position === "static") newTarget.style.position = "relative";
    }
    let idx = 0;
    for (const v of hintMap.values()) {
      if (v.element.parentNode !== newTarget) newTarget.appendChild(v.element);
      v.element.style.bottom = `${CONST.HINT.BOTTOM_BASE + idx * CONST.HINT.STACK_GAP}px`;
      v.element.style.zIndex = CONST.HINT.Z_BASE + idx;
      idx++;
    }
  };
  document.addEventListener("fullscreenchange", reparentHints);
  document.addEventListener("webkitfullscreenchange", reparentHints);

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
      const crs = map.options.crs;
      if (L.CRS && L.CRS.Baidu && crs === L.CRS.Baidu) return true;
      if (crs && (crs.code || "").toLowerCase().includes("baidu")) return true;
      const layers = map._layers;
      for (const id in layers)
        if (layers[id]._url && layers[id]._url.includes("bdimg.com")) return true;

      return false;
    } catch (e) {
      return false;
    }
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
      for (const id in layers) {
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

  /**
   * Ensure that the gcoord library is loaded. If not, logs a warning.
   * @returns {boolean} True if gcoord is available, false otherwise.
   */
  const ensureGcoord = () => {
    // gcoord_warn hint was removed in favor of console.warn because
    // the warning only triggers when the user places a geopoint on a
    // non-WGS84 map, which is an edge case that doesn't warrant a
    // persistent UI hint.  The console warning is sufficient for
    // developers to diagnose the missing dependency.  See #114.
    if (typeof gcoord === "undefined") {
      console.warn(`[foliplus] ${foliplus.gt("foliplus.gcoord_warn")}`);
      return false;
    }
    return true;
  };

  /**
   * Detect the map's coordinate reference system type: 'BD09', 'GCJ02', or 'WGS84'.
   * @param {L.Map} map - Leaflet map instance
   * @returns {string} 'BD09' | 'GCJ02' | 'WGS84' (WGS84 indicates foreign maps that do not require conversion)
   */
  const getMapCrsType = (map) => {
    if (isBaiduCRS(map)) return "BD09";
    if (isDomesticMap(map)) return "GCJ02";
    return "WGS84";
  };

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

  // ==================== Reverse Geocoding ====================
  /**
   * Build a Nominatim API URL with shared parameters.
   * @param {string} endpoint - Path like "/search", "/reverse", or "" for search
   * @param {Object} params - Additional query parameters
   * @returns {string} Full URL
   *
   * @example
   *   foliplus.nominatimUrl("/reverse", { lat: 31.23, lon: 121.47, zoom: 18 });
   *   foliplus.nominatimUrl("", { q: "Beijing", limit: 5, lat: 30, lon: 120 });
   */
  foliplus.nominatimUrl = (endpoint, params = {}) => {
    const url = new URL(endpoint || "", foliplus.NOMINATIM.URL);
    url.searchParams.set("format", foliplus.NOMINATIM.FORMAT);
    for (const [k, v] of Object.entries(params))
      if (v != null) url.searchParams.set(k, String(v));

    if (!url.searchParams.has("accept-language"))
      url.searchParams.set(
        "accept-language",
        (window._LOCALE && window._LOCALE["locale.code"]) || "en",
      );

    return url.toString();
  };
  // Uses throttled queue (1 req/s) and response cache.
  // geoCache is a Map with a FIFO cap to bound memory during long sessions.
  const GEO_CACHE_MAX = 1000;
  const geoCache = new Map();
  const geoCacheGet = (key) => geoCache.get(key);
  const geoCacheSet = (key, val) => {
    geoCache.set(key, val);
    if (geoCache.size > GEO_CACHE_MAX) geoCache.delete(geoCache.keys().next().value);
  };
  let geoPromise = Promise.resolve();
  let geoLastReq = 0;

  /**
   * Format a Nominatim display_name into a concise address string.
   * Used by both reverseGeocode and SearchControl search results to ensure
   * consistent address formatting across the codebase.
   *
   * Removes trailing numeric tokens (postal codes, house numbers).
   * For domestic (Chinese) maps, reverses the order (Nominatim returns
   * western order "small→large", Chinese convention is "large→small").
   * For foreign maps, keeps the original Nominatim order.
   *
   * @param {string} displayName - Nominatim display_name string
   * @param {L.Map} [map] - Leaflet map instance; if provided, detects
   *                        domestic vs foreign CRS to determine ordering
   * @returns {string} Formatted address
   */
  foliplus.formatAddress = (displayName, map) => {
    if (!displayName) return "";
    const parts = displayName
      .split(",")
      .map((s) => s.trim())
      .filter((s) => {
        if (!s) return false;
        // Remove pure numeric tokens (postal codes, house numbers)
        if (/^\d+$/.test(s)) return false;
        // Remove ZIP+4 and similar (12345-6789, 12345 6789)
        if (/^\d{3,}([-–—]\d{2,}|\s+\d{2,})?$/.test(s)) return false;
        // Remove short numeric+letter combos that look like postal codes (e.g. "EC1A 1BB", "10001")
        if (
          /^[A-Z0-9]{2,10}(\s+[A-Z0-9]{2,10})?$/i.test(s) &&
          s.length <= 10 &&
          /[A-Z]/.test(s) === /[0-9]/.test(s)
        )
          return false;
        return true;
      });
    if (parts.length === 0) return "";
    // Domestic (Chinese) maps OR locale=zh: reverse order (small→large → large→small)
    // Foreign maps: keep original order
    const isChinese =
      (map && getMapCrsType(map) !== "WGS84") ||
      (window._LOCALE && window._LOCALE["locale.code"] === "zh");
    if (isChinese) return parts.reverse().join(",");
    return parts.join(",");
  };

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
    const cached = geoCacheGet(key);
    if (cached) return Promise.resolve(cached);

    const wgs = foliplus.toWgs84(map, parseFloat(lng), parseFloat(lat));
    const url = foliplus.nominatimUrl("/reverse", {
      lon: wgs[0],
      lat: wgs[1],
      zoom: foliplus.NOMINATIM.ZOOM,
    });

    geoPromise = geoPromise
      .then(() => {
        const wait = Math.max(
          0,
          foliplus.NOMINATIM.THROTTLE_MS - (Date.now() - geoLastReq),
        );
        return new Promise((r) => setTimeout(r, wait));
      })
      .then(() => {
        geoLastReq = Date.now();
        return fetch(url)
          .then((r) => r.json())
          .then((data) => {
            const addr =
              foliplus.formatAddress(data.display_name, map) ||
              foliplus.gt("SearchControl.addr_not_found");
            geoCacheSet(key, addr);
            return addr;
          })
          .catch(() => foliplus.gt("MeasureControl.geo_fail"));
      });
    return geoPromise;
  };

  // ==================== DOM Helpers ====================
  foliplus.dom = {
    /**
     * Create an element with attributes, properties, events, and children.
     *
     * Supported attrs keys:
     * - `class` → sets `className` (string, supports `" "` separated tokens)
     * - `style` → if object, merges via `Object.assign(el.style, val)`;
     *             if string, sets `el.style.cssText = val`
     * - `value`, `defaultValue` → set as DOM property
     * - `checked`, `selected`, `disabled`, `readOnly` → set as boolean DOM property (`""` → `true`)
     * - `onclick`, `onchange`, `oninput`, etc. → assigned as event handler
     * - `parent` → auto-append to parent element (HTMLElement)
     * - `innerHTML` → set via `el.innerHTML = val`
     * - any other key → set via `el.setAttribute(key, String(val))`
     *
     * Children can be:
     * - `string` / `number` → appended as TextNode
     * - `{ html: "..." }` → inserted via `insertAdjacentHTML("beforeend", ...)`
     * - `HTMLElement` → appended via `appendChild`
     *
     * @param {string} tag - HTML tag name.
     * @param {Object|null} [attrs={}] - Attributes/properties/events map.
     * @param {...any} children - Text, {html}, or DOM elements to append.
     * @returns {HTMLElement}
     *
     * @example
     *   // Create a button with events, value, and auto-append to parent
     *   foliplus.dom.el("button", {
     *     class: "foliplus-btn",
     *     parent: container,
     *     onclick: () => alert("clicked"),
     *   }, "Click me")
     *
     *   // Create an input with value and change handler
     *   foliplus.dom.el("input", {
     *     class: "my-input",
     *     type: "number",
     *     value: 42,
     *     onchange: () => doSomething(),
     *   })
     */
    el(tag, attrs = {}, ...children) {
      const el = document.createElement(tag);
      if (attrs) {
        for (const [key, val] of Object.entries(attrs)) {
          if (val == null) continue;
          if (key === "class") el.className = val;
          else if (key === "style") {
            if (typeof val === "object") Object.assign(el.style, val);
            else el.style.cssText = val;
          } else if (key === "parent") val.appendChild(el);
          else if (key === "innerHTML") el.innerHTML = val;
          else if (CONST.BOOL_PROPS.has(key)) el[key] = val === "" || val === true;
          else if (CONST.PROPS.has(key)) el[key] = val;
          else if (CONST.EVENTS.has(key)) el[key] = val;
          else el.setAttribute(key, String(val));
        }
      }
      for (const child of children) {
        if (child == null) continue;
        if (child.html) el.insertAdjacentHTML("beforeend", child.html);
        else el.append(child);
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
        ? { html: `${foliplus.SVGs.LOADING} ${loadStr}` }
        : addr || loadStr;

    return foliplus.dom.el(
      "div",
      { class: "foliplus-popup-content" },
      foliplus.dom.el("b", null, foliplus.gt(title)),
      { html: "<br>" },
      `${foliplus.gt(locLabel)}${lng},${lat}`,
      { html: "<br>" },
      foliplus.gt(addrLabel),
      addrHtml,
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
   * @param {Function} [onAddress] Called with the resolved address when the
   *   reverse geocode completes (only when `addr` is null). Lets callers
   *   persist the address without making a second geocode request.
   * @param {boolean} [openPopup=true] Whether to auto-open the popup after
   *   creation. Pass `false` when restoring markers so they don't pop open on
   *   page load.
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
    onAddress,
    openPopup = true,
  ) => {
    if (existing) map.removeLayer(existing);
    const target = layerGroup || map;
    const marker = L.marker([lat, lng], {
      icon: L.divIcon({
        className: "",
        html: foliplus.SVGs.PIN_ICON,
        iconSize: CONST.PIN.SIZE,
        iconAnchor: CONST.PIN.ANCHOR,
        popupAnchor: CONST.PIN.POPUP_ANCHOR,
      }),
      zIndexOffset: CONST.PIN.Z_OFFSET,
    });
    target.addLayer(marker);
    marker.bindPopup(
      foliplus.buildPopupHtml(lng, lat, addr, title, loading, locLabel, addrLabel),
      { maxWidth: CONST.POPUP.MAX_WIDTH },
    );
    if (openPopup) marker.openPopup();
    // Add title to Leaflet's popup close button for hover tooltip.
    // Use window._LOCALE directly since _() may not be available in runtime.js context.
    const closeLabel = foliplus.gt("LayerControl.close_label");
    const popupEl = marker.getPopup();
    if (popupEl) {
      const closeBtn = popupEl._closeButton;
      if (closeBtn) closeBtn.title = closeLabel;
    }
    if (!addr) {
      foliplus.reverseGeocode(map, lng, lat).then((resolved) => {
        if (onAddress) onAddress(resolved);
        if (marker && marker.getPopup() && marker.getPopup().isOpen()) {
          marker.setPopupContent(
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
    return marker;
  };

  /**
   * Adjust the z-index of a panel to ensure proper stacking order.
   * When expanded, sets a high z-index; when collapsed, resets to auto.
   * @param {object} opts
   * @param {HTMLElement} opts.container - Panel element
   * @param {boolean} opts.expanded - Whether the panel is being expanded
   */
  foliplus.adjustPanelZIndex = ({ container, expanded }) => {
    const bar = container.closest(".leaflet-bar");
    const section = container.closest(".leaflet-top, .leaflet-bottom");
    if (!expanded) {
      if (bar) bar.style.zIndex = "";
      if (section) section.style.zIndex = "";
      return;
    }
    // Read --z-index-floating from :root (defined in CSS), then offset bar and section.
    // Avoids hardcoding magic numbers that would drift from the CSS variable.
    const base = parseInt(
      foliplus.cssVar(document.documentElement, "--z-index-floating"),
      10,
    );
    if (bar) bar.style.zIndex = String(base + 1);
    if (section) section.style.zIndex = String(base + 9);
  };

  /**
   * Read a CSS custom property value from a container element.
   * Falls back to the provided default if the property is not set or empty.
   * @param {HTMLElement} el - Element to query computed styles from
   * @param {string} prop - CSS custom property name, e.g. "--heatmap-label-color"
   * @param {string} [fallback] - Fallback value if property is not defined
   * @returns {string} Trimmed property value or fallback
   *
   * @example
   *   foliplus.cssVar(container, "--heatmap-label-color", "#333");
   */
  foliplus.cssVar = (el, prop, fallback = "") => {
    return getComputedStyle(el).getPropertyValue(prop).trim() || fallback;
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
        container.classList.remove(CONST.CLASSES.COLLAPSED);
        container.classList.add(CONST.CLASSES.EXPANDED);
        foliplus.adjustPanelZIndex({ container, expanded: true });
      });
    }
    const hdr = container.querySelector(header);
    if (hdr) {
      L.DomEvent.on(hdr, "click", (e) => {
        L.DomEvent.stop(e);
        container.classList.remove(CONST.CLASSES.EXPANDED);
        container.classList.add(CONST.CLASSES.COLLAPSED);
        foliplus.adjustPanelZIndex({ container, expanded: false });
      });
    }
  };

  /**
   * Collapse a panel when clicking outside of it.
   * Sets up a MutationObserver to auto-cleanup when the container is removed.
   * @param {object} opts
   * @param {HTMLElement} opts.container - Panel element to watch
   * @param {Function} [opts.skipCheck] - Optional function; if returns true, collapse is skipped
   * @returns {Function} Cleanup function to remove the click listener
   */
  foliplus.bindOutsideCollapse = ({ container, skipCheck }) => {
    const handler = (e) => {
      if (skipCheck && skipCheck()) return;
      if (
        !container.contains(e.target) &&
        container.classList.contains(CONST.CLASSES.EXPANDED)
      ) {
        container.classList.remove(CONST.CLASSES.EXPANDED);
        container.classList.add(CONST.CLASSES.COLLAPSED);
        foliplus.adjustPanelZIndex({ container, expanded: false });
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
    const container = foliplus.dom.el("div", { class: CONST.CLASSES.LEAFLET_BAR });
    const ctrl = foliplus.dom.el("div", {
      class: `${opts.cssClass} ${CONST.CLASSES.FOLD} ${CONST.CLASSES.COLLAPSED}`,
    });
    ctrl.appendChild(
      foliplus.dom.el(
        "button",
        { class: CONST.CLASSES.TOGGLE_BTN, title: opts.toggleTitle },
        { html: opts.toggleSvg },
      ),
    );
    ctrl.appendChild(foliplus.dom.el("div", { class: "foliplus-tool-bar" }));
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
   * Bind map events to keep a visual element in sync.
   * Caller specifies which events trigger hide, update, and show.
   * @param {object} opts
   * @param {L.Map} opts.map - Leaflet map instance
   * @param {string[]} [opts.hideEvents] - Event names that trigger hide (e.g. ["movestart", "zoomstart"])
   * @param {string[]} [opts.updateEvents] - Event names that trigger update (e.g. ["moveend", "zoomend"])
   * @param {string[]} [opts.showEvents] - Event names that trigger show (e.g. ["moveend", "zoomend"])
   * @param {Function} [opts.onHide] - Called on hide events
   * @param {Function} [opts.onUpdate] - Called on update events
   * @param {Function} [opts.onShow] - Called on show events
   * @returns {Function} Cleanup function to remove all listeners
   */
  foliplus.bindMapEvents = (opts) => {
    const register = (events, fn) => {
      if (!events || !fn) return;
      events.forEach((ev) => opts.map.on(ev, fn));
    };
    const unregister = (events, fn) => {
      if (!events || !fn) return;
      events.forEach((ev) => opts.map.off(ev, fn));
    };
    register(opts.hideEvents, opts.onHide);
    register(opts.updateEvents, opts.onUpdate);
    register(opts.showEvents, opts.onShow);
    return () => {
      unregister(opts.hideEvents, opts.onHide);
      unregister(opts.updateEvents, opts.onUpdate);
      unregister(opts.showEvents, opts.onShow);
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
    const container = foliplus.dom.el("div", {
      class: CONST.CLASSES.LEAFLET_BAR,
    });
    const ctrl = foliplus.dom.el("div", {
      class: `foliplus-panel ${CONST.CLASSES.FOLD} ${opts.cssClass} ${CONST.CLASSES.COLLAPSED}`,
    });
    ctrl.appendChild(
      foliplus.dom.el(
        "button",
        { class: CONST.CLASSES.TOGGLE_BTN, title: opts.toggleTitle },
        { html: opts.toggleSvg },
      ),
    );
    const panelWrap = foliplus.dom.el("div", { class: "foliplus-panel-wrap" });
    const header = foliplus.dom.el("div", { class: "foliplus-panel-header" });
    header.appendChild(
      foliplus.dom.el(
        "span",
        { class: "foliplus-header-title" },
        foliplus.dom.el(
          "span",
          { class: "foliplus-header-icon" },
          { html: opts.toggleSvg },
        ),
        opts.panelTitle,
      ),
    );
    header.appendChild(
      foliplus.dom.el(
        "button",
        { class: "foliplus-ctrl-btn foliplus-close-btn", title: opts.closeTitle },
        { html: foliplus.SVGs.CLOSE },
      ),
    );
    panelWrap.appendChild(header);
    const panelContent = foliplus.dom.el("div", {
      class: "foliplus-panel-content",
    });
    panelWrap.appendChild(panelContent);
    ctrl.appendChild(panelWrap);
    container.appendChild(ctrl);

    L.DomEvent.disableClickPropagation(container);
    L.DomEvent.disableScrollPropagation(container);

    foliplus.bindPanelToggle({
      container: ctrl,
      toggleBtn: ".foliplus-toggle-btn",
      header: ".foliplus-panel-header",
    });
    foliplus.bindOutsideCollapse({ container: ctrl });

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
      locale ||
      (typeof window._LOCALE !== "undefined" && window._LOCALE["locale.code"]) ||
      "en";
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
   * Called automatically from each control's Jinja2 template, using the locale
   * tables that BaseControl injects once per map into `window.foliplus._TABLES`:
   *   `foliplus.resolveLocale(<locale_code>, window.foliplus._TABLES);`
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

  /**
   * Shared localStorage helper for all foliplus controls.
   *
   * Wraps JSON read/write in try/catch so a quota, privacy, or serialization
   * failure never breaks map initialization. Failures are logged with the
   * caller's component name as a prefix and a shared i18n key, so no control
   * needs its own localStorage boilerplate (LayerControl layer order / fold
   * state, MeasureControl measurements, etc.).
   *
   * @example
   *   foliplus.storage.save("foliplus_order", ["a", "b"], "LayerControl");
   *   const data = foliplus.storage.load("foliplus_order", "LayerControl");
   */
  foliplus.storage = {
    /**
     * Read and parse a value from localStorage.
     * @param {string} key    - localStorage key.
     * @param {string} [name] - Caller component name, used as the log prefix.
     * @returns {*} Parsed value, or null when missing/unreadable.
     */
    load(key, name) {
      try {
        const data = localStorage.getItem(key);
        return data ? JSON.parse(data) : null;
      } catch (e) {
        console.warn(
          `[${name || "foliplus"}] ${foliplus.gt("foliplus.storage_load_fail").replace("{key}", key)}`,
          e,
        );
        return null;
      }
    },

    /**
     * Serialize and write a value to localStorage.
     * @param {string} key    - localStorage key.
     * @param {*} data        - Value to persist (must be JSON-serializable).
     * @param {string} [name] - Caller component name, used as the log prefix.
     */
    save(key, data, name) {
      try {
        localStorage.setItem(key, JSON.stringify(data));
      } catch (e) {
        console.warn(
          `[${name || "foliplus"}] ${foliplus.gt("foliplus.storage_save_fail").replace("{key}", key)}`,
          e,
        );
      }
    },
  };
})(window, document);
