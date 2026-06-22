(function() {
  const map = {{ this._parent.get_name() }};
  const SM = window._mapShared;
  const _ = (key) => _LOCALE[key] || key;
  // Wrapper so shared functions (createLocationMarker etc.) can access properties
  const _TXT = {
    get POPUP_TITLE_COORD() { return _('search.popup_title_coord'); },
    get POPUP_TITLE_ADDR() { return _('search.popup_title_addr'); },
    get POPUP_TITLE() { return _('search.popup_title_coord'); },
    get POPUP_LOC_LABEL() { return _('search.popup_loc_label'); },
    get POPUP_ADDR_LABEL() { return _('search.popup_addr_label'); },
    get POPUP_LOADING() { return _('search.popup_loading'); },
    get POPUP_LOADING_PREFIX() { return 'LOADING'; },
  };

  SM.registerHintIcon('map-search', SM.SVGs.SEARCH);

  // Mode constants
  const MODE = { COORD: 'coord', ADDR: 'addr' };

  function _hideSearchHint() { SM.hideHint('map-search'); }
  function _showSearchHint(msg, duration) { SM.showHint('map-search', msg, duration); }

  // Define and instantiate the control
  new (L.Control.extend({
    onAdd: function() {
      const container = L.DomUtil.create("div", "leaflet-bar leaflet-control");
      const ctrl = L.DomUtil.create(
        "div", "map-search ctrl-compact collapsed", container
      );
      ctrl.id = "{{ this.get_name() }}_ctrl";
      ctrl.innerHTML = `
        <button class="toggle-btn" title="${_('search.btn_title')}">${SM.SVGs.SEARCH}</button>
        <div class="search-form">
          <button class="search-mode-btn" title="${_('search.mode_coord')}">${SM.SVGs.LOCATE}
          </button>
          <div class="clear-wrap">
            <input type="text" placeholder="${_('search.coord_placeholder')}" />
            <button class="clear-btn" title="${_('search.clear_title')}">
              ${SM.SVGs.CLOSE}
            </button>
          </div>
        </div>
      `;

      L.DomEvent.disableClickPropagation(container);
      L.DomEvent.disableScrollPropagation(container);

      const inp = container.querySelector("input");
      const modeBtn = container.querySelector(".search-mode-btn");
      let mk = null;
      let mode = MODE.COORD;

      // Mode switching
      function _setMode(newMode) {
        mode = newMode;
        if (mode === MODE.COORD) {
          modeBtn.innerHTML = SM.SVGs.LOCATE;
          modeBtn.title = _('search.mode_coord');
          inp.placeholder = _('search.coord_placeholder');
        } else {
          modeBtn.innerHTML = SM.SVGs.GLOBE;
          modeBtn.title = _('search.mode_addr');
          inp.placeholder = _('search.addr_placeholder');
        }
        inp.value = '';
        if (mk) { map.removeLayer(mk); mk = null; }
        _hideSearchHint();
        inp.focus();
      }

      modeBtn.onclick = function(e) {
        e.stopPropagation();
        _setMode(mode === MODE.COORD ? MODE.ADDR : MODE.COORD);
      };

      // Expand / collapse
      container.querySelector(".toggle-btn").onclick = function(e) {
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
      const clearBtn = container.querySelector(".clear-btn");
      clearBtn.onclick = function() {
        inp.value = "";
        if (mk) { map.removeLayer(mk); mk = null; }
        inp.focus();
      };

      inp.addEventListener("input", function() {
        inp.placeholder = mode === MODE.COORD
          ? _('search.coord_placeholder') : _('search.addr_placeholder');
      });

      // Coordinate search
      function _doCoordSearch(raw) {
        const parts = raw.replace(/\uff0c/g, ",").replace(/\s+/g, "")
          .split(",").map(Number);

        if (parts.length < 2 || isNaN(parts[0]) || isNaN(parts[1])) {
          _showSearchHint(_('search.coord_error'), 5000);
          inp.value = '';
          return;
        }

        const lng = parts[0], lat = parts[1];
        _hideSearchHint();
        map.flyTo([lat, lng], {{ this.zoom }});
        mk = SM.createLocationMarker(
          map, lat, lng, null, _LOCALE, _('search.popup_title_coord'), mk
        );
      }

      // Address search via Nominatim
      function _doAddrSearch(query) {
        _showSearchHint(SM.SVGs.LOADING + ' ' + _('search.popup_loading'), 0);

        fetch('https://nominatim.openstreetmap.org/search' +
          '?format=jsonv2&q=' + encodeURIComponent(query) +
          '&limit=1&accept-language=' + (_LOCALE['locale.code'] || 'en'))
          .then(function(r) { return r.json(); })
          .then(function(results) {
            _hideSearchHint();
            if (!results || results.length === 0) {
              _showSearchHint(_('search.addr_not_found'), 5000);
              inp.value = '';
              return;
            }

            const item = results[0];
            let lat = parseFloat(item.lat), lng = parseFloat(item.lon);
            const displayName = item.display_name || query;

            // Transform coordinates from WGS84 to the map's CRS
            const converted = SM.fromWgs84(map, lng, lat);
            lng = converted[0]; lat = converted[1];

            const zoom = Math.min(16,
              Math.max(12, 18 - Math.floor(displayName.length / 20)));
            map.flyTo([lat, lng], zoom);
            mk = SM.createLocationMarker(
              map, lat, lng, displayName, _LOCALE, _('search.popup_title_addr'), mk
            );
          })
          .catch(function(err) {
            console.error(err);
            _hideSearchHint();
            _showSearchHint(_('search.addr_error'), 5000);
          });
      }

      // Keyboard events
      inp.addEventListener("keydown", function(e) {
        if (e.key === "Escape") {
          ctrl.classList.remove("expanded");
          ctrl.classList.add("collapsed");
          _hideSearchHint();
          return;
        }
        if (e.key === "Enter") {
          const raw = inp.value.trim();
          if (!raw) return;
          mode === MODE.COORD ? _doCoordSearch(raw) : _doAddrSearch(raw);
        }
      });

      // Collapse on outside click
      SM.bindOutsideCollapse({
        map: map, container: ctrl,
        shouldCollapse: function() { return !inp.value.trim(); },
        onCollapse: function() { _hideSearchHint(); }
      });

      return container;
    }
  }))({
    position: "{{ this.position }}"
  }).addTo(map);
})();
