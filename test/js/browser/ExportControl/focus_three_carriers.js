() => {
  // Set up three non-overlapping carriers for the focus-state survival gate:
  // (1) a red GeoJson polygon in a foliplus layer pane (SVG vector),
  // (2) a marker (div-icon, NOT in a foliplus pane),
  // (3) a heatmap canvas with a red fill in a foliplus layer pane.
  //
  // The map is centred at [26.08, 119.30] zoom 12. At this zoom, ~1 degree
  // of longitude ≈ 10 px, so the three carriers are spread ~15 degrees apart
  // to land at ~30%, ~50%, ~70% of the viewport width.
  //
  // Returns the layer id to focus (the canvas), so the GeoJson pane gets
  // hidden by focus CSS. Before B1, the vectors disappear (visibility
  // inherits); after B1, they survive.
  //
  // Also returns the three window rectangles (in export-canvas pixel coords)
  // for sampling. The export canvas is 1280x720 at scale=2, so CSS pixels
  // map to canvas pixels at 2x. The crop box starts at CSS (320,240) and
  // spans 640x360 CSS px, so canvas pixel (0,0) = CSS (320,240).
  //
  // Window centres in CSS: x = 320 + f*640, y = 240 + 0.5*360
  // Canvas coords (×2):   x = 2*(320 + f*640), y = 2*(240 + 0.5*360)
  // Window size: 80 canvas px (40 CSS px)

  const api = window.map.foliplus && window.map.foliplus.LayerAPI;
  if (!api) return { error: "no LayerAPI" };

  // --- Carrier 1: red GeoJson polygon (SVG vector in a foliplus pane) ---
  // Centre at [26.08, 104.30] (~15 degrees west of map centre).
  const poly = new L.Polygon(
    [
      [26.085, 104.295],
      [26.085, 104.305],
      [26.075, 104.305],
      [26.075, 104.295],
    ],
    { color: "red", fillColor: "rgb(230,30,30)", fillOpacity: 0.8, weight: 2 },
  );
  const vectorGroup = api.createLayers({
    id: "__focus_vector__",
    name: "Focus Vector",
    panes: [{ name: "vector-pane" }],
  });
  vectorGroup.mainLayer.addLayer(poly);
  vectorGroup.register();

  // --- Carrier 2: marker (div-icon, NOT in a foliplus pane) ---
  // Centre at [26.08, 119.30] (map centre).
  const marker = L.marker([26.08, 119.30], {
    icon: L.divIcon({
      className: "",
      html: '<div style="width:20px;height:20px;background:rgb(230,30,30);border-radius:50%"></div>',
      iconSize: [20, 20],
    }),
  });
  window.map.addLayer(marker);

  // --- Carrier 3: heatmap canvas with red fill (foliplus pane) ---
  // Centre at [26.08, 134.30] (~15 degrees east of map centre).
  const cvs = api.createCanvas({
    id: "__focus_canvas__",
    name: "Focus Canvas",
  });
  cvs.register();
  // Draw a red rectangle at the centre of the canvas.
  const ctx = cvs.ctx;
  const cx = 0.4 * cvs.canvas.width;
  const cy = 0.4 * cvs.canvas.height;
  const sz = 0.2 * cvs.canvas.width;
  ctx.fillStyle = "rgb(230,30,30)";
  ctx.fillRect(cx, cy, sz, sz);

  // --- Focus on the canvas layer so the vector pane gets hidden ---
  const layerCtrl = window.__layerCtrl;
  if (layerCtrl && layerCtrl.m && layerCtrl.m.ui) {
    layerCtrl.m.ui.focusLayer("__focus_canvas__");
  }

  // --- Compute window rectangles in export-canvas pixel coords ---
  // Export canvas: 1280x720. Crop box: CSS (320,240) to (960,600).
  // Canvas pixel (0,0) = CSS (320,240). Scale factor: 2.
  // Window centres: CSS x = 320 + f*640, y = 240 + 0.5*360 = 420
  // Canvas: x = 2*(320 + f*640), y = 2*(420-240) = 360
  // Window size: 80x80 canvas px.

  return {
    focusLayer: "__focus_canvas__",
    windows: {
      vector: { x: 408, y: 320, w: 80, h: 80 },
      marker: { x: 600, y: 320, w: 80, h: 80 },
      canvas: { x: 792, y: 320, w: 80, h: 80 },
    },
  };
}
