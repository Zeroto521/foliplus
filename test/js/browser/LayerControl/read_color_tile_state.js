() => {
  // After the pane fix, the color basemap paints via its own pane + canvas,
  // not via a CSS background on the map container. The "active" class is on
  // the color row, not the container.
  const colorRow = document.querySelector(".foliplus-color-layer-item");
  const hasColorActive = colorRow && colorRow.classList.contains("active");
  const tilePane = document.querySelector(".leaflet-tile-pane");
  const hasTileHidden =
    tilePane && tilePane.classList.contains("foliplus-layer-tile-hidden");
  const tileLayers = document.querySelectorAll(".leaflet-tile-loaded");
  // Color pane exists and is visible (its face canvas is not hidden).
  const colorPane = Array.from(document.querySelectorAll(".leaflet-pane")).find(p =>
    p.className.includes("foliplus-color-"),
  );
  const colorFace = colorPane
    ? colorPane.querySelector(".foliplus-canvas-layer")
    : null;
  const colorVisible = colorFace && !colorFace.classList.contains("hidden");
  return {
    tileHidden: hasTileHidden,
    colorBg: hasColorActive,
    tileCount: tileLayers.length,
    colorPaneFound: !!colorPane,
    colorVisible,
  };
};
