// R1 probe (§10.3 #9): solid-color basemap current DOM path.
//
// Today the color basemap has NO pane and NO element of its own. Its state
// is ad-hoc across five spots: ui.isColorActive, ui.currentColor, the
// `--color-layer-bg` CSS var on the map container, the `.active` class on
// the container, the `foliplus-layer-tile-hidden` class on tilePane, and
// the color input value. The visible background is the map container's own
// CSS background (`.leaflet-container.active { background: var(--color-layer-bg) }`),
// while tilePane is hidden via visibility/opacity. "提升为 surface" (R8)
// gives it a pane + element so the same per-layer write path covers it.
() => {
  const ctrl = document.querySelector(".foliplus-layer-ctrl");
  if (ctrl && !ctrl.classList.contains("expanded")) {
    ctrl.querySelector(".foliplus-toggle-btn").click();
  }
  const item = document.querySelector(".foliplus-color-layer-item");
  if (!item) return { itemFound: false };
  item.click();
  const input = document.querySelector(
    ".foliplus-color-layer-item input[type='color']",
  );
  if (input) {
    input.value = "#3366cc";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }
  const container = document.querySelector(".leaflet-container");
  const tilePane = document.querySelector(".leaflet-tile-pane");
  const cs = getComputedStyle(container);
  const csVar = container.style.getPropertyValue("--color-layer-bg");
  // Any foliplus-owned pane that carries the color? Today: none — the only
  // foliplus class on a pane is the tile-hidden modifier on tilePane.
  const foliplusPanes = Array.from(document.querySelectorAll(".leaflet-pane"))
    .filter(p => /foliplus/.test(p.className))
    .map(p => p.className);
  return {
    itemFound: true,
    containerActive: container.classList.contains("active"),
    cssVar: csVar.trim(),
    containerBg: cs.backgroundColor,
    tileHidden: tilePane.classList.contains("foliplus-layer-tile-hidden"),
    tileVisibility: getComputedStyle(tilePane).visibility,
    foliplusPanes,
  };
};
