(function () {
  const CONST = {
    name: "Fullscreen",
    position: "{{ this.position }}",
    containerId() {
      return `${this.name}_${this.position}_container`;
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
    MAXIMIZE: `
      <svg viewBox="0 0 24 24">
        <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/>
      </svg>`,
    MINIMIZE: `
      <svg viewBox="0 0 24 24">
        <path d="M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3m0 18v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3"/>
      </svg>`,
    ZOOM_IN: `
      <svg viewBox="0 0 24 24">
        <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
      </svg>`,
    ZOOM_OUT: `
      <svg viewBox="0 0 24 24">
        <line x1="5" y1="12" x2="19" y2="12"/>
      </svg>`,
  };

  window.foliplus.registerHintIcon(CONST.name, SVGs.MAXIMIZE);

  // ==================== Fullscreen API ====================
  const nativeAPI = (() => {
    const methodMap = [
      [
        "requestFullscreen",
        "exitFullscreen",
        "fullscreenElement",
        "fullscreenEnabled",
        "fullscreenchange",
        "fullscreenerror",
      ],
      [
        "webkitRequestFullscreen",
        "webkitExitFullscreen",
        "webkitFullscreenElement",
        "webkitFullscreenEnabled",
        "webkitfullscreenchange",
        "webkitfullscreenerror",
      ],
    ];
    const base = methodMap[0];
    for (const m of methodMap)
      if (m[1] in document) return Object.fromEntries(base.map((k, i) => [k, m[i]]));
    return null;
  })();

  const isEnabled = nativeAPI && Boolean(document[nativeAPI.fullscreenEnabled]);
  const getFullscreenEl = () => nativeAPI && document[nativeAPI.fullscreenElement];

  // ==================== Fullscreen Control (L.Control) ====================
  class FullscreenControl extends L.Control {
    onAdd() {
      // Remove default Leaflet zoom control — we provide our own +/- buttons
      if (map.zoomControl) map.removeControl(map.zoomControl);
      else {
        // Fallback: remove by DOM (e.g. when map created without zoomControl option)
        const zoomEl = map.getContainer().querySelector(".leaflet-control-zoom");
        if (zoomEl) zoomEl.remove();
      }

      // Build container — leaflet-bar for alignment with other foliplus controls
      const container = window.foliplus.dom.el("div", { class: "leaflet-bar fs-bar" });
      container.id = CONST.containerId();

      // Zoom in button — <button> element with tool-btn class
      const zoomInBtn = window.foliplus.dom.el(
        "button",
        {
          class: "tool-btn fs-zoom-in",
          "aria-label": _(`${CONST.name}.zoom_in`),
          title: _(`${CONST.name}.zoom_in`),
        },
        { html: SVGs.ZOOM_IN },
      );
      zoomInBtn.addEventListener("click", (e) => {
        L.DomEvent.stopPropagation(e);
        map.zoomIn();
      });
      container.appendChild(zoomInBtn);

      // Zoom out button
      const zoomOutBtn = window.foliplus.dom.el(
        "button",
        {
          class: "tool-btn fs-zoom-out",
          "aria-label": _(`${CONST.name}.zoom_out`),
          title: _(`${CONST.name}.zoom_out`),
        },
        { html: SVGs.ZOOM_OUT },
      );
      zoomOutBtn.addEventListener("click", (e) => {
        L.DomEvent.stopPropagation(e);
        map.zoomOut();
      });
      container.appendChild(zoomOutBtn);

      // Fullscreen toggle button
      const fsBtn = window.foliplus.dom.el(
        "button",
        {
          class: "tool-btn fullscreen-btn",
          "aria-label": _(`${CONST.name}.title`),
          title: _(`${CONST.name}.title`),
        },
        { html: SVGs.MAXIMIZE },
      );
      container.appendChild(fsBtn);

      L.DomEvent.disableClickPropagation(container);
      L.DomEvent.disableScrollPropagation(container);

      // ==================== UI Update ====================
      const updateUI = () => {
        const isFull = !!getFullscreenEl() || map._isFullscreen;
        fsBtn.innerHTML = isFull ? SVGs.MINIMIZE : SVGs.MAXIMIZE;
        fsBtn.title = isFull
          ? _(`${CONST.name}.title_cancel`)
          : _(`${CONST.name}.title`);

        if ({{ this.hide_others | tojson }}) {
          const controls = map
            .getContainer()
            .querySelectorAll(".leaflet-control, .custom-scale-wrap");
          for (const c of controls) {
            if (c.contains(container) || c.closest?.("#" + CONST.containerId)) continue;
            c.style.display = isFull ? "none" : "";
          }
        }

        if ({{ this.hide_self | tojson }}) container.style.display = isFull ? "none" : "";

        window.foliplus.showHint(
          CONST.name,
          isFull ? _(`${CONST.name}.enter`) : _(`${CONST.name}.exit`),
          window.foliplus.HINT_DURATION.MEDIUM,
        );
      };

      // ==================== Fullscreen Toggle ====================
      const toggleFullscreen = () => {
        if (getFullscreenEl()) {
          if (isEnabled) document[nativeAPI.exitFullscreen]().catch(() => {});
          else {
            L.DomUtil.removeClass(map._container, "leaflet-pseudo-fullscreen");
            map.invalidateSize();
          }
          map._isFullscreen = false;
        } else {
          if (isEnabled) map._container[nativeAPI.requestFullscreen]().catch(() => {});
          else {
            L.DomUtil.addClass(map._container, "leaflet-pseudo-fullscreen");
            map.invalidateSize();
          }
          map._isFullscreen = true;
        }
        updateUI();
      };

      // Click on fullscreen button
      fsBtn.addEventListener("click", (e) => {
        L.DomEvent.stopPropagation(e);
        toggleFullscreen();
      });

      // ==================== Event Listeners ====================
      const handleFSChange = () => {
        map._isFullscreen = !!getFullscreenEl();
        updateUI();
      };

      if (isEnabled)
        document.addEventListener(nativeAPI.fullscreenchange, handleFSChange);

      map.on("unload", () => {
        if (isEnabled)
          document.removeEventListener(nativeAPI.fullscreenchange, handleFSChange);
      });

      this.handleFSChange = handleFSChange;

      return container;
    }

    onRemove() {
      if (isEnabled)
        document.removeEventListener(nativeAPI.fullscreenchange, this.handleFSChange);
    }
  }

  // Register the control
  new FullscreenControl({ position: CONST.position }).addTo(map);
})();
