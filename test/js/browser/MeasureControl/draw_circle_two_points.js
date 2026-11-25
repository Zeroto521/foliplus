() => {
  // Places the circle center and the confirming radius click (2 clicks), so
  // the circle finalizes via its own setTimeout path. Assumes circle mode is
  // already active (test clicks the circle tool button first) and the layer
  // panel is open.
  const map = window.__map;
  map.fire("click", { latlng: L.latLng(26.08, 119.3) });
  map.fire("click", { latlng: L.latLng(26.09, 119.31) });
};
