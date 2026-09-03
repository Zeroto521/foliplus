() => {
  const api = window.map.foliplus && window.map.foliplus.LayerAPI;
  if (!api) return null;
  const out = {};
  for (const item of document.querySelectorAll(".foliplus-layer-item")) {
    const id = item.getAttribute("data-layer-id");
    if (!id) continue;
    const li = api.layers.find(l => l.id === id);
    // Base tile layers have no feature count (null) and no count column —
    // only report data-bearing layers so callers get clean results.
    if (!li || li.isBase) continue;
    const countCol = item.querySelector(".foliplus-layer-count");
    out[id] = {
      name: li.name,
      countText: countCol ? countCol.textContent.trim() : null,
      apiCount: api.getFeatureCount ? api.getFeatureCount(id) : null,
    };
  }
  return out;
};
