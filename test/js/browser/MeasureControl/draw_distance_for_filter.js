() => {
  const mm = window.__measureManager;
  const map = window.__map;
  const click = p => map.fire("click", { latlng: L.latLng(p[0], p[1]) });
  mm.setMode("distance");
  click([26.08, 119.3]);
  click([26.09, 119.31]);
  map.fire("contextmenu", { latlng: L.latLng(26.09, 119.31) });
  mm.setMode(null);
  return mm.measurements.map(m => m.type);
};
