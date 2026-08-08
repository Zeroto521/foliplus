import { requireRuntime } from "../shared/guard.js";
import { createTranslator, resolveLocaleCode } from "../shared/locale.js";
import * as SVGs from "./SearchControl.icon.js";

// ==================== Runtime Guard ====================
const CONF = window.foliplus.CONFIG.SearchControl;
requireRuntime(CONF.name);

// ==================== Dependencies ====================
const foliplus = window.foliplus;
const _ = createTranslator(CONF);
foliplus.registerHintIcon(CONF.name, SVGs.SEARCH);

// ==================== Constants ====================
const MODE = { COORD: "coord", ADDR: "addr" };
const SEARCH = { LIMIT: 5 };
const ZOOM = { MAX: 16, MIN: 12, BASE: 18, DIVISOR: 20 };
const AUTOCOMPLETE = { DEBOUNCE_MS: 300, MIN_CHARS: 3, MAX_ITEMS: 5 };
const PARAM = { Q: "q", LAT: "lat", LNG: "lng" };
const CLASSES = {
  EXPANDED: "expanded",
  COLLAPSED: "collapsed",
  MAP_SEARCH: "foliplus-search",
  SEARCH_MODE_BTN: "foliplus-search-mode-btn",
  CLEAR: "clear",
  SUGGESTIONS: "foliplus-search-suggestions",
  SUGGESTION_ITEM: "foliplus-search-suggestion-item",
  SUGGESTION_ICON: "foliplus-search-suggestion-icon",
  SUGGESTION_TEXT: "foliplus-search-suggestion-text",
  ACTIVE: "active",
};

// ==================== Control Definition ====================
class SearchControl extends L.Control {
  onAdd() {
    this.createDOM();
    this.initState();
    this.initDebouncedFetch();
    this.bindEvents();
    this.initFromUrl();
    foliplus.bindOutsideCollapse({ container: this.ctrl });
    return this.container;
  }

  onRemove() {
    this.removeSuggestions();
    if (this.debouncedFetch) this.debouncedFetch.cancel();
    if (this.addrAbortController) this.addrAbortController.abort();
    if (this.suggestAbortController) this.suggestAbortController.abort();
    this.cachedSuggestions = {};
    this.cachedAddress = {};
    this.scrollTargets.forEach((t) =>
      t.removeEventListener("scroll", this.repositionHandler, true),
    );
    window.removeEventListener("resize", this.repositionHandler);
    this.modeBtn.onclick = null;
    this.clearBtn.onclick = null;
  }

  // ── DOM Creation ──
  createDOM() {
    const { container, ctrl, toolBar, toggleBtn } = foliplus.createFoldControl({
      cssClass: CLASSES.MAP_SEARCH,
      toggleTitle: _(`${CONF.name}.btn_title`),
      toggleSvg: SVGs.SEARCH,
      isLeft: CONF.position.indexOf("left") >= 0,
    });
    ctrl.id = `${CONF.name}_${CONF.position}_ctrl`;
    this.container = container;
    this.ctrl = ctrl;
    this.toggleBtn = toggleBtn;
    this.toolBar = toolBar;

    const modeBtn = foliplus.dom.el(
      "button",
      {
        class: CLASSES.SEARCH_MODE_BTN,
        title: _(`${CONF.name}.mode_coord`),
        parent: toolBar,
      },
      { html: foliplus.SVGs.LOCATE },
    );
    const inp = foliplus.dom.el("input", {
      type: "text",
      placeholder: _(`${CONF.name}.coord_placeholder`),
    });
    const clearBtn = foliplus.dom.el(
      "button",
      {
        class: "foliplus-ctrl-btn foliplus-close-btn",
        title: _(`${CONF.name}.clear_title`),
      },
      { html: foliplus.SVGs.CLOSE },
    );
    this.modeBtn = modeBtn;
    this.inp = inp;
    this.clearBtn = clearBtn;

    foliplus.dom.el(
      "div",
      { class: CLASSES.CLEAR, parent: toolBar },
      inp,
      clearBtn,
    );
  }

  // ── State Initialization ──
  initState() {
    this.marker = null;
    this.mode = CONF.mode;
    if (this.mode !== MODE.COORD && this.mode !== MODE.ADDR)
      this.mode = MODE.COORD;
    this.suggestionsWrap = null;
    this.selectedSuggestionIdx = -1;
    this.lastSuggestFetch = 0;
    this.suggestionsThrottleTimer = null;
    this.cachedSuggestions = {};
    this.cachedAddress = {};
    this.suggestAbortController = null;
    this.suggestSeq = 0;

    this.setMode(this.mode);
    this.modeBtn.onclick = (e) => {
      e.stopPropagation();
      this.setMode(
        this.mode === MODE.COORD ? MODE.ADDR : MODE.COORD,
      );
    };
  }

