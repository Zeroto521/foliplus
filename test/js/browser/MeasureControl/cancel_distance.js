() => {
  const map = window.__map;
  map.fire("contextmenu", { latlng: L.latLng(26.08, 119.3) });
};
