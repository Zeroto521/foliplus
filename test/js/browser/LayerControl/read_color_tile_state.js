() => {
  const tilePane = document.querySelector(".leaflet-tile-pane");
  const hasTileHidden =
    tilePane && tilePane.classList.contains("foliplus-layer-tile-hidden");
  const mapContainer = document.querySelector(".leaflet-container");
  const hasColorBg = mapContainer && mapContainer.classList.contains("active");
  const tileLayers = document.querySelectorAll(".leaflet-tile-loaded");
  return {
    tileHidden: hasTileHidden,
    colorBg: hasColorBg,
    tileCount: tileLayers.length,
  };
};
