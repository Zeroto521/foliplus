() => {
  // Create a marker layer and set its pane opacity to 0.4.
  const api = window.map.foliplus && window.map.foliplus.LayerAPI;
  if (!api) return null;

  const g = api.createLayers({
    id: "__export_opacity_marker__",
    name: "Opacity Marker",
  });
  const marker = L.marker([26.08, 119.3]);
  g.mainLayer.addLayer(marker);

  // Set the pane opacity to 0.4.
  const pane = window.map.getPane("__export_opacity_marker__");
  if (!pane) return { marker: false, paneOpacity: null };
  pane.style.opacity = "0.4";

  return { marker: true, paneOpacity: "0.4" };
};
