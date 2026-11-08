fixtures => {
  const mm = window.__measureManager;
  mm.layers.addLayer(L.polyline(fixtures.line));
  mm.layers.addLayer(L.circleMarker(fixtures.point));
};
