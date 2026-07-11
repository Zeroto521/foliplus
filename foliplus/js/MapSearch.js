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
    hintError: 5000,
    hintForever: 0,
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

  // ==================== Helper Functions ====================
  const _hideSearchHint = () => window.foliplus.hideHint(CONST.name);
  const _showSearchHint = (msg, duration) => {
    window.foliplus.showHint(CONST.name, msg, duration);
  };

  // ==================== Control Definition ====================
  new (L.Control.extend({
    onAdd: function () {
      const container = L.DomUtil.create("div", "leaflet-bar leaflet-control");
      const ctrl = L.DomUtil.create("div", "map-search ctrl-fold collapsed", container);
      ctrl.id = "{{ this.get_name() }}_ctrl";
      ctrl.innerHTML = `
        <button class="toggle-btn" title="${_("search.btn_title")}">
          ${window.foliplus.SVGs.SEARCH}
        </button>
        <div class="search-form">
          <button class="search-mode-btn" title="${_("search.mode_coord")}">
            ${window.foliplus.SVGs.LOCATE}
          </button>
          <div class="clear-wrap">
            <input type="text" placeholder="${_("search.coord_placeholder")}" />
            <button class="ctrl-abs-btn" title="${_("search.clear_title")}">
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
      if (mode !== CONST.COORD && mode !== CONST.ADDR) {
        mode = CONST.COORD;
      }

      _setMode(mode);

      // Mode switching
      function _setMode(newMode) {
        mode = newMode;
        if (mode === CONST.COORD) {
          modeBtn.innerHTML = window.foliplus.SVGs.LOCATE;
          modeBtn.title = _("search.mode_coord");
          inp.placeholder = _("search.coord_placeholder");
        } else {
          modeBtn.innerHTML = window.foliplus.SVGs.GLOBE;
          modeBtn.title = _("search.mode_addr");
          inp.placeholder = _("search.addr_placeholder");
        }
        inp.value = "";
        if (mk) {
          map.removeLayer(mk);
          mk = null;
        }
        _hideSearchHint();
        inp.focus();
      }

      modeBtn.onclick = function (e) {
        e.stopPropagation();
        _setMode(mode === CONST.COORD ? CONST.ADDR : CONST.COORD);
      };

      // Expand / collapse
      container.querySelector(".toggle-btn").onclick = function (e) {
        e.stopPropagation();
        if (ctrl.classList.contains("expanded")) {
          ctrl.classList.remove("expanded");
          ctrl.classList.add("collapsed");
          _hideSearchHint();
        } else {
          ctrl.classList.remove("collapsed");
          ctrl.classList.add("expanded");
          inp.focus();
        }
      };

      // Clear input
      const clearBtn = container.querySelector(".ctrl-abs-btn");
      clearBtn.onclick = function () {
        inp.value = "";
        if (mk) {
          map.removeLayer(mk);
          mk = null;
        }
        inp.focus();
      };

      inp.addEventListener("input", function () {
        inp.placeholder =
          mode === CONST.COORD
            ? _("search.coord_placeholder")
            : _("search.addr_placeholder");
      });

      // Coordinate search
      function _doCoordSearch(raw) {
        const parts = raw
          .replace(/\uff0c/g, ",")
          .replace(/\s+/g, "")
          .split(",")
          .map(Number);

        if (parts.length < 2 || isNaN(parts[0]) || isNaN(parts[1])) {
          _showSearchHint(_("search.coord_error"), CONST.hintError);
          inp.value = "";
          return;
        }

        const lng = parts[0];
        const lat = parts[1];
        _hideSearchHint();
        map.flyTo([lat, lng], {{ this.zoom }});
        mk = window.foliplus.createLocationMarker(
          map,
          lat,
          lng,
          null,
          "search.popup",
          _("search.popup_title_coord"),
          mk,
        );
      }

      // Address search via Nominatim
      function _doAddrSearch(query) {
        _showSearchHint(
          window.foliplus.SVGs.LOADING + " " + _("search.popup_loading"),
          CONST.hintForever,
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
          .then(function (r) {
            return r.json();
          })
          .then(function (results) {
            _hideSearchHint();
            if (!results || results.length === 0) {
              _showSearchHint(_("search.addr_not_found"), CONST.hintError);
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
              "search.popup",
              _("search.popup_title_addr"),
              mk,
            );
          })
          .catch(function (err) {
            console.error(`[${CONST.name}] ` + _("search.addr_error"));
            _hideSearchHint();
            _showSearchHint(_("search.addr_error"), CONST.hintError);
          });
      }

      // Keyboard events
      inp.addEventListener("keydown", function (e) {
        if (e.key === "Escape") {
          ctrl.classList.remove("expanded");
          ctrl.classList.add("collapsed");
          _hideSearchHint();
          return;
        }
        if (e.key === "Enter") {
          const raw = inp.value.trim();
          if (!raw) return;
          mode === CONST.COORD ? _doCoordSearch(raw) : _doAddrSearch(raw);
        }
      });

      // Collapse on outside click
      window.foliplus.bindOutsideCollapse({
        map: map,
        container: ctrl,
        shouldCollapse: function () {
          return !inp.value.trim();
        },
        onCollapse: function () {
          _hideSearchHint();
        },
      });

      return container;
    },
  }))({
    position: "{{ this.position }}",
  }).addTo(map);
})();
