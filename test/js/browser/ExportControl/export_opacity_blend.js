() => {
  // Create a marker layer with an explicit pane and set its opacity to 0.4.
  const api = window.map.foliplus && window.map.foliplus.LayerAPI;
  if (!api) return null;

  // Hide tile layers so the export canvas has only the marker — without this
  // the opaque tile pixels would mask the marker's alpha in the final image.
  for (const li of [...api.layers]) {
    if (li.layer instanceof L.TileLayer) li.visible = false;
  }

  const id = "__export_opacity_marker__";
  const paneName = "__export_opacity_pane__";
  const g = api.createLayers({
    id,
    name: "Opacity Marker",
    panes: [{ name: paneName }],
  });
  const marker = L.marker([26.08, 119.3]);
  g.mainLayer.addLayer(marker);
  g.register();

  // Read the real pane name from the registry.
  const info = api.layers.find(l => l.id === id);
  if (!info || !info.paneName) throw new Error("Layer not registered");
  const pane = window.map.getPane(info.paneName);
  if (!pane) throw new Error("Pane not found: " + info.paneName);
  pane.style.opacity = "0.4";

  return { marker: true, paneName: info.paneName, paneOpacity: "0.4" };
};
