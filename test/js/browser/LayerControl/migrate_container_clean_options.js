() => {
  const api = window.foliplus && window.foliplus.LayerAPI;
  if (!api) return null;
  const mg = api.createLayers({
    id: "__clean_cont__",
    name: "CleanCont",
    graphPane: "__clean_graph__",
  });
  const poly = L.polyline([
    [26.08, 119.3],
    [26.09, 119.31],
  ]);
  mg.mainLayer.addLayer(poly);
  // Leaf layer must be in the graph pane
  const leafPane = poly.options.pane;
  // Container must NOT be in a fallback pane
  const containerPane = mg.mainLayer.options.pane;
  return {
    leafPane,
    containerPane: typeof containerPane === "undefined" ? null : containerPane,
    isFallback:
      typeof containerPane === "string" && containerPane.startsWith("foliplus_pane_"),
    leafHasPath: !!(poly._path && poly._path.parentNode),
  };
};
