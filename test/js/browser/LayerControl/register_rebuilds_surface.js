// R3 probe: I2 — the pane *set* is fixed once a surface is materialized, and a
// re-registration of the same container rebuilds that surface correctly.
//
// Re-registration is how the API says "this layer changed", so it must not leave
// two surfaces (or two pane sets) behind: the content that arrived in between —
// pinned at the source by the surface's group wrapper — has to end up in the
// same pane as the content that was there from the start.
() => {
  const api = window.map.foliplus && window.map.foliplus.LayerAPI;
  if (!api) return null;
  const first = L.marker([26.08, 119.3]);
  const group = L.featureGroup([first]);
  api.registerLayer({ id: "__rebuild__", name: "Rebuild", layer: group });
  const before = api.getLayerPanes(group).slice();

  const second = L.marker([26.09, 119.31]);
  group.addLayer(second);
  api.registerLayer({ id: "__rebuild__", name: "Rebuild", layer: group });

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
  return {
    before,
    after: api.getLayerPanes(group),
    firstMarkerPane: first._icon ? paneNameOf(first._icon) : null,
    secondMarkerPane: second._icon ? paneNameOf(second._icon) : null,
    rowCount: window.map.foliplus.LayerAPI.layers.filter(l => l.id === "__rebuild__")
      .length,
  };
};
