// Drift gate: two remove→add cycles must leave the document/window listener
// count where it started, as measured by _probe/doc_listener_probe.js. That
// probe must be installed as a page prelude, so its counts are absolute
// instead of deltas measured from partway through the page's life.
//
// Complements the `map._events` gate (probe_listener_residue.js), which only
// counts listeners on the Leaflet map instance — the layer
// FullscreenControl's orphan `map.on("unload")` lived on. This gate covers the
// other layer: listeners bound on document or window, where nothing was
// watching before.
//
// Invariants, both against the stable pre-cycle baseline `base`:
//   added[i]  == base    — a re-attach leaves exactly the original set, so a
//                          listener bound on any attach and never removed
//                          registers here
//   closed[i] == closed[0] — every removal tears the same things down, so
//                          nothing survives a removeControl
// FullscreenControl exercises the first invariant for real: it holds one
// document `fullscreenchange` listener per attach (HintManager, on the
// control's signal) and tears it down on remove. So `closed` is `base` minus
// that listener and `added` returns to `base` — a listener that outlived an
// attach would push `added` above `base` and is caught regardless of which
// cycle it landed in.
async () => {
  const map = window.map;
  const ctrl = window.__fullscreenCtrl;
  if (!window.__probeDocBase) {
    throw new Error(
      "_probe/doc_listener_probe not installed (pass it to make_browser_page " +
        "as prelude=)",
    );
  }
  if (!map || !ctrl) throw new Error("map or __fullscreenCtrl not exposed");
  const settle = () => new Promise(resolve => setTimeout(resolve, 0));
  const quiesce = async () => {
    await settle();
    await settle();
  };
  const base = await window.__probeDocBase();
  const closed = [];
  const added = [];
  for (let i = 0; i < 2; i++) {
    map.removeControl(ctrl);
    await quiesce();
    closed.push(window.__probeDocSum().total);
    map.addControl(ctrl);
    await quiesce();
    added.push(window.__probeDocSum().total);
  }
  const counts = window.__probeDocSum();
  return {
    base,
    closed,
    added,
    doc: counts.doc,
    win: counts.win,
  };
};
