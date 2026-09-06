() => {
  const map = window.map;
  const api = map.foliplus && map.foliplus.LayerAPI;
  if (!api) return null;
  // Layers already on the map before this fixture runs are not the
  // container's to clean up, so only the layers this fixture adds can speak
  // to the leak: the container layer group and its empty sub-groups.
  const before = new Set(Object.values(map._layers));
  const mg = api.createLayers({
    id: "__clean_cont__",
    name: "CleanCont",
    graphPane: "__clean_graph__",
  });
  const poly = L.polyline([
    [26.08, 119.3],
    [26.09, 119.31],
  ]);
  // Pin the pane's SVG renderer container to the front, as enforceOrder does,
  // so the leak assertion sees the whole layeradd fan-out -- including the
  // renderer Leaflet registers on its own path pane.
  const stamp = l => L.stamp(l);
  // The whole container subtree is the only thing this fixture may add to the
  // map: registration puts mainLayer in, the sub-groups travel inside it, and
  // the leaf polyline is added through the wrapped addLayer. LayerGroup has
  // no accessor that skips its own sub-groups, so the fixture must walk the
  // tree and whitelist it -- anything else in map._layers leaked.
  const collect = (group, seen) => {
    for (const l of Array.from(group.getLayers())) {
      if (!seen.has(stamp(l))) {
        seen.add(stamp(l));
        if (l.getLayers) collect(l, seen);
      }
    }
  };
  const ids = new Set();
  ids.add(stamp(mg.mainLayer));
  collect(mg.mainLayer, ids);
  ids.add(stamp(poly));
  mg.mainLayer.addLayer(poly);
  // Pin the pane's SVG renderer container to the front, as enforceOrder does,
  // so the leak assertion sees the whole layeradd fan-out -- including the
  // renderer Leaflet registers on its own path pane.
  if (poly._renderer && poly._renderer._container) {
    poly._renderer._container.style.zIndex = "1000";
    ids.add(stamp(poly._renderer));
  }
  const added = Object.values(map._layers).filter(l => !before.has(l));
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
    mainLayerOnMap: map.hasLayer(mg.mainLayer),
    // Only the container layer group may be added to the map: the factory
    // creates its graph sub-group lazily and an empty sub-group must never
    // be pinned as a top-level layer on the map.
    addedCount: added.length,
    leakedPanes: added
      .filter(l => !ids.has(stamp(l)))
      .map(l => ({
        pane: (l.options && l.options.pane) || null,
        children: l.getLayers ? l.getLayers().length : null,
      })),
  };
};
