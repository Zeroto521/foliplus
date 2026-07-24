(function () {
  // ==================== Constants ====================
  const CONST = {
    name: "MapSearch",
    position: "{{ this.position }}",
    zoom: {{ this.zoom }},
    MODE: {
      COORD: "coord",
      ADDR: "addr",
    },
    NOMINATIM: {
      URL: "https://nominatim.openstreetmap.org/search",
      FORMAT: "jsonv2",
      LIMIT: 1,
    },
    ZOOM: {
      MAX: 16,
      MIN: 12,
      BASE: 18,
      DIVISOR: 20,
    },
    CLASSES: {
      EXPANDED: "expanded",
      COLLAPSED: "collapsed",
      MAP_SEARCH: "foliplus-map-search",
      SEARCH_MODE_BTN: "foliplus-search-mode-btn",
      CLEAR_WRAP: "foliplus-clear-wrap",
      CTRL_BTN: "foliplus-ctrl-btn",
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

      setMode(mode);

      // Mode switching
      function setMode(newMode) {
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
        inp.focus();
      }

      modeBtn.onclick = (e) => {
        e.stopPropagation();
        setMode(mode === CONST.MODE.COORD ? CONST.MODE.ADDR : CONST.MODE.COORD);
      };

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
        map.flyTo([lat, lng], CONST.zoom);
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
          window.foliplus.SVGs.LOADING + " " + _(`${CONST.name}.popup_loading`),
          window.foliplus.HINT_DURATION.PERSIST,
        );

        fetch(
          CONST.NOMINATIM.URL +
            "?format=" +
            CONST.NOMINATIM.FORMAT +
            "&q=" +
            encodeURIComponent(query) +
            "&limit=" +
            CONST.NOMINATIM.LIMIT +
            "&accept-language=" +
            (window._LOCALE["locale.code"] || "en"),
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
            console.error(`[${CONST.name}] ${_(CONST.name + ".addr_error")}`);
            window.foliplus.hideHint(CONST.name);
            window.foliplus.showHint(
              CONST.name,
              _(`${CONST.name}.addr_error`),
              window.foliplus.HINT_DURATION.LONG,
            );
          });
      };

      // Keyboard events
      inp.addEventListener("keydown", (e) => {
        if (e.key === "Escape") {
          ctrl.classList.remove(CONST.CLASSES.EXPANDED);
          ctrl.classList.add(CONST.CLASSES.COLLAPSED);
          window.foliplus.hideHint(CONST.name);
          return;
        }
        if (e.key === "Enter") {
          const raw = inp.value.trim();
          if (!raw) return;
          mode === CONST.MODE.COORD ? doCoordSearch(raw) : doAddrSearch(raw);
        }
      });

      // Collapse on outside click
      window.foliplus.bindOutsideCollapse({ container: ctrl });

      return container;
    }
  }

  new MapSearchControl({ position: CONST.position }).addTo(map);
})();
