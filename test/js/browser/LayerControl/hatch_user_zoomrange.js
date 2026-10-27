async () => {
  // Guard: a user-set zoom range (the style-panel slider's intent) pulls
  // the layer off the map when the current zoom falls outside it — so the
  // paint observation goes false and the hatch must show. This is the
  // "zoom outside every stored range" case that actually fires: unlike the
  // author's declared min/max (which the ordering pass folds into the
  // map's own maxZoom, so the map cannot zoom past them), a user range is
  // intent-only and independent of the map ceiling.
  const ctrl = window.__layerCtrl;
  if (!ctrl) return { error: "no __layerCtrl" };
  const map = ctrl.mgr.map;
  const ui = ctrl.mgr.ui;
  const api = map.foliplus.LayerAPI;
  const container = map.getContainer();
  const COLOR_ID = "foliplus_color_map";
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const hasHatch = () => container.classList.contains("foliplus-no-base-map");

  const bases = api.layers.filter(l => l.role === "base" && l.id !== COLOR_ID);
  if (bases.length !== 1) {
    return { error: `expected 1 real tile base, got ${bases.length}` };
  }
  const [a] = bases;
  const aLayer = api.findLayer(a.id);

  // Fixture opens at zoom_start=1 — no zoom round-trip needed.
  const before = { hatch: hasHatch(), onMap: aLayer ? map.hasLayer(aLayer) : null };

  ui.intentStore.setValue(a.id, "zoomRange", [5, 10]);
  ui.applyProjectionAll();
  await wait(80);

  const after = {
    hatch: hasHatch(),
    onMap: aLayer ? map.hasLayer(aLayer) : null,
  };
  return { before, after };
};
