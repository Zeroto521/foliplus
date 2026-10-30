() => {
  // Create a marker layer with an explicit pane and set its opacity to 0.4.
  const api = window.map.foliplus && window.map.foliplus.LayerAPI;
  if (!api) return null;

  // Simulate user hiding tile layers so the export canvas has only the
  // marker — without this the opaque tile pixels would mask the marker's
  // alpha in the final image. `setVisible` records the intent and drives
  // the map; directly writing `layer.visible` would no longer reach the
  // executor after #498 collapsed that mirror.
  for (const li of [...api.layers]) {
    if (li.layer instanceof L.TileLayer) api.setVisible(li.id, false);
  }

  const id = "__export_opacity_marker__";
  const paneName = "__export_opacity_pane__";
  const g = api.createLayers({
    id,
    name: "Opacity Marker",
    panes: [{ name: paneName }],
  });
  // Two reasons for a data-URI icon instead of the Leaflet default:
  // (1) Determinism: the default marker-icon.png is NOT in the offline CDN
  //     cache (test/python/cdn.json has no marker-icon entry), so a bare
  //     L.marker loads its icon over the network -- which the test route
  //     blocks -- and the icon load fails silently. Whether the marker
  //     paints at all becomes an icon-loading race, not a property of the
  //     code under test.
  // (2) Known color: the default icon is a blue pin (approx 46,133,203),
  //     not "red" as the old docstring claimed. A solid red 230,30,30 icon
  //     pins the blended color so the pixel assertion below is not coupled
  //     to Leaflet's exact default pin artwork or version drift.
  const icon = L.icon({
    iconUrl: "data:image/png;base64," +
      "iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAAFklEQVR4nGN8" +
      "Jif3nwEPYMInOXwUAAA19gIxetnLYAAAAABJRU5ErkJggg==",
    iconSize: [8, 8],
    iconAnchor: [4, 4],
  });
  const marker = L.marker([26.08, 119.3], { icon });
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
