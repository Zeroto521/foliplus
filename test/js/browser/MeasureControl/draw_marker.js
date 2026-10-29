() => {
  const mm = window.__measureManager;
  const map = window.__map;
  const click = p => map.fire("click", { latlng: L.latLng(p[0], p[1]) });
  mm.setMode("marker");
  click([26.04, 119.3]);
  mm.setMode(null);
  return mm.measurements.map(m => m.type);
};
