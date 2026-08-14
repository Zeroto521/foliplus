() => {
  const api = window.foliplus && window.foliplus.LayerAPI;
  if (!api) return null;
  const overlayPane = document.querySelector(".leaflet-overlay-pane");
  const markerPane = document.querySelector(".leaflet-marker-pane");
  const overlayZ = overlayPane ? getComputedStyle(overlayPane).zIndex : null;
  const markerZ = markerPane ? getComputedStyle(markerPane).zIndex : null;
  return {
    overlayZ: overlayZ,
    markerZ: markerZ,
    layerCount: api.layers.length,
  };
};
