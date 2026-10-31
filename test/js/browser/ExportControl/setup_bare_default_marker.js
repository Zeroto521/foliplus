() => {
  // A bare L.marker(...) with NO icon option: Leaflet's Icon.Default.
  //
  // Unlike setup_default_marker.js (which substitutes a deterministic
  // red data-URI for the icon source), this keeps the TRUE default icon
  // geometry AND source (marker-icon.png, 25x41, anchor [12,41]), so the
  // pixel assertion covers the actual default Leaflet marker artwork.
  // For that to work the default icon URL must be in test/python/cdn.json
  // (added by #836) and the CDN route must answer it WITH an
  // Access-Control-Allow-Origin header (test/python/conftest.py), because
  // the export renderer re-reads the icon pixels via loadImage(src,
  // "anonymous") and a cross-origin anonymous image without CORS fails.
  //
  // A bare map.addLayer(marker) is NOT exported - it is not in the
  // LayerAPI registry (only registered layers are) and the default
  // markerPane is excluded from pane discovery. So the marker is
  // registered through the LayerAPI into a foliplus pane, exactly like a
  // folium Marker that LayerControl collects at map build time.
  //
  // The map is centered at [26.08, 119.30] zoom 12 and the marker sits at
  // map center. Returns the export-canvas window to sample. Crop box is the
  // default centered box (25% padding): CSS (320,180)->(960,540), scaled 2x
  // -> export canvas 1280x720 with canvas (0,0) = CSS (320,180). The marker's
  // icon lands at canvas (616..665, 278..359), so an 80x100 window at
  // {x:600,y:270} covers it.

  const api = window.map.foliplus && window.map.foliplus.LayerAPI;
  if (!api) return { error: "no LayerAPI" };

  // Hide tile layers so the export shows the marker over the plain
  // background, not over opaque OSM tiles (which would mask the blue icon).
  for (const li of [...api.layers]) {
    if (li.layer instanceof L.TileLayer) api.setVisible(li.id, false);
  }

  const id = "__export_bare_default_marker__";
  const paneName = "__export_bare_default_marker_pane__";
  const g = api.createLayers({
    id,
    name: "Bare Default Marker",
    panes: [{ name: paneName }],
  });
  const marker = L.marker([26.08, 119.3]); // NO icon option -> Icon.Default
  g.mainLayer.addLayer(marker);
  g.register();

  return {
    marker: true,
    paneName,
    window: { x: 600, y: 270, w: 80, h: 100 },
  };
};
