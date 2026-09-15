() => {
  const ctrl = window.__layerCtrl;
  const mgr = ctrl && ctrl.m.annotation;
  const api = window.map.foliplus && window.map.foliplus.LayerAPI;
  if (!mgr || !api) return null;

  const g = api.createLayers({
    id: "__pan_stable__",
    name: "PanStable",
    panes: [{ name: "__pan_stable_pane__" }],
  });
  const mk = (lat, lng, name) => {
    const m = L.marker([lat, lng]);
    m.feature = { properties: { name } };
    return m;
  };
  g.mainLayer.addLayer(mk(26.08, 119.3, "alpha"));
  g.mainLayer.addLayer(mk(26.09, 119.31, "beta"));
  mgr.setConfig("__pan_stable__", { show: true, field: "name", format: "auto" });
  mgr.renderLabels("__pan_stable__");

  return new Promise(resolve => {
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        const canvas = document.querySelector(".foliplus-annotation-canvas");
        if (!canvas) return resolve({ canvas: false });
        const before = canvas.getBoundingClientRect();
        // Leaflet pans by translating mapPane; the canvas must cancel that
        // translation, so its own rect stays put while the labels inside are
        // redrawn in the new container coordinates. Without the cancel the
        // canvas rides the transform and the labels drift off their features.
        window.map.panBy([120, 80], { animate: false });
        requestAnimationFrame(() =>
          requestAnimationFrame(() => {
            const after = canvas.getBoundingClientRect();
            resolve({
              canvas: true,
              beforeLeft: Math.round(before.left),
              beforeTop: Math.round(before.top),
              afterLeft: Math.round(after.left),
              afterTop: Math.round(after.top),
            });
          }),
        );
      }),
    );
  });
};
