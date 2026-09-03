() => {
  const api = window.map.foliplus && window.map.foliplus.LayerAPI;
  if (!api) return null;
  const out = {};
  // Overlay data rows only — base layers and the virtual color basemap
  // are excluded by selector, matching read_overlay_item_displays.
  const items = document.querySelectorAll(
    '.foliplus-layer-item:not([data-layer-type="base"]):not(.foliplus-color-layer-item)',
  );
  for (const item of items) {
    const id = item.getAttribute("data-layer-id");
    if (!id) continue;
    const countCol = item.querySelector(".foliplus-layer-count");
    out[id] = {
      name: item.querySelector(".foliplus-layer-label")?.textContent.trim() ?? null,
      countText: countCol ? countCol.textContent.trim() : null,
      apiCount: api.getFeatureCount ? api.getFeatureCount(id) : null,
    };
  }
  return out;
};
