fixtures => {
  const api = window.map.foliplus && window.map.foliplus.LayerAPI;
  if (!api) return null;
  const mg = api.createLayers({
    id: "__clean_cont__",
    name: "CleanCont",
    panes: [{ name: "__clean_graph__" }],
  });
  const poly = L.polyline(fixtures.line);
  mg.mainLayer.addLayer(poly);
  // Leaf layer must be in the graph pane
  const leafPane = poly.options.pane;
  // Container must NOT be in a fallback pane
  const containerPane = mg.mainLayer.options.pane;
  return {
    leafPane,
    containerPane: typeof containerPane === "undefined" ? null : containerPane,
    isFallback:
      typeof containerPane === "string" && containerPane.startsWith("foliplus-pane-"),
    leafHasPath: !!(poly._path && poly._path.parentNode),
  };
};
