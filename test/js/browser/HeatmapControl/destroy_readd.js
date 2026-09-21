// removeControl → addControl must restart the initial layer scan (initScan
// lives in buildDOM now) — AND leave no listener residue on the map.
// sumMapEvents sums the handler-array lengths inside `map._events`;
// round[0] is the baseline right after the initial addControl (which the
// harness already performed in page setup).
//
// `map._events` is a private Leaflet field — same idiom #392's MockMap unit
// gate used. Static guards only scan production code (foliplus/js/**);
// probes/tests may read private fields.
() => {
  const map = window.map;
  const ctrl = window.__heatmapCtrl;
  if (!map || !ctrl) throw new Error("map or __heatmapCtrl not exposed");
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
  const removed = [];
  const hasManager = [];
  for (let i = 0; i < 2; i++) {
    map.removeControl(ctrl);
    removed.push(document.querySelector(".foliplus-heatmap-ctrl") === null);
    map.addControl(ctrl);
    hasManager.push(!!ctrl.m);
    rounds.push(sumMapEvents());
  }
  const drift = rounds.slice(1).some(n => n > rounds[0]);
  if (drift) {
    throw new Error(
      `HeatmapControl: map._events listener sum grew across N=3 re-adds: ${rounds.join(" → ")}`,
    );
  }
  return {
    rounds,
    removed: removed.every(Boolean),
    hasManager: hasManager.every(Boolean),
  };
};
