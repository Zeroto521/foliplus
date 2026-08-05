(function () {
  const CONST = {
    name: "FullscreenControl",
    position: "{{ this.position }}",
    CLASSES: {
      PSEUDO_FULLSCREEN: "leaflet-pseudo-fullscreen",
      TOOL_BTN: "foliplus-tool-btn",
      FULLSCREEN_BAR: "foliplus-fullscreen-bar",
      ZOOM_IN: "foliplus-zoom-in",
      ZOOM_OUT: "foliplus-zoom-out",
      FS_TOGGLE: "foliplus-fullscreen-toggle",
      HIDDEN: "foliplus-fullscreen-hidden",
    },
  };
  const ContainerId = `${CONST.name}_${CONST.position}_container`;

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

  foliplus.registerHintIcon(CONST.name, SVGs.MAXIMIZE);

  // ==================== FullscreenControl API ====================
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

  // ==================== FullscreenControl (L.Control) ====================
  class FullscreenControl extends L.Control {
    onAdd() {
      // Remove default Leaflet zoom control — we provide our own +/- buttons
      if (map.zoomControl) map.removeControl(map.zoomControl);
      else {
        // Fallback: remove by DOM (e.g. when map created without zoomControl option)
        const zoomEl = map.getContainer().querySelector(".leaflet-control-zoom");
        if (zoomEl) zoomEl.remove();
      }

      // Build container — two-layer structure matching createFoldControl:
      // outer .leaflet-bar.leaflet-control (Leaflet default shadow) wrapping
      // inner .foliplus-fullscreen-bar (shadow-ctrl-strong)
      const outer = foliplus.dom.el("div", {
        class: "leaflet-bar leaflet-control",
        id: ContainerId,
      });
      const container = foliplus.dom.el("div", {
        class: `${CONST.CLASSES.FULLSCREEN_BAR} foliplus-ctrl-fold`,
        parent: outer,
      });

      // Zoom in button — <button> element with tool-btn class
      const zoomInBtn = foliplus.dom.el(
        "button",
        {
          class: `${CONST.CLASSES.TOOL_BTN} ${CONST.CLASSES.ZOOM_IN}`,
          "aria-label": _(`${CONST.name}.zoom_in`),
          title: _(`${CONST.name}.zoom_in`),
          parent: container,
          onclick: (e) => {
            L.DomEvent.stopPropagation(e);
            map.zoomIn();
          },
        },
        { html: SVGs.ZOOM_IN },
      );

      // Zoom out button
      const zoomOutBtn = foliplus.dom.el(
        "button",
        {
          class: `${CONST.CLASSES.TOOL_BTN} ${CONST.CLASSES.ZOOM_OUT}`,
          "aria-label": _(`${CONST.name}.zoom_out`),
          title: _(`${CONST.name}.zoom_out`),
          parent: container,
          onclick: (e) => {
            L.DomEvent.stopPropagation(e);
            map.zoomOut();
          },
        },
        { html: SVGs.ZOOM_OUT },
      );

      // FullscreenControl toggle button
      const fsBtn = foliplus.dom.el(
        "button",
        {
          class: `${CONST.CLASSES.TOOL_BTN} ${CONST.CLASSES.FS_TOGGLE}`,
          "aria-label": _(`${CONST.name}.title`),
          title: _(`${CONST.name}.title`),
          parent: container,
          onclick: (e) => {
            L.DomEvent.stopPropagation(e);
            toggleFullscreen();
          },
        },
        { html: SVGs.MAXIMIZE },
      );

      L.DomEvent.disableClickPropagation(outer);
      L.DomEvent.disableScrollPropagation(outer);

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
            .querySelectorAll(".leaflet-control, .foliplus-scale-wrap");
          for (const c of controls) {
            if (c.contains(container) || c.closest?.(`#${ContainerId}`)) continue;
            c.classList.toggle(CONST.CLASSES.HIDDEN, isFull);
          }
        }

        if ({{ this.hide_self | tojson }}) {
          // The fullscreen button, zoom +/- are all part of the fullscreen
          // control itself; hide them together while in fullscreen.
          const selfBtns = container.querySelectorAll(
            `.${CONST.CLASSES.FS_TOGGLE}, .${CONST.CLASSES.ZOOM_IN}, .${CONST.CLASSES.ZOOM_OUT}`,
          );
          for (const btn of selfBtns)
            btn.classList.toggle(CONST.CLASSES.HIDDEN, isFull);
        }

        foliplus.showHint(
          CONST.name,
          isFull ? _(`${CONST.name}.enter`) : _(`${CONST.name}.exit`),
          foliplus.HINT_DURATION.MEDIUM,
        );
      };

      // ==================== FullscreenControl Toggle ====================
      const toggleFullscreen = () => {
        if (getFullscreenEl()) {
          if (isEnabled) {
            document[nativeAPI.exitFullscreen]()
              .then(() => {
                map._isFullscreen = false;
              })
              .catch(() => {
                map._isFullscreen = !!getFullscreenEl();
                updateUI();
              });
            return;
          } else {
            map._container.classList.remove(CONST.CLASSES.PSEUDO_FULLSCREEN);
            map.invalidateSize();
          }
          map._isFullscreen = false;
        } else {
          if (isEnabled) {
            map._container[nativeAPI.requestFullscreen]()
              .then(() => {
                map._isFullscreen = true;
              })
              .catch(() => {
                map._isFullscreen = !!getFullscreenEl();
                updateUI();
              });
            return;
          } else {
            map._container.classList.add(CONST.CLASSES.PSEUDO_FULLSCREEN);
            map.invalidateSize();
          }
          map._isFullscreen = true;
        }
        updateUI();
      };

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

      return outer;
    }

    onRemove() {
      if (isEnabled)
        document.removeEventListener(nativeAPI.fullscreenchange, this.handleFSChange);
    }
  }

  // Register the control
  new FullscreenControl({ position: CONST.position }).addTo(map);
})();
