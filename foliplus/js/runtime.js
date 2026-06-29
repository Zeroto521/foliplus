/**
 * Shared utility namespace for all foliplus map controls.
 * Provides SVG icons, hint system, coordinate transformation, geocoding,
 * and common UI helpers.
 */
(function () {
  if (window.foliplus) return;

  const foliplus = {
    // --- SVG Icons ---
    SVGs: {
      LOADING: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" stroke-width="2.5" stroke-linecap="round"
    style="animation:spin 0.8s linear infinite;vertical-align:middle">
    <path d="M21 12a9 9 0 1 1-6.2-8.6"/></svg>`,
      CLOSE: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" stroke-width="2.2" stroke-linecap="round"
    stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/>
    <line x1="6" y1="6" x2="18" y2="18"/></svg>`,
      PIN_ICON: `<div style="position:relative;width:24px;height:36px;">
    <svg width="24" height="36" viewBox="0 0 24 36">
      <path d="M12 0C5.4 0 0 5.4 0 12c0 9 12 24 12 24s12-15 12-24
        C24 5.4 18.6 0 12 0z" fill="var(--accent-primary)" stroke="#fff"
        stroke-width="1.5"/>
      <circle cx="12" cy="12" r="4.5" fill="#fff"/>
    </svg></div>`,
      LOCATE: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" stroke-width="1.8" stroke-linecap="round"
    stroke-linejoin="round">
    <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75
    7-13c0-3.87-3.13-7-7-7z"/>
    <circle cx="12" cy="9" r="2.5"/></svg>`,
      GLOBE: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" stroke-width="1.8"
    stroke-linecap="round" stroke-linejoin="round">
    <circle cx="12" cy="12" r="10"/>
    <ellipse cx="12" cy="12" rx="4" ry="10"/>
    <line x1="2" y1="12" x2="22" y2="12"/></svg>`,
      SEARCH: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" stroke-width="1.8" stroke-linecap="round"
    stroke-linejoin="round"><circle cx="10.5" cy="10.5" r="6.5"/>
    <line x1="15.5" y1="15.5" x2="21" y2="21"/></svg>`
    }
  };

  // ==================== Hint / Toast System ====================
  const _hintMap = new Map(); // key -> { element, timer }

  foliplus.registerHintIcon = function (key, iconSvg) {
    foliplus._hintIcons = foliplus._hintIcons || {};
    foliplus._hintIcons[key] = iconSvg;
  };
  foliplus._hintIcons = foliplus._hintIcons || {};
  foliplus._hintIcons['gcoord-warn'] = foliplus.SVGs.SEARCH;

  foliplus.showHint = function (key, text, duration, parent) {
    foliplus.hideHint(key);
    // Mount inside the map container by default to avoid z-index issues
    const hintTarget = parent ||
      document.querySelector('.leaflet-container') ||
      document.body;
    const el = L.DomUtil.create('div', `map-hint map-hint-${key}`, hintTarget);
    const icon = (foliplus._hintIcons && foliplus._hintIcons[key]) || '';
    el.innerHTML = icon ? `<span style="margin-right:6px">${icon}</span>${text}` : text;
    // Style via CSS class — common.css defines .map-hint
    el.classList.add('map-hint');
    // Ensure the map container has relative positioning
    if (hintTarget !== document.body && hintTarget !== document.documentElement) {
      const cs = getComputedStyle(hintTarget);
      if (cs.position === 'static') hintTarget.style.position = 'relative';
    }
    _hintMap.set(key, { element: el, timer: null });

    const _reposition = () => {
      let idx = 0;
      for (let v of _hintMap.values()) {
        v.element.style.bottom = `${20 + idx * 40}px`;
        v.element.style.zIndex = 10000 + idx;
        idx++;
      }
    };
    _reposition();

    if (duration !== 0) {
      _hintMap.get(key).timer = setTimeout(() => foliplus.hideHint(key), duration || 3000);
    }
  };

  foliplus.hideHint = function (key) {
    const entry = _hintMap.get(key);
    if (!entry) return;
    if (entry.timer) clearTimeout(entry.timer);
    if (entry.element) entry.element.remove();
    _hintMap.delete(key);

    let idx = 0;
    for (let v of _hintMap.values()) {
      v.element.style.bottom = `${20 + idx * 40}px`;
      idx++;
    }
  };

  foliplus.hideAllHints = () => {
    for (let key of _hintMap.keys()) foliplus.hideHint(key);
  };

  // ==================== Coordinate Transformation ====================
  /**
   * Ensure gcoord library is loaded. Returns true if already available.
   */
  foliplus._ensureGcoord = function () {
    if (typeof gcoord !== 'undefined') return true;
    if (!foliplus._gcoordLoading) {
      foliplus._gcoordLoading = true;
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/gcoord@{{ this._gcoord_version }}/dist/gcoord.global.prod.js';
      s.onload = () => { foliplus._gcoordLoading = false; };
      s.onerror = () => { foliplus._gcoordLoading = false; };
      document.head.appendChild(s);
    }
    return false;
  };

  foliplus._isBaiduCRS = function (map) {
    try {
      if (L.CRS && L.CRS.Baidu) return true;
      const crs = map.options.crs;
      if (crs && (crs.code || '').toLowerCase().includes('baidu')) return true;
      const layers = map._layers;
      for (let id in layers) {
        if (layers[id]._url && layers[id]._url.includes('bdimg.com')) return true;
      }
      return false;
    } catch (e) {
      return false;
    }
  };

  /** Convert map coordinates (GCJ-02 / BD-09) to WGS-84. */
  foliplus.toWgs84 = function (map, lat, lng) {
    if (typeof gcoord !== 'undefined') {
      const src = foliplus._isBaiduCRS(map) ? gcoord.BD09 : gcoord.GCJ02;
      const result = gcoord.transform([lng, lat], src, gcoord.WGS84);
      return [result[1], result[0]];
    }
    if (!foliplus._ensureGcoord()) {
      // gcoord not yet loaded — schedule warning on next access
      if (!foliplus._gcoordWarned) {
        foliplus._gcoordWarned = true;
        const _g = typeof _LOCALE !== 'undefined' ? (k) => _LOCALE[k] || k : (k) => k;
        console.warn('[foliplus] ' + _g('gcoord.warn'));
        foliplus.showHint('gcoord-warn', _g('gcoord.warn'), 5000);
      }
    }
    return [lat, lng];
  };

  /** Convert WGS84 coordinates to the map's CRS (BD09 / GCJ02 / unchanged). */
  foliplus.fromWgs84 = function (map, lng, lat) {
    if (typeof gcoord === 'undefined') {
      if (!foliplus._ensureGcoord()) {
        // gcoord not yet loaded — show warning and return unchanged
        if (!foliplus._gcoordWarned) {
          foliplus._gcoordWarned = true;
          const _g2 = typeof _LOCALE !== 'undefined' ? (k) => _LOCALE[k] || k : (k) => k;
          console.warn('[foliplus] ' + _g2('gcoord.warn'));
          foliplus.showHint('gcoord-warn', _g2('gcoord.warn'), 5000);
        }
        return [lng, lat];
      }
    }
    const isBaidu = foliplus._isBaiduCRS(map);
    // Baidu → BD09; non-Baidu domestic maps → GCJ02; worldwide maps → skip
    const dst = isBaidu ? gcoord.BD09 : gcoord.GCJ02;
    // Skip transformation for non-domestic maps (no Baidu/AMap tile patterns)
    if (!isBaidu && !_isDomesticMap(map)) return [lng, lat];
    const result = gcoord.transform([lng, lat], gcoord.WGS84, dst);
    return result;
  };

  function _isDomesticMap(map) {
    try {
      const crs = map.options.crs;
      if (crs && (crs.code || '').toLowerCase().includes('baidu')) return true;
      const layers = map._layers;
      for (let id in layers) {
        if (layers[id]._url) {
          const url = layers[id]._url;
          if (
            url.includes('bdimg.com') ||
            url.includes('autonavi') ||
            url.includes('tianditu') ||
            url.includes('gtimg.com') ||
            url.includes('googleapis') ||
            url.includes('amap.com')
          ) return true;
        }
      }
      return false;
    } catch (e) {
      return false;
    }
  }

  // ==================== Reverse Geocoding ====================
  // Uses throttled queue (1 req/s) and response cache.
  const _geoCache = {};
  let _geoPromise = Promise.resolve();
  let _geoLastReq = 0;

  /**
   * Reverse geocode coordinates to an address via Nominatim.
   * Results are cached. Requests are throttled to 1 req/s.
   * @param {L.Map} map Leaflet map instance
   * @param {number} lat Latitude
   * @param {number} lng Longitude
   * @returns {Promise<string>} Resolved address string
   */
  foliplus.reverseGeocode = function (map, lat, lng) {
    const key = `${lat},${lng}`;
    if (_geoCache[key]) return Promise.resolve(_geoCache[key]);

    const wgs = foliplus.toWgs84(map, parseFloat(lat), parseFloat(lng));
    const lang = (typeof _LOCALE !== 'undefined' && _LOCALE['locale.code']) || 'en';
    const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${wgs[0]}&lon=${wgs[1]}&zoom=18&accept-language=${lang}`;

    _geoPromise = _geoPromise.then(() => {
      const wait = Math.max(0, 1000 - (Date.now() - _geoLastReq));
      return new Promise(r => setTimeout(r, wait));
    }).then(() => {
      _geoLastReq = Date.now();
      return fetch(url).then(r => r.json()).then(data => {
        let addr = data.display_name || '';
        addr = addr.split(',').map(s => s.trim())
          .filter(s => s && !/^\d+$/.test(s))
          .reverse().join(',');
        const _g3 = typeof _LOCALE !== 'undefined' ? (k) => _LOCALE[k] || k : (k) => k;
        _geoCache[key] = addr || _g3('search.addr_not_found');
        return _geoCache[key];
      }).catch(() => {
        const _g4 = typeof _LOCALE !== 'undefined' ? (k) => _LOCALE[k] || k : (k) => k;
        return _g4('measure.geo_fail');
      });
    });
    return _geoPromise;
  };

  /**
   * Build a popup HTML string for a location marker.
   * @param {number} lat Latitude
   * @param {number} lng Longitude
   * @param {string|null} addr Address text or null (triggers loading indicator)
   * @param {object} txt Text constants object with POPUP_* keys
   * @param {string} [title] Popup title, defaults to txt.POPUP_TITLE
   * @returns {string} HTML string
   */
  foliplus.buildPopupHtml = function (lat, lng, addr, txt, title) {
    const popupTitle = title || txt.POPUP_TITLE;
    const addrHtml = (addr && addr.includes('LOADING')) ?
      `${foliplus.SVGs.LOADING} ${txt.POPUP_LOADING}` :
      (addr || txt.POPUP_LOADING);
    return `<div style="font-size:13px;line-height:1.8">
      <b>${popupTitle}</b><br>
      ${txt.POPUP_LOC_LABEL}${lng},${lat}<br>
      ${txt.POPUP_ADDR_LABEL}${addrHtml}
    </div>`;
  };

  // ==================== Panel Interaction Helpers ====================
  /**
   * Create a location marker with a popup and add it to the map.
   * @param {L.Map} map Leaflet map instance
   * @param {number} lat Latitude
   * @param {number} lng Longitude
   * @param {string} addr Address string (null = pending reverse geocode)
   * @param {object} txt Text constants (must include POPUP_* keys)
   * @param {string} [title] Popup title (defaults to txt.POPUP_TITLE)
   * @param {L.Marker} [existing] Existing marker to remove before creating new one
   * @returns {L.Marker} The newly created marker
   */
  foliplus.createLocationMarker = function (
    map, lat, lng, addr, txt, title, existing, layerGroup
  ) {
    if (existing) map.removeLayer(existing);
    var target = layerGroup || map;
    var mk = L.marker([lat, lng], {
      icon: L.divIcon({
        className: '',
        html: foliplus.SVGs.PIN_ICON,
        iconSize: [24, 36],
        iconAnchor: [12, 36],
        popupAnchor: [0, -36]
      })
    });
    target.addLayer(mk);
    mk.bindPopup(
      foliplus.buildPopupHtml(lat, lng, addr, txt, title), {
      maxWidth: 300
    }
    );
    mk.openPopup();
    if (!addr) {
      foliplus.reverseGeocode(map, lat, lng).then(function (resolved) {
        if (mk && mk.getPopup() && mk.getPopup().isOpen()) {
          mk.setPopupContent(foliplus.buildPopupHtml(lat, lng, resolved, txt, title));
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
  foliplus.bindPanelToggle = function ({ container, toggleBtn, header }) {
    const btn = container.querySelector(toggleBtn);
    if (btn) {
      L.DomEvent.on(btn, 'click', (e) => {
        L.DomEvent.stop(e);
        container.classList.remove('collapsed');
        container.classList.add('expanded');
      });
    }
    const hdr = container.querySelector(header);
    if (hdr) {
      L.DomEvent.on(hdr, 'click', (e) => {
        L.DomEvent.stop(e);
        container.classList.remove('expanded');
        container.classList.add('collapsed');
      });
    }
  };

  /**
   * Collapse a panel when clicking outside of it.
   * Sets up a MutationObserver to auto-cleanup when the container is removed.
   * @param {object} opts
   * @param {L.Map} opts.map - Leaflet map instance
   * @param {HTMLElement} opts.container - Panel element to watch
   * @returns {Function} Cleanup function to remove the click listener
   */
  foliplus.bindOutsideCollapse = function ({ map, container }) {
    const handler = (e) => {
      if (!container.contains(e.target) && container.classList.contains('expanded')) {
        container.classList.remove('expanded');
        container.classList.add('collapsed');
      }
    };
    document.addEventListener('click', handler);

    // Auto-cleanup: remove listener when container is removed from DOM
    const cleanup = () => document.removeEventListener('click', handler);
    const obs = new MutationObserver(() => {
      if (!document.body.contains(container)) {
        cleanup();
        obs.disconnect();
      }
    });
    obs.observe(document.body, { childList: true, subtree: true });

    return cleanup;
  };

  // ==================== Number Formatting ====================
  // Locale-aware number formatting using Intl.NumberFormat compact notation.
  // 'auto'  → compact abbreviations above threshold (en:≥1K, zh:≥1万),
  //            standard grouping below (1,234).  Fallback: K/M/B or 万/亿.
  // 'comma' → thousands separator + 1 decimal (alias: 'int')
  /**
   * Format a number for display.
   * @param {number} val Value to format
   * @param {string} [style='auto'] 'auto' (compact: 1.2K/1.2万/1.2M),
   *                                'comma' or 'int' (thousands separator: 1,234.6)
   * @param {string} [locale] Locale code, defaults to browser language (en/zh)
   * @returns {string} Formatted string
   */
  foliplus.formatNumber = function (val, style, locale) {
    style = style || 'auto';
    locale = locale || (typeof _LOCALE !== 'undefined' && _LOCALE['locale.code']) || 'en';
    if (typeof Intl !== 'undefined' && Intl.NumberFormat) {
      if (style === 'auto') {
        // Use compact abbreviations above locale-specific threshold,
        // standard grouping below (so zh locale gets "1,234" instead of "1234")
        const compactThreshold = locale === 'zh' ? 10000 : 1000;
        if (val >= compactThreshold) {
          return new Intl.NumberFormat(locale, {
            notation: 'compact',
            compactDisplay: 'short',
            maximumFractionDigits: 1,
          }).format(val);
        }
      }
      // auto below threshold, comma, int → thousands separator, 1 decimal
      return new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(val);
    }
    // Fallback: no Intl support — use locale-aware abbreviations
    if (style === 'auto') {
      if (locale === 'zh') {
        if (val >= 1e8) return (val / 1e8).toFixed(1) + '亿';
        if (val >= 10000) return (val / 10000).toFixed(1) + '万';
      } else {
        if (val >= 1e9) return (val / 1e9).toFixed(1) + 'B';
        if (val >= 1e6) return (val / 1e6).toFixed(1) + 'M';
        if (val >= 1000) return (val / 1000).toFixed(1) + 'K';
      }
    }
    return Math.round(val).toLocaleString();
  };

  // ==================== Dynamic Script Loader ====================
  /**
   * Load external JS dependencies dynamically.
   * Retries up to `maxRetries` times with `delayMs` between attempts.
   * Calls `callback(success)` when done.
   */
  foliplus.loadScripts = function (deps, callback, maxRetries, delayMs) {
    maxRetries = maxRetries || 0;
    delayMs = delayMs || 3000;
    let retries = 0;

    function attempt() {
      const pending = deps.filter(d => !d.check());
      if (pending.length === 0) return callback(true);

      let loaded = 0, failedCount = 0;
      pending.forEach((dep) => {
        const s = document.createElement('script');
        s.src = dep.url;
        s.onload = () => {
          setTimeout(() => {
            if (dep.check()) loaded++;
            else failedCount++;
            if (loaded + failedCount === pending.length) {
              if (failedCount === 0) callback(true);
              else if (retries < maxRetries) { retries++; setTimeout(attempt, delayMs); }
              else callback(false, pending.filter(d => !d.check()).map(d => d.name));
            }
          }, 100);
        };
        s.onerror = () => {
          failedCount++;
          const _gl = typeof _LOCALE !== 'undefined' ? (k) => _LOCALE[k] || k : (k) => k;
          console.error(`[foliplus] ${dep.name}: ${_gl('load.script_fail')}`);
          if (loaded + failedCount === pending.length) {
            if (retries < maxRetries) { retries++; setTimeout(attempt, delayMs); }
            else callback(false, pending.filter(d => !d.check()).map(d => d.name));
          }
        };
        document.head.appendChild(s);
      });
    }

    attempt();
  };

  // ------------------------------------------------------------------
  // Locale resolution — called from each control's template
  // ------------------------------------------------------------------
  // Sets window._LOCALE to the correct language table.
  //
  // If `code` is non-empty and exists in `tables`, it is used directly.
  // Otherwise the user's browser language (navigator.language) is detected
  // and used as the key, falling back to the "en" table.
  //
  // Called from the Jinja2 template in base.py for every control instance:
  //   foliplus.resolveLocale('{{ this._LOCALE_CODE }}', {...tables...});
  //
  // @param {string} code - Explicit locale code ("en", "zh", or "" for auto)
  // @param {Object} tables - Dictionary of locale tables ({en: {...}, zh: {...}})
  // ------------------------------------------------------------------
  foliplus.resolveLocale = function (code, tables) {
    if (!tables) return;
    if (code && tables[code]) {
      window._LOCALE = tables[code];
    } else {
      var lang = (typeof navigator !== 'undefined'
        ? (navigator.language || navigator.userLanguage || '')
        : '').split('-')[0].split('_')[0].toLowerCase();
      window._LOCALE = tables[lang] || tables['en'];
    }
  };

  window.foliplus = foliplus;
})();
