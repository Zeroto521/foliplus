(function () {
  const CONST = {
    name: "Fullscreen",
    RETRY_INTERVAL_MS: 100,
    HINT_DURATION_MS: 2500,
    MAXIMIZE: `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
           stroke-linecap="round" stroke-linejoin="round">
        <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/>
      </svg>`,
    MINIMIZE: `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
           stroke-linecap="round" stroke-linejoin="round">
        <path d="M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3m0 18v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3"/>
      </svg>`,
  };

  // ==================== Runtime Guard ====================
  if (!window.foliplus || !window.foliplus.SVGs) {
    console.error(`[${CONST.name}] foliplus runtime not found, plugin disabled.`);
    return;
  }

  // ==================== Dependencies ====================
  const map = {{ this._parent.get_name() }};
  const _ = (k) => (window.foliplus && window.foliplus.gt ? window.foliplus.gt(k) : k);

  window.foliplus.registerHintIcon(CONST.name, CONST.MAXIMIZE);

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

    btn.innerHTML = CONST.MAXIMIZE;
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

  // ==================== Fullscreen Event Handling ====================
  const handleFullscreenChange = () => {
    const isFull = !!document.fullscreenElement;

    // Swap icon between expand and minimize
    const container = document.querySelector(
      ".leaflet-control-zoom-fullscreen.fullscreen-btn",
    );
    if (container) container.innerHTML = isFull ? CONST.MINIMIZE : CONST.MAXIMIZE;

    if ({{ this.hide_others | tojson }}) {
      // Toggle visibility of sibling controls
      const controls = map
        .getContainer()
        .querySelectorAll(".leaflet-control, .custom-scale-wrap");

      for (const c of controls) {
        // Hide/show self based on backend template parameter
        if (
          c.classList.contains("leaflet-control-zoom-fullscreen") ||
          c.classList.contains("fullscreen-btn") ||
          c.querySelector(".fullscreen-btn")
        ) {
          if ({{ this.hide_self | tojson }}) c.style.display = isFull ? "none" : "";
          continue;
        }
        c.style.display = isFull ? "none" : "";
      }
    }

    window.foliplus.showHint(
      CONST.name,
      isFull ? _(`${CONST.name}.enter`) : _(`${CONST.name}.exit`),
      CONST.HINT_DURATION_MS,
    );
  };

  document.addEventListener("fullscreenchange", handleFullscreenChange);

  // Cleanup on map unload
  map.on("unload", () => {
    document.removeEventListener("fullscreenchange", handleFullscreenChange);
  });
})();
