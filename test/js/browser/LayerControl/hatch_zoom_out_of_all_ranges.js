async () => {
  // Guard: zooming past every basemap's declared min/max zoom must turn the
  // hatch on, and zooming back into one's range must turn it off. The
  // trigger is the zoom-end sweep inside `applyProjectionAll`, which now
  // reconciles the hatch from the paint observation.
  const ctrl = window.__layerCtrl;
  if (!ctrl) return { error: "no __layerCtrl" };
  const map = ctrl.mgr.map;
  const api = map.foliplus.LayerAPI;
  const container = map.getContainer();
  const COLOR_ID = "foliplus_color_map";
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const hasHatch = () => container.classList.contains("foliplus-no-base-map");

  const bases = api.layers.filter(l => l.group === "base" && l.id !== COLOR_ID);
  if (bases.length !== 2) {
    return { error: `expected 2 real tile bases, got ${bases.length}` };
  }

  const to = async z => {
    map.setZoom(z);
    await new Promise(r => map.once("zoomend", r));
    await wait(80);
    return { zoom: map.getZoom(), hatch: hasHatch() };
  };

  const atInA = await to(1); // A's declared [1,2] covers 1 → no hatch.
  const atGap = await to(5); // Above both A's max (2) and B's max (4) → hatch.
  const atInB = await to(3); // B's declared [3,4] covers 3 → hatch off.
  const atOutHigh = await to(4); // Still above A's max → both out → hatch.
  const atBack = await to(1); // A re-enters → hatch off.

  return { atInA, atGap, atInB, atOutHigh, atBack };
};
