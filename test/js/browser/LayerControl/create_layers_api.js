() => {
  const api = window.map.foliplus && window.map.foliplus.LayerAPI;
  if (!api) return null;
  const mg = api.createLayers({
    id: "__test__",
    name: "Test",
    graphPane: "__test_graph__",
    labelPane: "__test_label__",
  });
  return {
    hasClearLayers: typeof mg.clearLayers === "function",
    hasRegister: typeof mg.register === "function",
    hasUnregister: typeof mg.unregister === "function",
    hasRegistered: typeof mg.registered === "function",
    hasMainLayer: !!mg.mainLayer,
    hasBringToFront: typeof mg.bringToFront === "function",
  };
};
