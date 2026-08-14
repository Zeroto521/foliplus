() => {
  const map = window.__map;
  map.fire("click", { latlng: L.latLng(26.09, 119.31) });
};
