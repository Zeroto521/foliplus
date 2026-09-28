// Drift gate: two remove→add cycles with the scheme dropdown OPEN must leave
// the document/window listener count where it started, as measured by
// _probe/doc_listener_probe.js, installed as a page prelude so its counts are
// absolute rather than deltas from partway through the page's life.
//
// This is the layer the `map._events` gate cannot see: HeatmapControl's
// outside-click handler for the scheme dropdown is bound on document
// (BaseControl.on → EventTarget.prototype.addEventListener with the control's
// signal), so a leak here is invisible to anything that only counts map
// listeners. #408 moved that binding from a bare document.addEventListener to
// the signal-managed form; this gate locks it in.
//
// Each cycle opens the dropdown before removing the control — the exact shape
// of the leak guarded: a listener still bound at removal time, whether bare
// with no cleanup owner or bound to a controller that is never aborted.
//
// Invariants, both against the stable pre-cycle baseline `base`:
//   added[i]  == base     — a re-attach leaves exactly the original set, so a
//                            listener bound on any attach and never removed
//                            registers here
//   closed[i] == closed[0] — every removal tears the same things down, so
//                            nothing survives a removeControl
//   open[i]  > closed[i]  — self-check: the dropdown really does bind a
//                            document listener, otherwise this gate would pass
//                            without measuring anything
async () => {
  const map = window.map;
  const ctrl = window.__heatmapCtrl;
  if (!window.__probeDocBase) {
    throw new Error(
      "_probe/doc_listener_probe not installed (pass it to make_browser_page " +
        "as prelude=)",
    );
  }
  if (!map || !ctrl) throw new Error("map or __heatmapCtrl not exposed");
  const settle = () => new Promise(resolve => setTimeout(resolve, 0));
  const quiesce = async () => {
    await settle();
    await settle();
  };
  const base = await window.__probeDocBase();
  const open = [];
  const closed = [];
  const added = [];
  for (let i = 0; i < 2; i++) {
    if (ctrl.schemeDropdown) {
      throw new Error(`scheme dropdown was already open before cycle ${i}`);
    }
    ctrl.toggleSchemeDropdown();
    open.push(window.__probeDocSum().total);
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
    open,
    closed,
    added,
    doc: counts.doc,
    win: counts.win,
  };
};
