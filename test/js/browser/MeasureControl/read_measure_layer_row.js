() => {
  // The measure layer's own row in the LayerControl panel: the row is the
  // registry entry the control registers, so the row's presence is what a
  // user sees when the layer drops off the registry.
  const api = window.__map.foliplus.LayerAPI;
  const li = api.layers.find(l => l.id.startsWith("foliplus_measure"));
  if (!li) return { id: null, registered: false, row: false };
  const row = document.querySelector(`.foliplus-layer-item[data-layer-id="${li.id}"]`);
  return { id: li.id, registered: true, row: !!row };
};
