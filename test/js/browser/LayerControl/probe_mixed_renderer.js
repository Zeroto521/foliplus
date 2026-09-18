// R1 probe (§10.3 #10): mixed renderer — one layer with an SVG data pane
// and a canvas label pane. Verifies pane-level opacity/hide reaches both
// renderers consistently, and that pointer-events:none on the canvas
// label pane keeps the SVG data clickable underneath.
//
// Build shape: createLayers with two panes (data + label), add a polygon
// leaf to the data pane (LayerFactory.addLayer pins a Path leaf to the
// pane's renderer via ensureVector), and hand-draw on a canvas appended
// to the label pane (the AnnotationManager shape).
//
// Note: passing a GeoJSON *group* to addLayer does NOT pin its child paths
// to the declared pane — LayerFactory.addLayer only sets options.pane on
// the top-level layer. A Path leaf pins correctly. (Recorded for R3/R6.)
() => {
  const api = window.map.foliplus.LayerAPI;
  const mg = api.createLayers({
    id: "__probe_mixed__",
    name: "Mixed",
    panes: [
      { name: "__probe_mixed_data__" },
      { name: "__probe_mixed_label__", isLabel: true },
    ],
  });
  const poly = L.polygon([
    [119.26, 26.04],
    [119.34, 26.04],
    [119.34, 26.12],
    [119.26, 26.12],
  ]);
  mg.addLayer(poly, "__probe_mixed_data__");
  const labelPane = window.map.getPane("__probe_mixed_label__");
  const canvas = document.createElement("canvas");
  canvas.width = 200;
  canvas.height = 200;
  canvas.style.width = "200px";
  canvas.style.height = "200px";
  canvas.style.position = "absolute";
  canvas.className = "probe-label-canvas";
  labelPane.appendChild(canvas);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "rgba(255,0,0,1)";
  ctx.fillRect(0, 0, 100, 100);
  window.__layerCtrl.m.enforceOrder();

  const paneNameOf = el => {
    let n = el;
    while (n && !(n.classList && n.classList.contains("leaflet-pane"))) {
      n = n.parentElement;
    }
    if (!n) return null;
    for (const [name, paneEl] of Object.entries(window.map._panes)) {
      if (paneEl === n) return name;
    }
    return null;
  };
  const eff = el => {
    let v = 1;
    let n = el;
    while (n && n !== document.documentElement) {
      v *= parseFloat(getComputedStyle(n).opacity || "1");
      n = n.parentElement;
    }
    return v;
  };
  const pathEl = poly.getElement();
  const dataPane = window.map.getPane("__probe_mixed_data__");
  const labelPaneEl = window.map.getPane("__probe_mixed_label__");

  // Pane-level opacity hits both renderers.
  dataPane.style.opacity = "0.4";
  labelPaneEl.style.opacity = "0.4";
  const pathEff = eff(pathEl);
  const canvasEff = eff(canvas);
  dataPane.style.opacity = "";
  labelPaneEl.style.opacity = "";

  // Hide the label pane → canvas not hit at the path's center.
  labelPaneEl.style.display = "none";
  const rect = pathEl.getBoundingClientRect();
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  const hitHidden = document.elementFromPoint(cx, cy);
  labelPaneEl.style.display = "";

  // pointer-events:none on the label pane → canvas transparent to hits,
  // so a click at the path's center reaches the path (or pane), not canvas.
  labelPaneEl.style.pointerEvents = "none";
  const hitNoPointer = document.elementFromPoint(cx, cy);
  labelPaneEl.style.pointerEvents = "";

  return {
    pathPane: paneNameOf(pathEl),
    labelCanvasPane: paneNameOf(canvas),
    pathEff: +pathEff.toFixed(3),
    canvasEff: +canvasEff.toFixed(3),
    hitHiddenIsCanvas: hitHidden === canvas,
    hitHiddenTag: hitHidden ? hitHidden.tagName : null,
    hitNoPointerIsCanvas: hitNoPointer === canvas,
  };
};
