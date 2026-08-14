() => {
  const mm = window.__measureManager;
  const map = window.__map;
  mm.setMode("marker");
  map.fire("click", { latlng: L.latLng(26.08, 119.3) });
};
