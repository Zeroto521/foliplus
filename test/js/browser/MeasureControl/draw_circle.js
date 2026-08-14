() => {
  const mm = window.__measureManager;
  const map = window.__map;
  mm.setMode("circle");
  map.fire("click", { latlng: L.latLng(26.08, 119.3) });
  map.fire("click", { latlng: L.latLng(26.09, 119.31) });
};