  // ── Mode Switching ──
  setMode(newMode) {
    this.mode = newMode;
    if (this.mode === MODE.COORD) {
      this.modeBtn.innerHTML = foliplus.SVGs.LOCATE;
      this.modeBtn.title = _(`${CONF.name}.mode_coord`);
      this.inp.placeholder = _(`${CONF.name}.coord_placeholder`);
    } else {
      this.modeBtn.innerHTML = foliplus.SVGs.GLOBE;
      this.modeBtn.title = _(`${CONF.name}.mode_addr`);
      this.inp.placeholder = _(`${CONF.name}.addr_placeholder`);
    }
    this.inp.value = "";
    if (this.marker) {
      map.removeLayer(this.marker);
      this.marker = null;
    }
    if (this.suggestAbortController) this.suggestAbortController.abort();
    foliplus.hideHint(CONF.name);
    this.removeSuggestions();
    this.inp.focus();
  }

  // ── Coordinate Search ──
  searchCoord(raw) {
    const parts = raw
      .replace(/\uff0c/g, ",")
      .replace(/\s+/g, "")
      .split(",")
      .map(Number);

    if (parts.length < 2 || isNaN(parts[0]) || isNaN(parts[1])) {
      foliplus.showHint(
        CONF.name,
        _(`${CONF.name}.coord_error`),
        foliplus.HINT_DURATION.LONG,
      );
      this.inp.value = "";
      return;
    }

    const lng = parts[0];
    const lat = parts[1];
    if (lng < -180 || lng > 180 || lat < -90 || lat > 90) {
      foliplus.showHint(
        CONF.name,
        _(`${CONF.name}.coord_error`),
        foliplus.HINT_DURATION.LONG,
      );
      this.inp.value = "";
      return;
    }

    foliplus.hideHint(CONF.name);
    map.flyTo([lat, lng], CONF.zoom || 16);
    this.marker = foliplus.createLocationMarker(
      map,
      lng,
      lat,
      null,
      _(`${CONF.name}.popup_title_coord`),
      _(`${CONF.name}.popup_loading`),
      _(`${CONF.name}.popup_loc_label`),
      _(`${CONF.name}.popup_addr_label`),
      _("foliplus.close_label"),
      CONF.locale_code,
      this.marker,
    );
  }

  // ── Address Search ──
  searchAddress(query) {
    // Return cached result immediately
    if (this.cachedAddress[query]) {
      this.renderAddressResult(this.cachedAddress[query]);
      return;
    }

    foliplus.showHint(
      CONF.name,
      `${foliplus.SVGs.LOADING} ${_(`${CONF.name}.popup_loading`)}`,
      foliplus.HINT_DURATION.PERSIST,
    );

    // Abort previous request to avoid race conditions
    if (this.addrAbortController) this.addrAbortController.abort();
    this.addrAbortController = new AbortController();
    const signal = this.addrAbortController.signal;

    fetch(this.buildSearchUrl(query, SEARCH.LIMIT), { signal })
      .then((r) => r.json())
      .then((results) => {
        foliplus.hideHint(CONF.name);
        if (!results || results.length === 0) {
          foliplus.showHint(
            CONF.name,
            _(`${CONF.name}.addr_not_found`),
            foliplus.HINT_DURATION.LONG,
          );
          this.inp.value = "";
          return;
        }

        const item = results[0];
        const displayName = foliplus.formatAddress(item.display_name, map, CONF.locale_code) || query;
        this.cachedAddress[query] = { item, displayName };
        this.renderAddressResult({ item, displayName });
      })
      .catch((err) => {
        if (err.name === "AbortError") return;
        console.error(`[${CONF.name}] ${_(`${CONF.name}.addr_error`)}`);
        foliplus.hideHint(CONF.name);
        foliplus.showHint(
          CONF.name,
          _(`${CONF.name}.addr_error`),
          foliplus.HINT_DURATION.LONG,
        );
      });
  }

  renderAddressResult(result) {
    const { item, displayName } = result;
    let lat = parseFloat(item.lat);
    let lng = parseFloat(item.lon);

    const converted = foliplus.fromWgs84(map, lng, lat);
    lng = converted[0];
    lat = converted[1];

    const zoom = Math.min(
      ZOOM.MAX,
      Math.max(
        ZOOM.MIN,
        ZOOM.BASE - Math.floor(displayName.length / ZOOM.DIVISOR),
      ),
    );
    map.flyTo([lat, lng], zoom);
    this.marker = foliplus.createLocationMarker(
      map,
      lng,
      lat,
      displayName,
      _(`${CONF.name}.popup_title_addr`),
      _(`${CONF.name}.popup_loading`),
      _(`${CONF.name}.popup_loc_label`),
      _(`${CONF.name}.popup_addr_label`),
      _("foliplus.close_label"),
      CONF.locale_code,
      this.marker,
    );
  }

