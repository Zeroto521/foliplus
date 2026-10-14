async () => {
  const ctrl = window.__layerCtrl;
  if (!ctrl) return null;
  const map = ctrl.mgr.map;
  const api = map.foliplus.LayerAPI;

  const geo = L.geoJson({
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: { name: "p1" },
        geometry: { type: "Point", coordinates: [119.3, 26.08] },
      },
      {
        type: "Feature",
        properties: { name: "p2" },
        geometry: { type: "Point", coordinates: [119.31, 26.09] },
      },
    ],
  });
  api.registerLayer({ id: "__shadow_zoom__", name: "ShadowZoom", layer: geo });
  ctrl.mgr.enforceOrder();

  const findPane = () => {
    for (const [name, paneEl] of Object.entries(map._panes)) {
      if (name.startsWith("foliplus-pane-")) {
        const icons = paneEl.querySelectorAll(".leaflet-marker-icon");
        if (icons.length >= 2) return { paneName: name, paneEl };
      }
    }
    return null;
  };

  const readOrder = () => {
    const found = findPane();
    if (!found) return { error: "pane not found" };
    const paneEl = found.paneEl;
    const children = Array.from(paneEl.children);
    return {
      paneName: found.paneName,
      childCount: children.length,
      children: children.map(el => ({
        cls: typeof el.className === "string" ? el.className : String(el.className),
        isShadow: el.classList && el.classList.contains("leaflet-marker-shadow"),
        isIcon: el.classList && el.classList.contains("leaflet-marker-icon"),
      })),
    };
  };

  const waitZoom = () =>
    new Promise(resolve => {
      map.once("zoomend", resolve);
      setTimeout(resolve, 800);
    });

  const originalZoom = map.getZoom();
  const states = [];

  states.push({ step: "initial", ...readOrder() });

  map.setZoom(map.getMinZoom());
  await waitZoom();
  states.push({ step: "zoom-to-min", ...readOrder() });

  map.setZoom(originalZoom);
  await waitZoom();
  states.push({ step: "zoom-back", ...readOrder() });

  map.setZoom(originalZoom - 1);
  await waitZoom();
  states.push({ step: "zoom-out-again", ...readOrder() });

  return { states, originalZoom, minZoom: map.getMinZoom() };
};
