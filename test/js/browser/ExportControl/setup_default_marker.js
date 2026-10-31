() => {
  // Export a marker that uses the DEFAULT Leaflet icon geometry (25x41,
  // anchor [12,41]) but a deterministic data-URI solid-red PNG as its source.
  //
  // The task premise: a bare `L.marker(...)` (Leaflet's Icon.Default, which
  // loads `marker-icon.png` from the Leaflet CDN path) has no pixel assertion
  // in the export tests, because the default icon URL is not in the CDN list
  // and the image load races the export. A data-URI icon sidesteps both: the
  // export path sees exactly the pixels the icon element's `src` points at.
  //
  // A bare `map.addLayer(marker)` is NOT exported - it is not in the LayerAPI
  // registry (only registered layers are) and the default `markerPane` is
  // excluded from pane discovery. So the marker is registered through the
  // LayerAPI into a foliplus pane, exactly like a folium Marker that
  // LayerControl collects at map build time.
  //
  // The map is centered at [26.08, 119.30] zoom 12 and the marker sits at
  // map center. Returns the export-canvas window to sample. Crop box is the
  // default centered box (25% padding): CSS (320,180)->(960,540), scaled 2x ->
  // export canvas 1280x720 with canvas (0,0) = CSS (320,180). The marker's
  // icon lands at canvas (616..665, 278..359), so an 80x100 window at
  // {x:600,y:270} covers it.

  const api = window.map.foliplus && window.map.foliplus.LayerAPI;
  if (!api) return { error: "no LayerAPI" };

  // Hide tile layers so the export shows the marker over the plain
  // background, not over opaque OSM tiles (which would mask the red icon).
  for (const li of [...api.layers]) {
    if (li.layer instanceof L.TileLayer) api.setVisible(li.id, false);
  }

  // A 16x16 solid-red PNG data URI (RGB 230,30,30).
  const redPng =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAFklEQVR4nGN4JidHEmIY1TCqYfhqAAD1FCIQPGaJtgAAAABJRU5ErkJggg==";

  // A marker with DEFAULT Leaflet icon geometry (the Icon.Default size and
  // anchor) but a deterministic red data-URI source.
  const id = "__export_default_marker__";
  const paneName = "__export_default_marker_pane__";
  const g = api.createLayers({
    id,
    name: "Default Marker",
    panes: [{ name: paneName }],
  });
  const marker = L.marker([26.08, 119.3], {
    icon: L.icon({
      iconUrl: redPng,
      iconSize: [25, 41],
      iconAnchor: [12, 41],
    }),
  });
  g.mainLayer.addLayer(marker);
  g.register();

  return {
    marker: true,
    paneName,
    window: { x: 600, y: 270, w: 80, h: 100 },
  };
};
