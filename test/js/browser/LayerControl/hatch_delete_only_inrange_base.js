async () => {
  // Guard: the author's declared min/max zoom is a physical fact of the
  // basemap — a base outside it builds no tile even though `hasLayer` is
  // still true. Deleting the sole in-range base at the current zoom must
  // show the hatch: the remaining base's paint observation is false, so
  // intent alone would name it visible and keep the hatch off.
  const ctrl = window.__layerCtrl;
  if (!ctrl) return { error: "no __layerCtrl" };
  const map = ctrl.mgr.map;
  const api = map.foliplus.LayerAPI;
  const container = map.getContainer();
  const COLOR_ID = "foliplus_color_map";
  const wait = ms => new Promise(r => setTimeout(r, ms));

  const bases = api.layers.filter(l => l.group === "base" && l.id !== COLOR_ID);
  if (bases.length !== 2) {
    return { error: `expected 2 real tile bases, got ${bases.length}` };
  }
  const [a, b] = bases;
  const hasHatch = () => container.classList.contains("foliplus-no-base-map");

  map.setZoom(1);
  await new Promise(r => map.once("zoomend", r));
  await wait(80);

  const before = {
    zoom: map.getZoom(),
    hatch: hasHatch(),
    bases: bases.map(l => {
      const layer = api.findLayer(l.id);
      return {
        id: l.id,
        minZoom: layer?.options?.minZoom ?? null,
        maxZoom: layer?.options?.maxZoom ?? null,
      };
    }),
  };

  const delReturn = api.deleteLayer(a.id);
  await wait(80);

  const after = {
    delReturn,
    hatch: hasHatch(),
    basesOnMap: api.layers.filter(l => l.group === "base" && l.id !== COLOR_ID),
  };

  return { before, after };
};
