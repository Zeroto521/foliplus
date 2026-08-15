() => {
  const api = window.map.foliplus && window.map.foliplus.LayerAPI;
  if (!api) return null;
  const ids = [];
  for (let i = 0; i < 3; i++) {
    const mg = api.createLayers({
      id: "__idem_" + i + "__",
      name: "Idem" + i,
      graphPane: "__idem_g" + i + "__",
    });
    mg.mainLayer.addLayer(
      L.polyline([
        [26.08, 119.3],
        [26.09, 119.31],
      ]),
    );
    ids.push("__idem_" + i + "__");
  }
  const orderBefore = api.layers.filter(l => ids.includes(l.id)).map(l => l.id);
  // Re-register the middle layer with same id (no layer, callback-only)
  api.registerLayer({ id: "__idem_1__", name: "Idem1" });
  const orderAfter = api.layers.filter(l => ids.includes(l.id)).map(l => l.id);
  return {
    orderBefore,
    orderAfter,
    moved: orderBefore.join(",") !== orderAfter.join(","),
  };
};
