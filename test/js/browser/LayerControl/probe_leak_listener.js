// Control group: deliberately leak ONE bare map listener (no cleanup) and
// verify the sumMapEvents() measure can detect it. If a real leak of this
// magnitude doesn't move the number, then the drift assertion in
// destroy_readd.js has no teeth.
//
// `map._events` is a private Leaflet field — same idiom #392's MockMap unit
// gate used. Static guards only scan production code (foliplus/js/**);
// probes/tests may read private fields.
//
// The bare `map.on(...)` here has no teardown owner — that's the point.
// Real controls register through BaseControl.onMap() (or their own
// teardown) which is what the drift assertion guards.
() => {
  const map = window.map;
  if (!map) throw new Error("map not exposed");
  const sumMapEvents = () => {
    const evs = map._events || {};
    let total = 0;
    for (const key in evs) {
      const h = evs[key];
      total += Array.isArray(h) ? h.length : 0;
    }
    return total;
  };
  const before = sumMapEvents();
  // Deliberate leak: register a Leaflet listener on the map with no cleanup
  // owner. The probe name is namespaced so this doesn't collide with real
  // map events.
  map.on("__probe_leak_layer__", () => {});
  const after = sumMapEvents();
  return { before, after, delta: after - before };
};
