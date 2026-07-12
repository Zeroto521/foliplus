(function () {
  const CONST = {
    name: "Fullscreen",
    RETRY_INTERVAL_MS: 100,
    HINT_DURATION_MS: 2500,
    MAXIMIZE: `
      <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
        <path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z"/>
      </svg>`,
    MINIMIZE: `
      <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
        <path d="M5 16h3v3h2v-5H5v2zm3-8H5v2h5V5H8v3zm6 11h2v-3h3v-2h-5v5zm2-11V5h-2v5h5V8h-3z"/>
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
