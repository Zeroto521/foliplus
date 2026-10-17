async () => {
  // Guard: zooming outside every basemap's *stored user range* must turn
  // the hatch on, and zooming back inside one must turn it off. The
  // trigger is the zoom-end sweep inside `applyProjectionAll`, which now
  // reconciles the hatch from the paint observation.
  //
  // The author's declared min/max is deliberately NOT used here: the
  // ordering pass folds layer maxZoom into the map's own maxZoom, so the
  // map cannot zoom past them (setZoom clamps, and the top layer always
  // paints at the ceiling). A user-set range is intent-only — independent
  // of the map ceiling — so it is the case where "zoom outside every
  // range" is reachable.
  const ctrl = window.__layerCtrl;
  if (!ctrl) return { error: "no __layerCtrl" };
  const map = ctrl.mgr.map;
  const ui = ctrl.mgr.ui;
  const api = map.foliplus.LayerAPI;
  const container = map.getContainer();
  const COLOR_ID = "foliplus_color_map";
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const hasHatch = () => container.classList.contains("foliplus-no-base-map");

  const bases = api.layers.filter(l => l.group === "base" && l.id !== COLOR_ID);
  if (bases.length !== 2) {
    return { error: `expected 2 real tile bases, got ${bases.length}` };
  }
  const [a, b] = bases;

  // User sets disjoint ranges: A paints at zoom 1-2, B at 3-4.
  ui.intentStore.setValue(a.id, "zoomRange", [1, 2]);
  ui.intentStore.setValue(b.id, "zoomRange", [3, 4]);
  ui.applyProjectionAll();
  await wait(80);

  const to = async z => {
    const beforeZoom = map.getZoom();
    if (beforeZoom !== z) {
      map.setZoom(z);
      await new Promise(r => map.once("zoomend", r));
      await wait(40);
    }
    return { zoom: map.getZoom(), hatch: hasHatch() };
  };

  const atInA = await to(1); // A's range covers 1 → no hatch.
  const atGap = await to(5); // Above both ranges → hatch.
  const atInB = await to(3); // B's range covers 3 → hatch off.
  const atOutHigh = await to(4); // A out, B still in → off.
  const atBack = await to(1); // A re-enters → off.

  return { atInA, atGap, atInB, atOutHigh, atBack };
};
