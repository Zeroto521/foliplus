(function () {
  // ==================== Constants ====================
  const CONST = {
    name: "MapSearch",
    position: "{{ this.position }}",
    lang: (window._LOCALE && window._LOCALE["locale.code"]) || "en",
    MODE: {
      COORD: "coord",
      ADDR: "addr",
    },
    NOMINATIM: {
      URL: `${window.foliplus.NOMINATIM.URL}/search`,
      FORMAT: window.foliplus.NOMINATIM.FORMAT,
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
      MAP_SEARCH: "foliplus-map-search",
      SEARCH_MODE_BTN: "foliplus-search-mode-btn",
      CLEAR_WRAP: "foliplus-clear-wrap",
      CTRL_BTN: "foliplus-ctrl-btn",
      SUGGESTIONS: "foliplus-search-suggestions",
      SUGGESTION_ITEM: "foliplus-search-suggestion-item",
      SUGGESTION_ICON: "foliplus-search-suggestion-icon",
      SUGGESTION_TEXT: "foliplus-search-suggestion-text",
      ACTIVE: "active",
    },
  };

  // ==================== Runtime Guard ====================
  if (!window.foliplus || !window.foliplus.SVGs) {
    console.error(`[${CONST.name}] foliplus runtime not found, plugin disabled.`);
    return;
  }

  // ==================== Dependencies ====================
  const map = {{ this._parent.get_name() }};
  const _ = (k) => (window.foliplus && window.foliplus.gt ? window.foliplus.gt(k) : k);

  // ==================== SVG Icons ====================
  const SVGs = {
    SEARCH: `
      <svg viewBox="0 0 24 24">
        <circle cx="10.5" cy="10.5" r="6.5"/>
        <line x1="15.5" y1="15.5" x2="21" y2="21"/>
      </svg>`,
  };

  window.foliplus.registerHintIcon(CONST.name, SVGs.SEARCH);

  // ==================== Control Definition ====================
  class MapSearchControl extends L.Control {
    onAdd() {
      const { container, ctrl, toolBar, toggleBtn } = window.foliplus.createFoldControl(
        {
          cssClass: CONST.CLASSES.MAP_SEARCH,
          toggleTitle: _(`${CONST.name}.btn_title`),
          toggleSvg: SVGs.SEARCH,
          isLeft: CONST.position.indexOf("left") >= 0,
        },
      );
      ctrl.id = "{{ this.get_name() }}_ctrl";

      const modeBtn = window.foliplus.dom.el(
        "button",
        { class: CONST.CLASSES.SEARCH_MODE_BTN, title: _(`${CONST.name}.mode_coord`) },
        { html: window.foliplus.SVGs.LOCATE },
      );
      const inp = window.foliplus.dom.el("input", {
        type: "text",
        placeholder: _(`${CONST.name}.coord_placeholder`),
      });
      const clearBtn = window.foliplus.dom.el(
        "button",
        { class: CONST.CLASSES.CTRL_BTN, title: _(`${CONST.name}.clear_title`) },
        { html: window.foliplus.SVGs.CLOSE },
      );
      toolBar.appendChild(modeBtn);
      toolBar.appendChild(
        window.foliplus.dom.el(
          "div",
          { class: CONST.CLASSES.CLEAR_WRAP },
          inp,
          clearBtn,
        ),
      );

      let mk = null;
      let mode = "{{ this.mode }}";
      if (mode !== CONST.MODE.COORD && mode !== CONST.MODE.ADDR)
        mode = CONST.MODE.COORD;

      // ── Autocomplete state (must be before setMode) ──
      let suggestionsWrap = null;
      let selectedSuggestionIdx = -1;
      let lastSuggestFetch = 0;
      let suggestionsThrottleTimer = null;
      const suggestionCache = {};

      const removeSuggestions = () => {
        if (suggestionsThrottleTimer) {
          clearTimeout(suggestionsThrottleTimer);
          suggestionsThrottleTimer = null;
        }
        if (suggestionsWrap) {
          suggestionsWrap.remove();
          suggestionsWrap = null;
        }
        selectedSuggestionIdx = -1;
      };

      // Mode switching
      const setMode = (newMode) => {
        mode = newMode;
        if (mode === CONST.MODE.COORD) {
          modeBtn.innerHTML = window.foliplus.SVGs.LOCATE;
          modeBtn.title = _(`${CONST.name}.mode_coord`);
          inp.placeholder = _(`${CONST.name}.coord_placeholder`);
        } else {
          modeBtn.innerHTML = window.foliplus.SVGs.GLOBE;
          modeBtn.title = _(`${CONST.name}.mode_addr`);
          inp.placeholder = _(`${CONST.name}.addr_placeholder`);
        }
        inp.value = "";
        if (mk) {
          map.removeLayer(mk);
          mk = null;
        }
        window.foliplus.hideHint(CONST.name);
        removeSuggestions(); // Cleanup suggestions on mode switch
        inp.focus();
      };

      modeBtn.onclick = (e) => {
        e.stopPropagation();
        setMode(mode === CONST.MODE.COORD ? CONST.MODE.ADDR : CONST.MODE.COORD);
      };
      setMode(mode);

      // Expand / collapse
      toggleBtn.onclick = (e) => {
        e.stopPropagation();
        if (ctrl.classList.contains(CONST.CLASSES.EXPANDED)) {
          ctrl.classList.remove(CONST.CLASSES.EXPANDED);
          ctrl.classList.add(CONST.CLASSES.COLLAPSED);
          window.foliplus.hideHint(CONST.name);
        } else {
          ctrl.classList.remove(CONST.CLASSES.COLLAPSED);
          ctrl.classList.add(CONST.CLASSES.EXPANDED);
          inp.focus();
        }
      };

      // Clear input
      clearBtn.onclick = () => {
        inp.value = "";
        if (mk) {
          map.removeLayer(mk);
          mk = null;
        }
        inp.focus();
      };

      inp.addEventListener("input", () => {
        inp.placeholder =
          mode === CONST.MODE.COORD
            ? _(`${CONST.name}.coord_placeholder`)
            : _(`${CONST.name}.addr_placeholder`);
      });

      // Coordinate search
      const doCoordSearch = (raw) => {
        const parts = raw
          .replace(/\uff0c/g, ",")
          .replace(/\s+/g, "")
          .split(",")
          .map(Number);

        if (parts.length < 2 || isNaN(parts[0]) || isNaN(parts[1])) {
          window.foliplus.showHint(
            CONST.name,
            _(`${CONST.name}.coord_error`),
            window.foliplus.HINT_DURATION.LONG,
          );
          inp.value = "";
          return;
        }

        const lng = parts[0];
        const lat = parts[1];
        window.foliplus.hideHint(CONST.name);
        map.flyTo([lat, lng], CONST.ZOOM.LEVEL || 16);
        mk = window.foliplus.createLocationMarker(
          map,
          lng,
          lat,
          null,
          `${CONST.name}.popup_title_coord`,
          `${CONST.name}.popup_loading`,
          `${CONST.name}.popup_loc_label`,
          `${CONST.name}.popup_addr_label`,
          mk,
        );
      };

      // Address search via Nominatim
      const doAddrSearch = (query) => {
        window.foliplus.showHint(
          CONST.name,
          `${window.foliplus.SVGs.LOADING} ${_(`${CONST.name}.popup_loading`)}`,
          window.foliplus.HINT_DURATION.PERSIST,
        );

        fetch(
          `${CONST.NOMINATIM.URL}?format=${CONST.NOMINATIM.FORMAT}&q=${encodeURIComponent(query)}&limit=${CONST.NOMINATIM.LIMIT}&accept-language=${CONST.lang}`,
        )
          .then((r) => r.json())
          .then((results) => {
            window.foliplus.hideHint(CONST.name);
            if (!results || results.length === 0) {
              window.foliplus.showHint(
                CONST.name,
                _(`${CONST.name}.addr_not_found`),
                window.foliplus.HINT_DURATION.LONG,
              );
              inp.value = "";
              return;
            }

            const item = results[0];
            const displayName = item.display_name || query;
            let lat = parseFloat(item.lat);
            let lng = parseFloat(item.lon);

            const converted = window.foliplus.fromWgs84(map, lng, lat);
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
            mk = window.foliplus.createLocationMarker(
              map,
              lng,
              lat,
              displayName,
              `${CONST.name}.popup_title_addr`,
              `${CONST.name}.popup_loading`,
              `${CONST.name}.popup_loc_label`,
              `${CONST.name}.popup_addr_label`,
              mk,
            );
          })
          .catch((err) => {
            console.error(`[${CONST.name}] ${_(`${CONST.name}.addr_error`)}`);
            window.foliplus.hideHint(CONST.name);
            window.foliplus.showHint(
              CONST.name,
              _(`${CONST.name}.addr_error`),
              window.foliplus.HINT_DURATION.LONG,
            );
          });
      };

      // ── Autocomplete suggestions ──

      // Reposition the suggestions dropdown to align with the input
      const positionSuggestions = () => {
        if (!suggestionsWrap) return;
        const rect = inp.getBoundingClientRect();
        suggestionsWrap.style.left = `${rect.left + window.scrollX}px`;
        suggestionsWrap.style.top = `${rect.bottom + window.scrollY}px`;
        suggestionsWrap.style.width = `${rect.width}px`;
      };

      const renderSuggestions = (results, query) => {
        if (!results || results.length === 0) {
          removeSuggestions();
          return;
        }

        // Cache results for this query
        suggestionCache[query] = results;

        if (!suggestionsWrap) {
          suggestionsWrap = window.foliplus.dom.el("div", {
            class: CONST.CLASSES.SUGGESTIONS,
          });
          document.body.appendChild(suggestionsWrap);
          suggestionsWrap.addEventListener("click", (e) => e.stopPropagation());
        }

        suggestionsWrap.innerHTML = "";
        selectedSuggestionIdx = -1;
        positionSuggestions();

        results.forEach((item, idx) => {
          const suggestion = window.foliplus.dom.el(
            "div",
            { class: CONST.CLASSES.SUGGESTION_ITEM, "data-index": String(idx) },
            window.foliplus.dom.el(
              "span",
              { class: CONST.CLASSES.SUGGESTION_ICON },
              { html: window.foliplus.SVGs.LOCATE },
            ),
            window.foliplus.dom.el(
              "span",
              { class: CONST.CLASSES.SUGGESTION_TEXT },
              item.display_name || item.name || "",
            ),
          );
          suggestion.onclick = (e) => {
            e.stopPropagation();
            inp.value = item.display_name || item.name || "";
            removeSuggestions();
            doAddrSearch(inp.value);
          };
          suggestionsWrap.appendChild(suggestion);
        });
      };

      const fetchSuggestions = (query) => {
        if (mode !== CONST.MODE.ADDR) {
          removeSuggestions();
          return;
        }
        if (query.length < CONST.AUTOCOMPLETE.MIN_CHARS) {
          removeSuggestions();
          return;
        }
        // Check cache first
        if (suggestionCache[query]) {
          renderSuggestions(suggestionCache[query], query);
          return;
        }
        // Throttle: respect Nominatim's 1 req/s policy
        const throttle = window.foliplus.NOMINATIM.THROTTLE_MS || 1000;
        const now = Date.now();
        if (now - lastSuggestFetch < throttle) {
          if (suggestionsThrottleTimer) clearTimeout(suggestionsThrottleTimer);
          suggestionsThrottleTimer = setTimeout(
            () => fetchSuggestions(query),
            throttle - (now - lastSuggestFetch),
          );
          return;
        }
        lastSuggestFetch = Date.now();

        fetch(
          `${CONST.NOMINATIM.URL}?format=${CONST.NOMINATIM.FORMAT}&q=${encodeURIComponent(query)}&limit=${CONST.AUTOCOMPLETE.MAX_ITEMS}&accept-language=${CONST.lang}`,
        )
          .then((r) => r.json())
          .then((results) => renderSuggestions(results, query))
          .catch(() => removeSuggestions());
      };

      const debouncedFetch = window.foliplus.debounce(
        () => fetchSuggestions(inp.value.trim()),
        CONST.AUTOCOMPLETE.DEBOUNCE_MS,
      );

      inp.addEventListener("input", () => {
        if (mode === CONST.MODE.ADDR) debouncedFetch();
        else {
          debouncedFetch.cancel();
          removeSuggestions();
        }
      });

      // Keyboard navigation for suggestions
      inp.addEventListener("keydown", (e) => {
        if (e.key === "Escape") {
          if (suggestionsWrap) {
            removeSuggestions();
            return;
          }
          ctrl.classList.remove(CONST.CLASSES.EXPANDED);
          ctrl.classList.add(CONST.CLASSES.COLLAPSED);
          window.foliplus.hideHint(CONST.name);
          return;
        }
        if (e.key === "ArrowDown" && suggestionsWrap) {
          e.preventDefault();
          const items = suggestionsWrap.querySelectorAll(":scope > *");
          selectedSuggestionIdx = Math.min(selectedSuggestionIdx + 1, items.length - 1);
          items.forEach((el, i) =>
            el.classList.toggle(CONST.CLASSES.ACTIVE, i === selectedSuggestionIdx),
          );
          if (items[selectedSuggestionIdx])
            inp.value = items[selectedSuggestionIdx].textContent;
          return;
        }
        if (e.key === "ArrowUp" && suggestionsWrap) {
          e.preventDefault();
          const items = suggestionsWrap.querySelectorAll(":scope > *");
          selectedSuggestionIdx = Math.max(selectedSuggestionIdx - 1, -1);
          items.forEach((el, i) =>
            el.classList.toggle(CONST.CLASSES.ACTIVE, i === selectedSuggestionIdx),
          );
          if (selectedSuggestionIdx >= 0 && items[selectedSuggestionIdx])
            inp.value = items[selectedSuggestionIdx].textContent;
          return;
        }
        if (e.key === "Enter") {
          const raw = inp.value.trim();
          removeSuggestions();
          if (!raw) return;
          mode === CONST.MODE.COORD ? doCoordSearch(raw) : doAddrSearch(raw);
        }
      });

      // Remove suggestions when input loses focus (delay to allow click on suggestion)
      inp.addEventListener("blur", () => setTimeout(removeSuggestions, 200));

      // ── Reposition suggestions on scroll/resize ──
      const repositionHandler = () => positionSuggestions();
      const scrollTargets = [
        window,
        document.querySelector(".leaflet-container"),
      ].filter(Boolean);
      scrollTargets.forEach((t) =>
        t.addEventListener("scroll", repositionHandler, true),
      );
      window.addEventListener("resize", repositionHandler);

      // Save for cleanup in onRemove()
      this._scrollTargets = scrollTargets;
      this._repositionHandler = repositionHandler;
      this._debouncedFetch = debouncedFetch;
      this._cleanupSuggestions = removeSuggestions;

      // ── Cleanup: remove suggestions when collapsing ──
      const origToggle = toggleBtn.onclick;
      toggleBtn.onclick = (e) => {
        origToggle.call(toggleBtn, e);
        removeSuggestions();
      };

      // ── URL parameter parsing ──
      const initFromUrl = () => {
        try {
          const params = new URLSearchParams(window.location.search);
          const q = params.get(CONST.PARAM.Q);
          const latParam = params.get(CONST.PARAM.LAT);
          const lngParam = params.get(CONST.PARAM.LNG);

          if (q) {
            // ?q=longitude,latitude or ?q=address
            const parts = q
              .replace(/\uff0c/g, ",")
              .replace(/\s+/g, "")
              .split(",")
              .map(Number);
            if (parts.length >= 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
              // Coordinate search
              setMode(CONST.MODE.COORD);
              doCoordSearch(q);
            } else {
              // Address search
              setMode(CONST.MODE.ADDR);
              inp.value = q;
              doAddrSearch(q);
            }
          } else if (latParam && lngParam) {
            const lng = parseFloat(lngParam);
            const lat = parseFloat(latParam);
            if (!isNaN(lng) && !isNaN(lat)) {
              setMode(CONST.MODE.COORD);
              doCoordSearch(`${lng},${lat}`);
            }
          }
        } catch (e) {
          // Silently ignore URL parsing errors
        }
      };

      initFromUrl();

      // Collapse on outside click
      window.foliplus.bindOutsideCollapse({ container: ctrl });

      return container;
    }

    onRemove() {
      // Cleanup autocomplete listeners and suggestions
      this._cleanupSuggestions();
      if (this._debouncedFetch) this._debouncedFetch.cancel();
      this._scrollTargets.forEach((t) =>
        t.removeEventListener("scroll", this._repositionHandler, true),
      );
      window.removeEventListener("resize", this._repositionHandler);
    }
  }

  new MapSearchControl({ position: CONST.position }).addTo(map);
})();
