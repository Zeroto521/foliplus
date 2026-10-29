() => {
  const mm = window.__measureManager;
  const map = window.__map;
  const click = p => map.fire("click", { latlng: L.latLng(p[0], p[1]) });
  mm.setMode("polygon");
  click([26.03, 119.3]);
  click([26.04, 119.31]);
  click([26.02, 119.32]);
  map.fire("contextmenu", { latlng: L.latLng(26.02, 119.32) });
  mm.setMode("marker");
  click([26.01, 119.3]);
  mm.setMode(null);
  return mm.measurements.map(m => m.type);
};
