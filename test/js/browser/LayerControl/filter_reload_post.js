// Real reload-filter e2e: post-reload step (read-only).
// After page.reload(), the filter condition must be kept (filterStore restored
// from localStorage) AND the map must still show only the filtered subset.
// Reads the marker displays and the committed filter without any write.
() => {
  const ctrl = window.__layerCtrl;
  if (!ctrl) return null;
  const mgr = ctrl.mgr;
  const api = window.map && window.map.foliplus && window.map.foliplus.LayerAPI;
  if (!api || !mgr.ui || !mgr.ui.runtimeStore) return null;
  const layerCore =
    window.foliplus && window.foliplus.core && window.foliplus.core.layer;
  const visibleDomOf =
    layerCore && layerCore.visibleDomOf ? layerCore.visibleDomOf : null;

  const info = api.layers.find(l => l.name === "District Landmarks");
  if (!info)
    return {
      error: "no-district-landmarks-layer",
      layers: api.layers.map(l => ({ id: l.id, name: l.name })),
    };
  const id = info.id;
  const layer = info.layer;
  if (!layer) return { error: "no-layer", id };

  const leaves = [];
  const walk = node => {
    if (typeof node.eachLayer === "function") node.eachLayer(c => walk(c));
    else leaves.push(node);
  };
  walk(layer);
  const readDisplay = leaf => {
    const elems = visibleDomOf
      ? visibleDomOf(leaf)
      : leaf.getElement
        ? [leaf.getElement()]
        : [];
    return elems.map(e => (e ? getComputedStyle(e).display : null));
  };
  const displays = leaves.map(leaf => readDisplay(leaf));
  const filterState = mgr.filterStore.getFilter(id, "generic");

  // The filter row's funnel presence (the panel condition kept).
  const row = document.querySelector(
    '.foliplus-layer-item[data-layer-id="' + id + '"]',
  );
  const funnel = row ? row.querySelector(".foliplus-layer-count-funnel") : null;

  return {
    id,
    name: info.name,
    total: leaves.length,
    displays,
    filterState: filterState ? JSON.stringify(filterState) : null,
    funnelPresent: Boolean(funnel),
    hasVisibleDomOf: Boolean(visibleDomOf),
  };
};
