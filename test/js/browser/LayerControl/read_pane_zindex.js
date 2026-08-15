() => {
  const api = window.map.foliplus && window.map.foliplus.LayerAPI;
  if (!api) return null;
  const z = sel => {
    const el = document.querySelector(sel);
    return el ? parseInt(getComputedStyle(el).zIndex, 10) || 0 : null;
  };
  // LayerControl manages data layers under foliplus-layer-* panes.
  const dataPanes = Array.from(document.querySelectorAll(".leaflet-pane"))
    .filter(p => p.className.includes("foliplus-layer"))
    .map(p => parseInt(getComputedStyle(p).zIndex, 10) || 0);
  const overlayPane = document.querySelector(".leaflet-overlay-pane");
  const markerPane = document.querySelector(".leaflet-marker-pane");
  return {
    overlayZ: overlayPane ? getComputedStyle(overlayPane).zIndex : null,
    markerZ: markerPane ? getComputedStyle(markerPane).zIndex : null,
    layerCount: api.layers.length,
    dataZ: dataPanes.length ? Math.max(...dataPanes) : null,
    markerZNum: markerPane ? z(".leaflet-marker-pane") : null,
    tooltipZ: z(".leaflet-tooltip-pane"),
    popupZ: z(".leaflet-popup-pane"),
  };
};
