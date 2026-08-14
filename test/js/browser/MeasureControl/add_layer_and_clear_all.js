() => {
  const mm = window.__measureManager;
  mm.layers.addLayer(L.circleMarker([26.08, 119.3]));
  mm.measurements = [{ id: "test", type: "marker", lng: 119.3, lat: 26.08 }];
  mm.clearAll();
};
