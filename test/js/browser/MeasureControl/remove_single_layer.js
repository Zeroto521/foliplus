fixtures => {
  const mm = window.__measureManager;
  const p1 = L.polyline(fixtures.line);
  const p2 = L.circleMarker(fixtures.point);
  mm.layers.mainLayer.addLayer(p1);
  mm.layers.mainLayer.addLayer(p2);
  mm.layers.mainLayer.removeLayer(p1);
  window.__test = mm.layers.registered();
};
