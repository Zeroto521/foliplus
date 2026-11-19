// Real reload-filter e2e: pre-reload step.
// Finds the real "District Landmarks" marker layer, sets an enum filter on
// NAME_3 (keep only "A") through the real write path (setLayerFilter), and
// reads every marker's computed display BEFORE and AFTER the filter.
// The filter is persisted to localStorage by filterStore, so a REAL
// page.reload() must restore it and re-apply the hidden class.
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

  const before = leaves.map(leaf => readDisplay(leaf));

  // Real write path: setLayerFilter commits to the store (persists + applies).
  const filter = { kind: "enum", field: "NAME_3", values: ["A"] };
  mgr.setLayerFilter(id, filter);
  const afterFilter = leaves.map(leaf => readDisplay(leaf));

  const filterState = mgr.filterStore.getFilter(id, "generic");
  const persisted = localStorage.getItem("foliplus_filter_store");

  return {
    id,
    name: info.name,
    total: leaves.length,
    before,
    afterFilter,
    filterState: filterState ? JSON.stringify(filterState) : null,
    persisted,
    hasVisibleDomOf: Boolean(visibleDomOf),
  };
};
