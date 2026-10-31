() => {
  // How many reverse-geocode requests the hold prelude parked. The spinner
  // case asserts on this so a popup that never issued the request cannot
  // satisfy the pending-state assertions for the wrong reason.
  return window.__geoHold ? window.__geoHold.seen : 0;
};
