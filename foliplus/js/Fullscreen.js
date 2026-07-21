(function () {
  const CONST = {
    name: "Fullscreen",
    RETRY_INTERVAL_MS: 100,
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

  // ==================== Control Setup ====================
  const fsControl = L.control
    .fullscreen({
      position: "{{ this.position }}",
      title: _(`${CONST.name}.title`),
      title_cancel: _(`${CONST.name}.title_cancel`),
      forceSeparateButton: false,
    })
    .addTo(map);
  const fsContainer = fsControl.getContainer();

  // ==================== Icon Replacement ====================
  // Replace the default fullscreen icon with custom SVG,
  // then break native event bindings by cloning the button.
  (function replaceIcon() {
    const btn =
      document.querySelector(".leaflet-control-zoom-fullscreen") ||
      fsContainer?.querySelector("a, button");

    if (!btn) {
      setTimeout(replaceIcon, CONST.RETRY_INTERVAL_MS);
      return;
    }

    btn.innerHTML = SVGs.MAXIMIZE;
    btn.classList.add("fullscreen-btn");

    // Break native event bindings by cloning and replacing the button
    const newBtn = btn.cloneNode(true);
    btn.parentNode.replaceChild(newBtn, btn);

    newBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (document.fullscreenElement) document.exitFullscreen();
      else map.getContainer().requestFullscreen();
    });
  })();

  // ==================== Zoom Icon Replacement ====================
  // Replace Leaflet native zoom +/- icons (::before) with inline SVGs
  // so common.css SVG hover/active scale rules apply directly.
  (function replaceZoomIcons() {
    const zoomIn = document.querySelector(".leaflet-control-zoom-in");
    const zoomOut = document.querySelector(".leaflet-control-zoom-out");

    if (!zoomIn || !zoomOut) {
      setTimeout(replaceZoomIcons, CONST.RETRY_INTERVAL_MS);
      return;
    }

    // Remove ::before content
    zoomIn.innerHTML = SVGs.ZOOM_IN;
    zoomOut.innerHTML = SVGs.ZOOM_OUT;

    // Preserve native zoom behavior by re-binding click handlers
    // (Leaflet already bound them via the control, cloning would break)
    // Just ensure the buttons have the right structure
  })();

  // ==================== Fullscreen Event Handling ====================
  const handleFullscreenChange = () => {
    const isFull = !!document.fullscreenElement;

    // Swap icon between expand and minimize
    const container = document.querySelector(
      ".leaflet-control-zoom-fullscreen.fullscreen-btn",
    );
    if (container) container.innerHTML = isFull ? SVGs.MINIMIZE : SVGs.MAXIMIZE;

    if ({{ this.hide_others | tojson }}) {
      // Toggle visibility of sibling controls
      const controls = map
        .getContainer()
        .querySelectorAll(".leaflet-control, .custom-scale-wrap");

      for (const c of controls) {
        if (
          c.classList.contains("leaflet-control-zoom-fullscreen") ||
          c.classList.contains("fullscreen-btn") ||
          c.querySelector(".fullscreen-btn")
        )
          continue;
        c.style.display = isFull ? "none" : "";
      }
    }

    // Handle hide_self independently of hide_others
    // Hide zoom +/- and fullscreen button together
    if ({{ this.hide_self | tojson }}) {
      const zoomContainer = map.getContainer().querySelector(".leaflet-control-zoom");
      if (zoomContainer) zoomContainer.style.display = isFull ? "none" : "";
    }

    window.foliplus.showHint(
      CONST.name,
      isFull ? _(`${CONST.name}.enter`) : _(`${CONST.name}.exit`),
      window.foliplus.HINT_DURATION.MEDIUM,
    );
  };

  document.addEventListener("fullscreenchange", handleFullscreenChange);

  // Cleanup on map unload
  map.on("unload", () => {
    document.removeEventListener("fullscreenchange", handleFullscreenChange);
  });
})();
