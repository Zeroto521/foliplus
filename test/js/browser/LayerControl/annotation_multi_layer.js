() => {
  const ctrl = window.__layerCtrl;
  const mgr = ctrl && ctrl.m.annotation;
  const api = window.map.foliplus && window.map.foliplus.LayerAPI;
  if (!mgr || !api) return null;

  const build = (id, name, points) => {
    const g = api.createLayers({
      id,
      name,
      panes: [{ name: id + "_pane" }],
    });
    for (const [lat, lng, text] of points) {
      const m = L.marker([lat, lng]);
      m.feature = { properties: { name: text } };
      g.mainLayer.addLayer(m);
    }
    mgr.setConfig(id, { show: true, field: "name", format: "auto" });
    mgr.renderLabels(id);
  };
  build("__ml_a__", "MLA", [
    [26.08, 119.3, "alpha"],
    [26.09, 119.31, "beta"],
  ]);
  build("__ml_b__", "MLB", [
    [26.1, 119.32, "gamma"],
    [26.11, 119.33, "delta"],
  ]);

  return new Promise(resolve => {
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        const canvas = document.querySelector(".foliplus-annotation-canvas");
        if (!canvas) return resolve({ canvas: false });
        const ctx = canvas.getContext("2d");
        const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
        let opaque = 0;
        for (let i = 3; i < data.length; i += 4) if (data[i] > 0) opaque++;

        const annPane = document.querySelector(".foliplus-annotation-pane");
        const layerPanes = Array.from(
          document.querySelectorAll(".foliplus-layer-pane"),
        );
        const maxLayerZ = Math.max(
          0,
          ...layerPanes.map(p => parseInt(p.style.zIndex) || 0),
        );
        resolve({
          canvas: true,
          opaque,
          // Every labelled layer shares one canvas, and it sits above them all.
          canvasCount: document.querySelectorAll(".foliplus-annotation-canvas").length,
          layerPaneCount: layerPanes.length,
          annZ: annPane ? parseInt(annPane.style.zIndex) || 0 : null,
          maxLayerZ,
        });
      }),
    );
  });
};
