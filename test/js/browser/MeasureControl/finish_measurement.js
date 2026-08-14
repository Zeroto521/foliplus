() => {
  const map = window.__map;
  map.fire("contextmenu", { latlng: L.latLng(26.09, 119.31) });
};
