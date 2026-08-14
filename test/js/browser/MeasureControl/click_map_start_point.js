() => {
  const map = window.__map;
  map.fire("click", { latlng: L.latLng(26.08, 119.3) });
};
