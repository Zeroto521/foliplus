// R1 probe (§10.3 #3): MarkerCluster — the cluster icon vs the single
// marker. Individual marker icons are migrated into the layer's fallback
// pane by PaneManager.migrateLayers (eachLayer recursion reaches them),
// but the cluster icon itself (a .marker-cluster element, MarkerCluster
// is an L.Marker subclass) is NOT reached by that recursion and stays in
// markerPane (shared). "两处都要处理" is the design consequence.
() => {
  const map = window.map;
  const m = window.__layerCtrl.m;
  // Force clustering to initialize + render cluster icons. markercluster
  // initializes lazily on moveend/zoomend; the map must have a finite
  // maxZoom (a maxZoom-defining base tile provides one).
  map.setZoom(map.getZoom());
  map.fire("zoomend");
  map.fire("moveend");
  m.enforceOrder();
  const paneNameOf = el => {
    let n = el;
    while (n && !(n.classList && n.classList.contains("leaflet-pane"))) {
      n = n.parentElement;
    }
    if (!n) return null;
    for (const [name, paneEl] of Object.entries(map._panes)) {
      if (paneEl === n) return name;
    }
    return null;
  };
  const icons = Array.from(
    document.querySelectorAll(".marker-cluster, .leaflet-marker-cluster"),
  );
  // Individual (non-cluster) marker icons that belong to the cluster's
  // children live in the layer's fallback pane; the cluster icon does not.
  return {
    iconCount: icons.length,
    iconPanes: icons.map(el => paneNameOf(el)),
  };
};
