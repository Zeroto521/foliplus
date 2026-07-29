(function () {
  // ==================== Constants ====================
  const CONST = {
    name: "SearchControl",
    position: "{{ this.position }}",
    MODE: {
      COORD: "coord",
      ADDR: "addr",
    },
    SEARCH: {
      LIMIT: 5,
    },
    ZOOM: {
      LEVEL: {{ this.zoom }},
      MAX: 16,
      MIN: 12,
      BASE: 18,
      DIVISOR: 20,
    },
    AUTOCOMPLETE: {
      DEBOUNCE_MS: 300,
      MIN_CHARS: 3,
      MAX_ITEMS: 5,
    },
    PARAM: {
      Q: "q",
      LAT: "lat",
      LNG: "lng",
    },
    CLASSES: {
      EXPANDED: "expanded",
      COLLAPSED: "collapsed",
      MAP_SEARCH: "foliplus-search",
      SEARCH_MODE_BTN: "foliplus-search-mode-btn",
      CLEAR: "clear",
      CTRL_BTN: "foliplus-ctrl-btn",
      SUGGESTIONS: "foliplus-search-suggestions",
      SUGGESTION_ITEM: "foliplus-search-suggestion-item",
      SUGGESTION_ICON: "foliplus-search-suggestion-icon",
      SUGGESTION_TEXT: "foliplus-search-suggestion-text",
      ACTIVE: "active",
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
  const _ = (k) => (foliplus.gt ? foliplus.gt(k) : k);

  // ==================== SVG Icons ====================
  const SVGs = {
    SEARCH: `
      <svg viewBox="0 0 24 24">
        <circle cx="10.5" cy="10.5" r="6.5"/>
        <line x1="15.5" y1="15.5" x2="21" y2="21"/>
      </svg>`,
  };

  foliplus.registerHintIcon(CONST.name, SVGs.SEARCH);

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
        cssClass: CONST.CLASSES.MAP_SEARCH,
        toggleTitle: _(`${CONST.name}.btn_title`),
        toggleSvg: SVGs.SEARCH,
        isLeft: CONST.position.indexOf("left") >= 0,
      });
      ctrl.id = "{{ this.get_name() }}_ctrl";
      this.container = container;
      this.ctrl = ctrl;
      this.toggleBtn = toggleBtn;
      this.toolBar = toolBar;

      const modeBtn = foliplus.dom.el(
        "button",
        {
          class: CONST.CLASSES.SEARCH_MODE_BTN,
          title: _(`${CONST.name}.mode_coord`),
          parent: toolBar,
        },
        { html: foliplus.SVGs.LOCATE },
      );
      const inp = foliplus.dom.el("input", {
        type: "text",
        placeholder: _(`${CONST.name}.coord_placeholder`),
      });
      const clearBtn = foliplus.dom.el(
        "button",
        {
          class: CONST.CLASSES.CTRL_BTN,
          title: _(`${CONST.name}.clear_title`),
        },
        { html: foliplus.SVGs.CLOSE },
      );
      this.modeBtn = modeBtn;
      this.inp = inp;
      this.clearBtn = clearBtn;

      foliplus.dom.el(
        "div",
        { class: CONST.CLASSES.CLEAR, parent: toolBar },
        inp,
        clearBtn,
      );
    }

    // ── State Initialization ──
    initState() {
      this.mk = null;
      this.mode = "{{ this.mode }}";
      if (this.mode !== CONST.MODE.COORD && this.mode !== CONST.MODE.ADDR)
        this.mode = CONST.MODE.COORD;
      this.suggestionsWrap = null;
      this.selectedSuggestionIdx = -1;
      this.lastSuggestFetch = 0;
      this.suggestionsThrottleTimer = null;
      this.cachedSuggestions = {};
      this.cachedAddress = {};

      this.setMode(this.mode);
      this.modeBtn.onclick = (e) => {
        e.stopPropagation();
        this.setMode(
          this.mode === CONST.MODE.COORD ? CONST.MODE.ADDR : CONST.MODE.COORD,
        );
      };
    }

    // ── Mode Switching ──
    setMode(newMode) {
      this.mode = newMode;
      if (this.mode === CONST.MODE.COORD) {
        this.modeBtn.innerHTML = foliplus.SVGs.LOCATE;
        this.modeBtn.title = _(`${CONST.name}.mode_coord`);
        this.inp.placeholder = _(`${CONST.name}.coord_placeholder`);
      } else {
        this.modeBtn.innerHTML = foliplus.SVGs.GLOBE;
        this.modeBtn.title = _(`${CONST.name}.mode_addr`);
        this.inp.placeholder = _(`${CONST.name}.addr_placeholder`);
      }
      this.inp.value = "";
      if (this.mk) {
        map.removeLayer(this.mk);
        this.mk = null;
      }
      foliplus.hideHint(CONST.name);
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
          CONST.name,
          _(`${CONST.name}.coord_error`),
          foliplus.HINT_DURATION.LONG,
        );
        this.inp.value = "";
        return;
      }

      const lng = parts[0];
      const lat = parts[1];
      foliplus.hideHint(CONST.name);
      map.flyTo([lat, lng], CONST.ZOOM.LEVEL || 16);
      this.mk = foliplus.createLocationMarker(
        map,
        lng,
        lat,
        null,
        `${CONST.name}.popup_title_coord`,
        `${CONST.name}.popup_loading`,
        `${CONST.name}.popup_loc_label`,
        `${CONST.name}.popup_addr_label`,
        this.mk,
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
        CONST.name,
        `${foliplus.SVGs.LOADING} ${_(`${CONST.name}.popup_loading`)}`,
        foliplus.HINT_DURATION.PERSIST,
      );

      // Abort previous request to avoid race conditions
      if (this.addrAbortController) this.addrAbortController.abort();
      this.addrAbortController = new AbortController();
      const signal = this.addrAbortController.signal;

      fetch(this.buildSearchUrl(query, CONST.SEARCH.LIMIT), { signal })
        .then((r) => r.json())
        .then((results) => {
          foliplus.hideHint(CONST.name);
          if (!results || results.length === 0) {
            foliplus.showHint(
              CONST.name,
              _(`${CONST.name}.addr_not_found`),
              foliplus.HINT_DURATION.LONG,
            );
            this.inp.value = "";
            return;
          }

          const item = results[0];
          const displayName = foliplus.formatAddress(item.display_name, map) || query;
          this.cachedAddress[query] = { item, displayName };
          this.renderAddressResult({ item, displayName });
        })
        .catch((err) => {
          if (err.name === "AbortError") return;
          console.error(`[${CONST.name}] ${_(`${CONST.name}.addr_error`)}`);
          foliplus.hideHint(CONST.name);
          foliplus.showHint(
            CONST.name,
            _(`${CONST.name}.addr_error`),
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
        CONST.ZOOM.MAX,
        Math.max(
          CONST.ZOOM.MIN,
          CONST.ZOOM.BASE - Math.floor(displayName.length / CONST.ZOOM.DIVISOR),
        ),
      );
      map.flyTo([lat, lng], zoom);
      this.mk = foliplus.createLocationMarker(
        map,
        lng,
        lat,
        displayName,
        `${CONST.name}.popup_title_addr`,
        `${CONST.name}.popup_loading`,
        `${CONST.name}.popup_loc_label`,
        `${CONST.name}.popup_addr_label`,
        this.mk,
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
      // If suggestions would overflow right edge, align to right edge instead
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
          class: CONST.CLASSES.SUGGESTIONS,
        });
        document.body.appendChild(this.suggestionsWrap);
        this.suggestionsWrap.addEventListener("click", (e) => e.stopPropagation());
      }

      this.suggestionsWrap.innerHTML = "";
      this.selectedSuggestionIdx = -1;
      this.positionSuggestions();

      results.forEach((item, idx) => {
        const displayName =
          foliplus.formatAddress(item.display_name, map) || item.name || "";
        const suggestion = foliplus.dom.el(
          "div",
          { class: CONST.CLASSES.SUGGESTION_ITEM, "data-index": String(idx) },
          foliplus.dom.el(
            "span",
            { class: CONST.CLASSES.SUGGESTION_ICON },
            { html: foliplus.SVGs.LOCATE },
          ),
          foliplus.dom.el(
            "span",
            { class: CONST.CLASSES.SUGGESTION_TEXT },
            displayName,
          ),
        );
        suggestion.onmousedown = (e) => {
          e.stopPropagation();
          e.preventDefault();
          this.removeSuggestions();
          this.cachedAddress[displayName] = { item, displayName };
          this.renderAddressResult({ item, displayName });
        };
        this.suggestionsWrap.appendChild(suggestion);
      });
    }

    fetchSuggestions(query) {
      if (this.mode !== CONST.MODE.ADDR) {
        this.removeSuggestions();
        return;
      }
      if (query.length < CONST.AUTOCOMPLETE.MIN_CHARS) {
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

      fetch(this.buildSearchUrl(query, CONST.AUTOCOMPLETE.MAX_ITEMS))
        .then((r) => r.json())
        .then((results) => this.renderSuggestions(results, query))
        .catch(() => this.removeSuggestions());
    }

    initDebouncedFetch() {
      this.debouncedFetch = foliplus.debounce(
        () => this.fetchSuggestions(this.inp.value.trim()),
        CONST.AUTOCOMPLETE.DEBOUNCE_MS,
      );
    }

    /** Build a shared Nominatim /search URL with centered bias. */
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
      // Toggle expand/collapse (also removes suggestions when collapsing)
      this.toggleBtn.onclick = (e) => {
        e.stopPropagation();
        if (this.ctrl.classList.contains(CONST.CLASSES.EXPANDED)) {
          this.ctrl.classList.remove(CONST.CLASSES.EXPANDED);
          this.ctrl.classList.add(CONST.CLASSES.COLLAPSED);
          foliplus.hideHint(CONST.name);
          this.removeSuggestions();
        } else {
          this.ctrl.classList.remove(CONST.CLASSES.COLLAPSED);
          this.ctrl.classList.add(CONST.CLASSES.EXPANDED);
          this.inp.focus();
        }
      };

      // Clear input
      this.clearBtn.onclick = () => {
        this.inp.value = "";
        if (this.mk) {
          map.removeLayer(this.mk);
          this.mk = null;
        }
        this.inp.focus();
      };

      // Input → update placeholder + debounced autocomplete
      this.inp.addEventListener("input", () => {
        this.inp.placeholder =
          this.mode === CONST.MODE.COORD
            ? _(`${CONST.name}.coord_placeholder`)
            : _(`${CONST.name}.addr_placeholder`);

        if (this.mode === CONST.MODE.ADDR) this.debouncedFetch();
        else {
          this.debouncedFetch.cancel();
          this.removeSuggestions();
        }
      });

      // Keyboard navigation
      this.inp.addEventListener("keydown", (e) => {
        if (e.key === "Escape") {
          if (this.suggestionsWrap) {
            this.removeSuggestions();
            return;
          }
          this.ctrl.classList.remove(CONST.CLASSES.EXPANDED);
          this.ctrl.classList.add(CONST.CLASSES.COLLAPSED);
          foliplus.hideHint(CONST.name);
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
            el.classList.toggle(CONST.CLASSES.ACTIVE, i === this.selectedSuggestionIdx),
          );
          if (items[this.selectedSuggestionIdx])
            this.inp.value = items[this.selectedSuggestionIdx].textContent;
          return;
        }
        if (e.key === "ArrowUp" && this.suggestionsWrap) {
          e.preventDefault();
          const items = this.suggestionsWrap.querySelectorAll(":scope > *");
          this.selectedSuggestionIdx = Math.max(this.selectedSuggestionIdx - 1, -1);
          items.forEach((el, i) =>
            el.classList.toggle(CONST.CLASSES.ACTIVE, i === this.selectedSuggestionIdx),
          );
          if (this.selectedSuggestionIdx >= 0 && items[this.selectedSuggestionIdx])
            this.inp.value = items[this.selectedSuggestionIdx].textContent;
          return;
        }
        if (e.key === "Enter") {
          const raw = this.inp.value.trim();
          this.removeSuggestions();
          if (!raw) return;
          this.mode === CONST.MODE.COORD
            ? this.searchCoord(raw)
            : this.searchAddress(raw);
        }
      });

      // Blur → remove suggestions after click events settle
      // Uses setTimeout(0) so the click event on a suggestion can fire first
      this.inp.addEventListener("blur", () =>
        setTimeout(() => this.removeSuggestions(), 0),
      );

      // Focus → re-show suggestions if input has cached content
      this.inp.addEventListener("focus", () => {
        if (this.mode === CONST.MODE.ADDR) {
          const val = this.inp.value.trim();
          if (val.length >= CONST.AUTOCOMPLETE.MIN_CHARS) {
            this.fetchSuggestions(val);
          }
        }
      });

      // Reposition suggestions on scroll/resize
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
        const q = params.get(CONST.PARAM.Q);
        const latParam = params.get(CONST.PARAM.LAT);
        const lngParam = params.get(CONST.PARAM.LNG);

        if (q) {
          const parts = q
            .replace(/\uff0c/g, ",")
            .replace(/\s+/g, "")
            .split(",")
            .map(Number);
          if (parts.length >= 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
            this.setMode(CONST.MODE.COORD);
            this.searchCoord(q);
          } else {
            this.setMode(CONST.MODE.ADDR);
            this.inp.value = q;
            this.searchAddress(q);
          }
        } else if (latParam && lngParam) {
          const lng = parseFloat(lngParam);
          const lat = parseFloat(latParam);
          if (!isNaN(lng) && !isNaN(lat)) {
            this.setMode(CONST.MODE.COORD);
            this.searchCoord(`${lng},${lat}`);
          }
        }
      } catch (e) {
        // Silently ignore URL parsing errors
      }
    }
  }

  new SearchControl({ position: CONST.position }).addTo(map);
})();
