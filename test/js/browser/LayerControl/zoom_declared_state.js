() => {
  // The two fixture layers at the map's current zoom.
  //
  // Visibility is read as map membership: the policy hides a layer by
  // removing it from the map (not by CSS), so `hasLayer` and the painted
  // leaf count are two independent views of the same fact.
  const ctrl = window.__layerCtrl;
  if (!ctrl) return { error: "no __layerCtrl" };
  const map = ctrl.mgr.map;
  const api = map.foliplus.LayerAPI;

  const layerOf = name => api.layers.find(li => li.name === name) ?? null;
  const onMap = li => (li && li.layer ? map.hasLayer(li.layer) : null);
  const declared = layerOf("Declared");
  const plain = layerOf("Plain");
  const row = declared
    ? document.querySelector(`[data-layer-id="${declared.id}"]`)
    : null;

  return {
    zoom: map.getZoom(),
    declaredId: declared ? declared.id : null,
    declaredOnMap: onMap(declared),
    plainOnMap: onMap(plain),
    // One <path> per polygon leaf; a hidden layer's leaves leave the pane.
    painted: document.querySelectorAll(".leaflet-map-pane path").length,
    // The box keeps the user's choice while the policy hides the layer.
    declaredChecked: row
      ? (row.querySelector('input[type="checkbox"]')?.checked ?? null)
      : null,
  };
};