  // ── Suggestions ──
  removeSuggestions() {
    if (this.suggestionsThrottleTimer) {
      clearTimeout(this.suggestionsThrottleTimer);
      this.suggestionsThrottleTimer = null;
    }
    if (this.suggestionsWrap) {
      this.suggestionsWrap.remove();
      this.suggestionsWrap = null;
    }
    this.selectedSuggestionIdx = -1;
  }

  positionSuggestions() {
    if (!this.suggestionsWrap) return;
    const rect = this.ctrl.getBoundingClientRect();
    let left = rect.left + window.scrollX;
    if (left + rect.width > window.innerWidth)
      left = window.innerWidth - rect.width + window.scrollX;

    this.suggestionsWrap.style.left = `${left}px`;
    this.suggestionsWrap.style.top = `${rect.bottom + window.scrollY}px`;
  }

  renderSuggestions(results, query) {
    if (!results || results.length === 0) {
      this.removeSuggestions();
      return;
    }

    this.cachedSuggestions[query] = results;

    if (!this.suggestionsWrap) {
      this.suggestionsWrap = foliplus.dom.el("div", {
        class: CLASSES.SUGGESTIONS,
        parent: document.body,
        onclick: (e) => e.stopPropagation(),
      });
    }

    this.suggestionsWrap.innerHTML = "";
    this.selectedSuggestionIdx = -1;
    this.positionSuggestions();

    results.forEach((item, idx) => {
      const displayName =
        foliplus.formatAddress(item.display_name, map) || item.name || "";
      const suggestion = foliplus.dom.el(
        "div",
        {
          class: CLASSES.SUGGESTION_ITEM,
          "data-index": String(idx),
          parent: this.suggestionsWrap,
          onmousedown: (e) => {
            e.stopPropagation();
            e.preventDefault();
            this.removeSuggestions();
            this.cachedAddress[displayName] = { item, displayName };
            this.renderAddressResult({ item, displayName });
          },
        },
        foliplus.dom.el(
          "span",
          { class: CLASSES.SUGGESTION_ICON },
          { html: foliplus.SVGs.LOCATE },
        ),
        foliplus.dom.el(
          "span",
          { class: CLASSES.SUGGESTION_TEXT },
          displayName,
        ),
      );
    });
  }

  fetchSuggestions(query) {
    if (this.mode !== MODE.ADDR) {
      this.removeSuggestions();
      return;
    }
    if (query.length < AUTOCOMPLETE.MIN_CHARS) {
      this.removeSuggestions();
      return;
    }
    if (this.cachedSuggestions[query]) {
      this.renderSuggestions(this.cachedSuggestions[query], query);
      return;
    }

    const now = Date.now();
    if (now - this.lastSuggestFetch < foliplus.NOMINATIM.THROTTLE_MS) {
      if (this.suggestionsThrottleTimer) clearTimeout(this.suggestionsThrottleTimer);
      this.suggestionsThrottleTimer = setTimeout(
        () => this.fetchSuggestions(query),
        foliplus.NOMINATIM.THROTTLE_MS - (now - this.lastSuggestFetch),
      );
      return;
    }
    this.lastSuggestFetch = Date.now();
    if (this.suggestAbortController) this.suggestAbortController.abort();
    this.suggestAbortController = new AbortController();
    this.suggestSeq += 1;
    const reqSeq = this.suggestSeq;

    fetch(this.buildSearchUrl(query, AUTOCOMPLETE.MAX_ITEMS), {
      signal: this.suggestAbortController.signal,
    })
      .then((r) => r.json())
      .then((results) => {
        if (reqSeq !== this.suggestSeq) return;
        if (query !== this.inp.value.trim()) return;
        this.renderSuggestions(results, query);
      })
      .catch((err) => {
        if (err.name === "AbortError") return;
        this.removeSuggestions();
      });
  }

  initDebouncedFetch() {
    this.debouncedFetch = foliplus.debounce(
      () => this.fetchSuggestions(this.inp.value.trim()),
      AUTOCOMPLETE.DEBOUNCE_MS,
    );
  }

  buildSearchUrl(query, limit) {
    const center = map.getCenter();
    return foliplus.nominatimUrl("/search", {
      q: query,
      limit,
      lon: center.lng,
      lat: center.lat,
    });
  }

