() => {
  // Places only the circle center (1st click). The radius follows the cursor
  // but is never confirmed by a second click. Assumes circle mode is already
  // active (test clicks the circle tool button first).
  const map = window.__map;
  map.fire("click", { latlng: L.latLng(26.08, 119.3) });
  // Move the mouse so the radius preview tracks it, but the confirming second
  // click never arrives — ESC at this point must cancel, not finalize.
  map.fire("mousemove", { latlng: L.latLng(26.09, 119.31) });
};
