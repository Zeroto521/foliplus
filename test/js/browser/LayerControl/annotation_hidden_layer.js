() => {
  const ctrl = window.__layerCtrl;
  const mgr = ctrl && ctrl.m.annotation;
  const api = window.map.foliplus && window.map.foliplus.LayerAPI;
  if (!mgr || !api) return null;

  const g = api.createLayers({
    id: "__vis__",
    name: "Vis",
    panes: [{ name: "__vis_pane__" }],
  });
  for (const [lat, lng, text] of [
    [26.08, 119.3, "alpha"],
    [26.09, 119.31, "beta"],
  ]) {
    const m = L.marker([lat, lng]);
    m.feature = { properties: { name: text } };
    g.mainLayer.addLayer(m);
  }
  mgr.setConfig("__vis__", { show: true, field: "name", format: "auto" });
  mgr.renderLabels("__vis__");

  const count = () => {
    const canvas = document.querySelector(".foliplus-annotation-canvas");
    if (!canvas) return 0;
    const data = canvas
      .getContext("2d")
      .getImageData(0, 0, canvas.width, canvas.height).data;
    let n = 0;
    for (let i = 3; i < data.length; i += 4) if (data[i] > 0) n++;
    return n;
  };
  const frame = () =>
    new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));

  return (async () => {
    await frame();
    const before = count();
    // LayerControl hides a layer with map.removeLayer (state.ts) — same call.
    window.map.removeLayer(g.mainLayer);
    await frame();
    const hidden = count();
    window.map.addLayer(g.mainLayer);
    await frame();
    return { before, hidden, shown: count() };
  })();
};
