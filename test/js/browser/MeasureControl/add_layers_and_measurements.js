fixtures => {
  const mm = window.__measureManager;
  mm.layers.addLayer(L.circleMarker(fixtures.point));
  mm.layers.addLayer(L.polyline(fixtures.line));
  mm.store.hydrate([{ id: "test", type: "marker", lng: 119.3, lat: 26.08 }]);
  mm.store.persist();
};
