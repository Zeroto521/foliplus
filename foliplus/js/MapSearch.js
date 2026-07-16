(function () {
  // ==================== Constants ====================
  const CONST = {
    name: "MapSearch",
    COORD: "coord",
    ADDR: "addr",
    nominatimUrl: "https://nominatim.openstreetmap.org/search",
    nominatimFormat: "jsonv2",
    nominatimLimit: 1,
    zoomMax: 16,
    zoomMin: 12,
    zoomBase: 18,
    zoomDivisor: 20,
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
      const ctrl = L.DomUtil.create("div", "map-search ctrl-fold collapsed", container);
      ctrl.id = "{{ this.get_name() }}_ctrl";
      ctrl.innerHTML = `
        <button class="toggle-btn" title="${_(`${CONST.name}.btn_title`)}">
          ${window.foliplus.SVGs.SEARCH}
        </button>
        <div class="search-form">
          <button class="search-mode-btn" title="${_(`${CONST.name}.mode_coord`)}">
            ${window.foliplus.SVGs.LOCATE}
          </button>
          <div class="clear-wrap">
            <input type="text" placeholder="${_(`${CONST.name}.coord_placeholder`)}"/>
            <button class="ctrl-abs-btn" title="${_(`${CONST.name}.clear_title`)}">
              ${window.foliplus.SVGs.CLOSE}
            </button>
          </div>
        </div>
      `;

      L.DomEvent.disableClickPropagation(container);
      L.DomEvent.disableScrollPropagation(container);

      const inp = container.querySelector("input");
      const modeBtn = container.querySelector(".search-mode-btn");
      let mk = null;
      let mode = "{{ this.mode }}";
      if (mode !== CONST.COORD && mode !== CONST.ADDR) mode = CONST.COORD;

      _setMode(mode);

      // Mode switching
      function _setMode(newMode) {
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
        _setMode(mode === CONST.COORD ? CONST.ADDR : CONST.COORD);
      };

      // Expand / collapse
      container.querySelector(".toggle-btn").onclick = (e) => {
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
      const clearBtn = container.querySelector(".ctrl-abs-btn");
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
          window.foliplus.showHint(CONST.name, _(`${CONST.name}.coord_error`), window.foliplus.HINT_DURATION.LONG);
          inp.value = "";
          return;
        }

        const lng = parts[0];
        const lat = parts[1];
        window.foliplus.hideHint(CONST.name);
        map.flyTo([lat, lng], {{ this.zoom }});
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
        mk,
      };

      // Address search via Nominatim
      const doAddrSearch = (query) => {
        window.foliplus.showHint(
          CONST.name,
          window.foliplus.SVGs.LOADING + " " + _(`${CONST.name}.popup_loading`),
          window.foliplus.HINT_DURATION.PERSIST,
        );

        fetch(
          CONST.nominatimUrl +
            "?format=" +
            CONST.nominatimFormat +
            "&q=" +
            encodeURIComponent(query) +
            "&limit=" +
            CONST.nominatimLimit +
            "&accept-language=" +
            (window._LOCALE["locale.code"] || "en"),
        )
          .then((r) => r.json())
          .then((results) => {
            window.foliplus.hideHint(CONST.name);
            if (!results || results.length === 0) {
              window.foliplus.showHint(CONST.name, _(`${CONST.name}.addr_not_found`), window.foliplus.HINT_DURATION.LONG);
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
              CONST.zoomMax,
              Math.max(
                CONST.zoomMin,
                CONST.zoomBase - Math.floor(displayName.length / CONST.zoomDivisor),
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
            window.foliplus.showHint(CONST.name, _(CONST.name + ".addr_error"), window.foliplus.HINT_DURATION.LONG);
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
      window.foliplus.bindOutsideCollapse({
        map: map,
        container: ctrl,
        shouldCollapse: () => !inp.value.trim(),
        onCollapse: () => window.foliplus.hideHint(CONST.name),
      });

      return container;
    },
  }))({
    position: "{{ this.position }}",
  }).addTo(map);
})();
