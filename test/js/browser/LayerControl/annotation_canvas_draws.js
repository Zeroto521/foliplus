() => {
  const ctrl = window.__layerCtrl;
  const mgr = ctrl && ctrl.m.annotation;
  const api = window.map.foliplus && window.map.foliplus.LayerAPI;
  if (!mgr || !api) return null;

  const g = api.createLayers({
    id: "__ann_draw__",
    name: "AnnDraw",
    panes: [{ name: "__ann_draw_pane__" }],
  });
  const mk = (lat, lng, name) => {
    const m = L.marker([lat, lng]);
    m.feature = { properties: { name } };
    return m;
  };
  g.mainLayer.addLayer(mk(26.08, 119.3, "alpha"));
  g.mainLayer.addLayer(mk(26.09, 119.31, "beta"));
  mgr.setConfig("__ann_draw__", { show: true, field: "name", format: "auto" });
  mgr.renderLabels("__ann_draw__");

  return new Promise(resolve => {
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        const canvas = document.querySelector(".foliplus-annotation-canvas");
        if (!canvas) return resolve({ canvas: false });
        const ctx = canvas.getContext("2d");
        const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
        let opaque = 0;
        for (let i = 3; i < data.length; i += 4) if (data[i] > 0) opaque++;
        resolve({ canvas: true, width: canvas.width, height: canvas.height, opaque });
      }),
    );
  });
};
