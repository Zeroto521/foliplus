// Read-only pane snapshot for the reload-persistence assertion: after a reload,
// read every pane's path fill/stroke WITHOUT touching any write path, so the
// assertion proves the persisted style was re-applied by the attach sweep,
// not by us re-driving the panel. Reuses the pane-grouping of
// fill_two_layer_isolation.js so a reload test can diff pane->fill before/after.
() => {
  const ctrl = window.__layerCtrl;
  const map = ctrl && ctrl.mgr && ctrl.mgr.map;
  if (!map) return { error: "no-map" };
  if (ctrl.mgr.enforceOrder) ctrl.mgr.enforceOrder();
  const groups = {};
  document.querySelectorAll(".leaflet-pane svg path").forEach(p => {
    const pane = p.closest(".leaflet-pane");
    if (!pane) return;
    const cls = pane.className;
    const key = (groups[cls] = groups[cls] || { cls, fills: [], strokes: [] });
    key.fills.push(p.getAttribute("fill"));
    key.strokes.push(p.getAttribute("stroke"));
  });
  return { ok: true, panes: Object.values(groups) };
};
