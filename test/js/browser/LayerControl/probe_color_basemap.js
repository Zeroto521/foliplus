// R8b probe (§10.3 #9): solid-color basemap DOM path after R8b.
//
// Under R8b the color basemap is coequal with tile basemaps. It still
// paints via the map container's CSS background (`.leaflet-container.active`
// reads `--color-layer-bg`), but it no longer suppresses the shared
// tilePane: the retired `foliplus-layer-tile-hidden` class and its
// visibility/opacity side effects are gone, so the tile pane stays visible
// underneath and the color simply paints on top (container background is
// drawn above the leaflet-pane stack). Tile basemaps, when registered,
// get their own synthesized `foliplus-pane-*` via LayerSurface; the color
// basemap itself has no Leaflet layer, so it contributes no pane of its
// own — the color "surface" is the container background.
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
  // Panes that carry a `foliplus-*` marker. Under R8b there is no
  // tile-hidden class anywhere; the only foliplus panes are the
  // synthesized `foliplus-pane-*` for registered TileLayers.
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
