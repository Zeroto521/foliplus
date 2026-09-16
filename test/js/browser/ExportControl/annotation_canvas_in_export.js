() => {
  const ctrl = window.__layerCtrl;
  const mgr = ctrl && ctrl.m.annotation;
  const api = window.map.foliplus && window.map.foliplus.LayerAPI;
  if (!mgr || !api) return null;

  const g = api.createLayers({
    id: "__export_ann__",
    name: "Ann",
    panes: [{ name: "__export_ann_pane__" }],
  });
  for (const [lat, lng, text] of [
    [26.08, 119.3, "alpha"],
    [26.09, 119.31, "beta"],
  ]) {
    const m = L.marker([lat, lng]);
    m.feature = { properties: { name: text } };
    g.mainLayer.addLayer(m);
  }
  mgr.setConfig("__export_ann__", { show: true, field: "name", format: "auto" });
  mgr.renderLabels("__export_ann__");

  return new Promise(resolve => {
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        // Pane names come from the Leaflet _panes registry, not the DOM id.
        const canvas = window.map
          .getPane("foliplus-annotation-__export_ann__")
          ?.querySelector("canvas");
        if (!canvas) return resolve({ canvas: false, opaqueBefore: 0 });
        const data = canvas
          .getContext("2d")
          .getImageData(0, 0, canvas.width, canvas.height).data;
        let n = 0;
        for (let i = 3; i < data.length; i += 4) if (data[i] > 0) n++;
        resolve({ canvas: true, opaqueBefore: n });
      }),
    );
  });
};
