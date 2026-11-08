fixtures => {
  const ctrl = window.__layerCtrl;
  const mgr = ctrl && ctrl.mgr.label;
  const api = window.map.foliplus && window.map.foliplus.LayerAPI;
  if (!mgr || !api) return null;

  const g = api.createLayers({
    id: "__export_ann__",
    name: "Ann",
    panes: [{ name: "__export_ann_pane__" }],
  });
  for (const f of fixtures.points.features) {
    const m = L.marker([f.geometry.coordinates[1], f.geometry.coordinates[0]]);
    m.feature = { properties: f.properties };
    g.mainLayer.addLayer(m);
  }
  mgr.setConfig("__export_ann__", { show: true, field: "name", format: "auto" });
  mgr.renderLabels("__export_ann__");

  return new Promise(resolve => {
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        // Pane names come from the Leaflet _panes registry, not the DOM id.
        const canvas = window.map
          .getPane("foliplus-label-__export_ann__")
          ?.querySelector("canvas");
        if (!canvas) return resolve({ canvas: false, opaqueBefore: 0 });
        const data = canvas
          .getContext("2d")
          .getImageData(0, 0, canvas.width, canvas.height).data;
        let n = 0;
        let sample = null;
        for (let i = 0; i < data.length; i += 4) {
          if (data[i + 3] > 0) {
            n++;
            if (!sample) sample = [data[i], data[i + 1], data[i + 2]];
          }
        }
        resolve({ canvas: true, opaqueBefore: n, sample });
      }),
    );
  });
};
