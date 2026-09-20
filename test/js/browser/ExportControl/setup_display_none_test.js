() => {
  // Set up carriers for the display:none reverse gate:
  // (1) a BLUE GeoJson polygon in a foliplus layer pane (SVG vector),
  // (2) a red marker (div-icon),
  // (3) a red heatmap canvas in a foliplus layer pane.
  //
  // The polygon is blue so its pixels can be distinguished from the red
  // background — the test asserts that hiding it with display:none removes
  // its blue pixels from the export, not the background red.
  //
  // Returns the same window layout as focus_three_carriers.js.

  const api = window.map.foliplus && window.map.foliplus.LayerAPI;
  if (!api) return { error: "no LayerAPI" };

  // --- Carrier 1: blue GeoJson polygon (SVG vector in a foliplus pane) ---
  const poly = new L.Polygon(
    [
      [26.085, 104.295],
      [26.085, 104.305],
      [26.075, 104.305],
      [26.075, 104.295],
    ],
    { color: "rgb(0,0,230)", fillColor: "rgb(0,0,230)", fillOpacity: 0.8, weight: 2 },
  );
  const vectorGroup = api.createLayers({
    id: "__displaynone_vector__",
    name: "DisplayNone Vector",
    panes: [{ name: "vector-pane-dn" }],
  });
  vectorGroup.mainLayer.addLayer(poly);
  vectorGroup.register();

  // --- Carrier 2: red marker (div-icon) ---
  const marker = L.marker([26.08, 119.30], {
    icon: L.divIcon({
      className: "",
      html: '<div style="width:20px;height:20px;background:rgb(230,30,30);border-radius:50%"></div>',
      iconSize: [20, 20],
    }),
  });
  window.map.addLayer(marker);

  // --- Carrier 3: red heatmap canvas (foliplus pane) ---
  const cvs = api.createCanvas({
    id: "__displaynone_canvas__",
    name: "DisplayNone Canvas",
  });
  cvs.register();
  const ctx = cvs.ctx;
  const cx = 0.4 * cvs.canvas.width;
  const cy = 0.4 * cvs.canvas.height;
  const sz = 0.2 * cvs.canvas.width;
  ctx.fillStyle = "rgb(230,30,30)";
  ctx.fillRect(cx, cy, sz, sz);

  // --- Focus on the canvas layer so the vector pane gets hidden ---
  const layerCtrl = window.__layerCtrl;
  if (layerCtrl && layerCtrl.m && layerCtrl.m.ui) {
    layerCtrl.m.ui.focusLayer("__displaynone_canvas__");
  }

  // --- Window rectangles (same layout as focus_three_carriers.js) ---
  return {
    focusLayer: "__displaynone_canvas__",
    windows: {
      vector: { x: 408, y: 320, w: 80, h: 80 },
      marker: { x: 600, y: 320, w: 80, h: 80 },
      canvas: { x: 792, y: 320, w: 80, h: 80 },
    },
  };
}
