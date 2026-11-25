() => {
  // Assumes distance mode is already active (test calls click_distance_button
  // first). Only places two points — no contextmenu / double-click to
  // finalize. Escape should commit the measurement (finishOnExit → true).
  const map = window.__map;
  map.fire("click", { latlng: L.latLng(26.08, 119.3) });
  map.fire("click", { latlng: L.latLng(26.09, 119.31) });
  // Two points placed — geometry is complete but the mode is still in-flight
  // (no contextmenu / double-click to finalize). Escape should commit it.
};
