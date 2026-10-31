// Waits for the declared-zoom membership rule to hold: a layer named
// "Declared" is on the map exactly when the current zoom is inside the
// declared [8, 12] range. This is the observable the probe asserts; polling
// (rather than sleeping) is what makes the test deterministic. Passed to
// page.wait_for_function.
() => {
  const api = window.map.foliplus && window.map.foliplus.LayerAPI;
  const li = api && api.layers.find(l => l.name === "Declared");
  if (!li || !li.layer) return false;
  const z = window.map.getZoom();
  const inRange = z >= 8 && z <= 12;
  return window.map.hasLayer(li.layer) === inRange;
};
