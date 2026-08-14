() => {
  const mm = window.__measureManager;
  const p1 = L.polyline([
    [26.08, 119.3],
    [26.09, 119.31],
  ]);
  const p2 = L.circleMarker([26.08, 119.3]);
  mm.layers.mainLayer.addLayer(p1);
  mm.layers.mainLayer.addLayer(p2);
  mm.layers.mainLayer.removeLayer(p1);
  window.__test = mm.layers.registered();
};
