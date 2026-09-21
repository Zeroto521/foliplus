// Drift gate: N=3 remove→add cycles must not grow map._events listener sum.
//
// sumMapEvents() sums the handler-array lengths inside `map._events`. That
// private Leaflet field is the actual "how many listeners are still attached
// to the map" measure — same idiom #392's MockMap-based unit gate used.
// Static guards only scan production code (foliplus/js/**); probes and tests
// may read private Leaflet fields.
//
// Baseline semantics: round[0] is captured right after the initial addControl
// (which the harness already performed in page setup). Rounds[1] and [2] are
// remove→add cycles; each must equal round[0]. If the sum drifts, the probe
// returns the drift so the Python caller can assert against it.
//
// Diagnostic note on the current failure mode: the drift lands on the FIRST
// re-add only, at the `unload` event type. Round[1] grows by +1 handler
// (`ctrl.remove` registered as a `map.on("unload", ...)` listener), round[2]
// stays flat. See .foliplus/probe_fns.py for the full fn-name diff.
() => {
  const map = window.map;
  const ctrl = window.__layerCtrl;
  if (!map || !ctrl) throw new Error("map or __layerCtrl not exposed");
  const sumMapEvents = () => {
    const evs = map._events || {};
    let total = 0;
    for (const key in evs) {
      const h = evs[key];
      total += Array.isArray(h) ? h.length : 0;
    }
    return total;
  };
  const rounds = [sumMapEvents()];
  for (let i = 0; i < 2; i++) {
    map.removeControl(ctrl);
    map.addControl(ctrl);
    rounds.push(sumMapEvents());
  }
  return { rounds };
};
