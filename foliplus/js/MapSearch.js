(function () {
  // ==================== Constants ====================
  const CONST = {
    name: "MapSearch",
    COORD: "coord",
    ADDR: "addr",
    NOMINATIM_URL: "https://nominatim.openstreetmap.org/search",
    NOMINATIM_FORMAT: "jsonv2",
    NOMINATIM_LIMIT: 1,
    ZOOM_MAX: 16,
    ZOOM_MIN: 12,
    ZOOM_BASE: 18,
    ZOOM_DIVISOR: 20,
    position: "{{ this.position }}",
    zoom: {{ this.zoom }},
  };

  // ==================== Runtime Guard ====================
  if (!window.foliplus || !window.foliplus.SVGs) {
    console.error(`[${CONST.name}] foliplus runtime not found, plugin disabled.`);
    return;
  }

  // ==================== Dependencies ====================
  const map = {{ this._parent.get_name() }};
  const _ = (k) => (window.foliplus && window.foliplus.gt ? window.foliplus.gt(k) : k);

  window.foliplus.registerHintIcon(CONST.name, window.foliplus.SVGs.SEARCH);

  // ==================== Control Definition ====================
  new (L.Control.extend({
    onAdd: () => {
      const container = L.DomUtil.create("div", "leaflet-bar leaflet-control");
      const ctrl = L.DomUtil.create(
        "div",
        `map-search ctrl-fold collapsed${CONST.position.indexOf("right") >= 0 ? " align-right" : ""}`,
        container,
      );
      ctrl.id = "{{ this.get_name() }}_ctrl";

      const toggleBtn = foliplus.dom.el(
        "button",
        { class: "toggle-btn", title: _(`${CONST.name}.btn_title`) },
        { _html: window.foliplus.SVGs.SEARCH },
      );
      const modeBtn = foliplus.dom.el(
        "button",
        { class: "search-mode-btn", title: _(`${CONST.name}.mode_coord`) },
        { _html: window.foliplus.SVGs.LOCATE },
      );
      const inp = foliplus.dom.el("input", {
        type: "text",
        placeholder: _(`${CONST.name}.coord_placeholder`),
      });
      const clearBtn = foliplus.dom.el(
        "button",
        { class: "ctrl-abs-btn", title: _(`${CONST.name}.clear_title`) },
        { _html: window.foliplus.SVGs.CLOSE },
      );
      const toolBar = foliplus.dom.el(
        "div",
        { class: "tool-bar" },
        modeBtn,
        foliplus.dom.el("div", { class: "clear-wrap" }, inp, clearBtn),
      );
      ctrl.appendChild(toggleBtn);
      ctrl.appendChild(toolBar);

      L.DomEvent.disableClickPropagation(container);
      L.DomEvent.disableScrollPropagation(container);

      let mk = null;
      let mode = "{{ this.mode }}";
      if (mode !== CONST.COORD && mode !== CONST.ADDR) mode = CONST.COORD;

      setMode(mode);

      // Mode switching
      function setMode(newMode) {
        mode = newMode;
        if (mode === CONST.COORD) {
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
        setMode(mode === CONST.COORD ? CONST.ADDR : CONST.COORD);
      };

      // Expand / collapse
      toggleBtn.onclick = (e) => {
        e.stopPropagation();
        if (ctrl.classList.contains("expanded")) {
          ctrl.classList.remove("expanded");
          ctrl.classList.add("collapsed");
          window.foliplus.hideHint(CONST.name);
        } else {
          ctrl.classList.remove("collapsed");
          ctrl.classList.add("expanded");
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
          mode === CONST.COORD
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
          lat,
          lng,
          null,
          `${CONST.name}.popup_title_coord`,
          `${CONST.name}.popup_loading`,
          `${CONST.name}.popup_loc_label`,
          `${CONST.name}.popup_addr_label`,
        );
        mk;
      };

      // Address search via Nominatim
      const doAddrSearch = (query) => {
        window.foliplus.showHint(
          CONST.name,
          window.foliplus.SVGs.LOADING + " " + _(`${CONST.name}.popup_loading`),
          window.foliplus.HINT_DURATION.PERSIST,
        );

        fetch(
          CONST.NOMINATIM_URL +
            "?format=" +
            CONST.NOMINATIM_FORMAT +
            "&q=" +
            encodeURIComponent(query) +
            "&limit=" +
            CONST.NOMINATIM_LIMIT +
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
              CONST.ZOOM_MAX,
              Math.max(
                CONST.ZOOM_MIN,
                CONST.ZOOM_BASE - Math.floor(displayName.length / CONST.ZOOM_DIVISOR),
              ),
            );
            map.flyTo([lat, lng], zoom);
            mk = window.foliplus.createLocationMarker(
              map,
              lat,
              lng,
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
              _(CONST.name + ".addr_error"),
              window.foliplus.HINT_DURATION.LONG,
            );
          });
      };

      // Keyboard events
      inp.addEventListener("keydown", (e) => {
        if (e.key === "Escape") {
          ctrl.classList.remove("expanded");
          ctrl.classList.add("collapsed");
          window.foliplus.hideHint(CONST.name);
          return;
        }
        if (e.key === "Enter") {
          const raw = inp.value.trim();
          if (!raw) return;
          mode === CONST.COORD ? doCoordSearch(raw) : doAddrSearch(raw);
        }
      });

      // Collapse on outside click
      window.foliplus.bindOutsideCollapse({ container: ctrl });

      return container;
    },
  }))({ position: CONST.position }).addTo(map);
})();