  // ── Event Binding ──
  bindEvents() {
    this.toggleBtn.onclick = (e) => {
      e.stopPropagation();
      if (this.ctrl.classList.contains(CLASSES.EXPANDED)) {
        this.ctrl.classList.remove(CLASSES.EXPANDED);
        this.ctrl.classList.add(CLASSES.COLLAPSED);
        foliplus.adjustPanelZIndex({ container: this.ctrl, expanded: false });
        foliplus.hideHint(CONF.name);
        this.removeSuggestions();
      } else {
        this.ctrl.classList.remove(CLASSES.COLLAPSED);
        this.ctrl.classList.add(CLASSES.EXPANDED);
        foliplus.adjustPanelZIndex({ container: this.ctrl, expanded: true });
        this.inp.focus();
      }
    };

    this.clearBtn.onclick = () => {
      this.inp.value = "";
      if (this.marker) {
        map.removeLayer(this.marker);
        this.marker = null;
      }
      this.inp.focus();
    };

    this.inp.addEventListener("input", () => {
      this.inp.placeholder =
        this.mode === MODE.COORD
          ? _(`${CONF.name}.coord_placeholder`)
          : _(`${CONF.name}.addr_placeholder`);

      if (this.mode === MODE.ADDR) this.debouncedFetch();
      else {
        this.debouncedFetch.cancel();
        this.removeSuggestions();
      }
    });

    this.inp.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        if (this.suggestionsWrap) {
          this.removeSuggestions();
          return;
        }
        this.ctrl.classList.remove(CLASSES.EXPANDED);
        this.ctrl.classList.add(CLASSES.COLLAPSED);
        foliplus.adjustPanelZIndex({ container: this.ctrl, expanded: false });
        foliplus.hideHint(CONF.name);
        return;
      }
      if (e.key === "ArrowDown" && this.suggestionsWrap) {
        e.preventDefault();
        const items = this.suggestionsWrap.querySelectorAll(":scope > *");
        this.selectedSuggestionIdx = Math.min(
          this.selectedSuggestionIdx + 1,
          items.length - 1,
        );
        items.forEach((el, i) =>
          el.classList.toggle(CLASSES.ACTIVE, i === this.selectedSuggestionIdx),
        );
        if (items[this.selectedSuggestionIdx])
          this.inp.value = items[this.selectedSuggestionIdx].querySelector(
            `.${CLASSES.SUGGESTION_TEXT}`,
          ).textContent;
        return;
      }
      if (e.key === "ArrowUp" && this.suggestionsWrap) {
        e.preventDefault();
        const items = this.suggestionsWrap.querySelectorAll(":scope > *");
        this.selectedSuggestionIdx = Math.max(this.selectedSuggestionIdx - 1, -1);
        items.forEach((el, i) =>
          el.classList.toggle(CLASSES.ACTIVE, i === this.selectedSuggestionIdx),
        );
        if (this.selectedSuggestionIdx >= 0 && items[this.selectedSuggestionIdx])
          this.inp.value = items[this.selectedSuggestionIdx].querySelector(
            `.${CLASSES.SUGGESTION_TEXT}`,
          ).textContent;
        return;
      }
      if (e.key === "Enter") {
        const raw = this.inp.value.trim();
        this.removeSuggestions();
        if (!raw) return;
        this.mode === MODE.COORD
          ? this.searchCoord(raw)
          : this.searchAddress(raw);
      }
    });

    this.inp.addEventListener("blur", () =>
      setTimeout(() => this.removeSuggestions(), 0),
    );

    this.inp.addEventListener("focus", () => {
      if (this.mode === MODE.ADDR) {
        const val = this.inp.value.trim();
        if (val.length >= AUTOCOMPLETE.MIN_CHARS) {
          this.fetchSuggestions(val);
        }
      }
    });

    this.repositionHandler = () => this.positionSuggestions();
    this.scrollTargets = [
      window,
      document.querySelector(".leaflet-container"),
    ].filter(Boolean);
    this.scrollTargets.forEach((t) =>
      t.addEventListener("scroll", this.repositionHandler, true),
    );
    window.addEventListener("resize", this.repositionHandler);
  }

  // ── URL Parameter Parsing ──
  initFromUrl() {
    try {
      const params = new URLSearchParams(window.location.search);
      const q = params.get(PARAM.Q);
      const latParam = params.get(PARAM.LAT);
      const lngParam = params.get(PARAM.LNG);

      if (q) {
        const parts = q
          .replace(/\uff0c/g, ",")
          .replace(/\s+/g, "")
          .split(",")
          .map(Number);
        if (parts.length >= 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
          this.setMode(MODE.COORD);
          this.searchCoord(q);
        } else {
          this.setMode(MODE.ADDR);
          this.inp.value = q;
          this.searchAddress(q);
        }
      } else if (latParam && lngParam) {
        const lng = parseFloat(lngParam);
        const lat = parseFloat(latParam);
        if (!isNaN(lng) && !isNaN(lat)) {
          this.setMode(MODE.COORD);
          this.searchCoord(`${lng},${lat}`);
        }
      }
    } catch (e) {
      // Silently ignore URL parsing errors
    }
  }
}

new SearchControl({ position: CONF.position }).addTo(map);
