// R3 probe: I1 — `registerLayer` materializes the layer's rendering face
// *before* it joins the map, so the content is already in the pane it belongs
// to when `registerLayer` returns.
//
// Deliberately no `enforceOrder()` in here. Every other pane probe has to call
// it first, because the ordering pass used to be the only moment a pane was
// decided; this one asserts that the decision now precedes the map add, which
// is the whole promise of the step. Read the DOM (and the public
// `getLayerPanes`), not the manager's private records.
() => {
  const api = window.map.foliplus && window.map.foliplus.LayerAPI;
  if (!api) return null;
  const marker = L.marker([26.08, 119.3]);
  const poly = L.polyline([
    [26.05, 119.25],
    [26.09, 119.25],
  ]);
  const fg = L.featureGroup([marker, poly]);
  api.registerLayer({ id: "__immediate_pane__", name: "Immediate", layer: fg });

  const paneNameOf = el => {
    let n = el;
    while (n && !(n.classList && n.classList.contains("leaflet-pane"))) {
      n = n.parentElement;
    }
    if (!n) return null;
    for (const [name, paneEl] of Object.entries(window.map._panes)) {
      if (paneEl === n) return name;
    }
    return null;
  };
  const declared = api.getLayerPanes(fg);
  return {
    declared,
    iconPane: marker._icon ? paneNameOf(marker._icon) : null,
    pathPane: poly._path ? paneNameOf(poly._path) : null,
    // Anything that is not a synthesized pane is a pane shared with other
    // layers, which is exactly what I1 is supposed to rule out here.
    shared: [marker._icon, poly._path].some(el => {
      const name = el ? paneNameOf(el) : null;
      return !name || !name.startsWith("foliplus-pane-");
    }),
    leafPaneSet: marker.options.paneSet === true && poly.options.paneSet === true,
  };
};
