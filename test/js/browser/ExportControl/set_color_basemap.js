() => {
  // Set up a solid-color basemap through the ⋮ → Style → fill row path.
  // The row-level colour picker was removed; the fill row in the style panel
  // is now the entry (same commit that moved it there).
  const ctrl = document.querySelector(".foliplus-layer-ctrl");
  if (ctrl && !ctrl.classList.contains("is-expanded")) {
    ctrl.querySelector(".foliplus-toggle-btn").click();
  }
  const item = document.querySelector(".foliplus-color-layer-item");
  if (!item) return { ok: false, reason: "no color item" };

  // Show the colour basemap: clicking the row (not the ⋮ button) fires
  // showColorLayer through the onClick handler.
  item.click();

  // Open the style panel via ⋮ → Style so we can set the fill colour.
  const moreBtn = item.querySelector(".foliplus-layer-more-btn");
  if (moreBtn) moreBtn.click();
  const styleEntry = document.querySelector(
    '.foliplus-layer-more-menu [data-action="style-layer"]',
  );
  if (styleEntry && !styleEntry.disabled) styleEntry.click();

  const panel = document.querySelector(".foliplus-layer-style-panel");
  const input = panel ? panel.querySelector(".foliplus-style-fill-color-input") : null;
  if (input) {
    input.value = "#dc1e1e"; // rgb(220, 30, 30)
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }

  const container = document.querySelector(".leaflet-container");
  const cs = getComputedStyle(container);
  return {
    ok: true,
    containerActive: container.classList.contains("active"),
    cssVar: container.style.getPropertyValue("--color-layer-bg"),
    bg: cs.backgroundColor,
    stylePanelOpen: !!panel,
  };
};
