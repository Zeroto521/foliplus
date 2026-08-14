() => {
  const api = window.foliplus && window.foliplus.LayerAPI;
  if (!api) return null;
  // Count synchronous enforceOrder calls NOT originating from
  // initTypesAndVisibility (i.e. redundant per-register calls)
  let redundant = 0;
  const origEnforce = api.enforceOrder;
  api.enforceOrder = function () {
    const caller = new Error().stack.split("\n")[2] || "";
    if (!caller.includes("initTypesAndVisibility")) redundant++;
    return origEnforce.call(this);
  };
  for (let i = 0; i < 3; i++) {
    const mg = api.createLayers({
      id: "__batch_" + i + "__",
      name: "Batch" + i,
      graphPane: "__batch_graph_" + i + "__",
    });
    mg.mainLayer.addLayer(
      L.polyline([
        [26.08, 119.3],
        [26.09, 119.31],
      ]),
    );
  }
  const during = { redundant };
  return new Promise(resolve => {
    setTimeout(() => {
      resolve({ during, after: { redundant } });
    }, 200);
  });
};
