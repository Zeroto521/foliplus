// R1 probe (§10.3 #4): HeatMap canvas — where it lives, whether a pane
// carrier reaches it, and whether minOpacity is settable at runtime.
//
// leaflet-heat appends its canvas to overlayPane (the group default pane),
// not the fallback pane enforceOrder assigns, so a per-layer pane carrier
// does NOT reach it today. minOpacity is a drawing parameter baked into the
// canvas pixels; CSS opacity on an ancestor multiplies at compositing, so
// the two combine (minOpacity × cssOpacity).
() => {
  const spec = window.__probe;
  delete window.__probe;
  const map = window.map;
  const m = window.__layerCtrl.m;
  m.enforceOrder();
  const paneNameOf = el => {
    let n = el;
    while (n && !(n.classList && n.classList.contains("leaflet-pane"))) {
      n = n.parentElement;
    }
    if (!n) return null;
    for (const [name, paneEl] of Object.entries(map._panes)) {
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
  const canvas = document.querySelector("canvas.leaflet-heatmap-layer");
  if (!canvas) return { found: false };
  const paneName = paneNameOf(canvas);
  const paneEl = paneName ? map.getPane(paneName) : null;
  let reached = false;
  if (paneEl) {
    paneEl.style.opacity = "0.4";
    reached = Math.abs(eff(canvas) - 0.4) < 0.02;
    paneEl.style.opacity = "";
  }
  let setOptions = null;
  if (spec && spec.id) {
    const li = m.layers.find(l => l.id === spec.id);
    const heat = li ? m.findLayer(li) : null;
    if (heat) setOptions = typeof heat.setOptions;
  }
  return {
    found: true,
    pane: paneName,
    // overlayPane / markerPane / tilePane / ... are shared; a per-layer
    // fallback pane would be "foliplus-pane-<stamp>".
    shared: !(paneName && paneName.startsWith("foliplus-pane-")),
    reached,
    setOptions,
  };
};
