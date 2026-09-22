() => {
  const api = window.map.foliplus && window.map.foliplus.LayerAPI;
  if (!api) return null;
  const PANE = "__geojson_pane__";
  const mg = api.createLayers({
    id: "__geojson_pane__",
    name: "GeoJsonPane",
    panes: [{ name: PANE }],
  });
  // A group, not a Path leaf: Leaflet reads options.pane only when a layer
  // joins the map and ignores a group's pane for its children, so each child
  // has to carry the pane itself or it renders into the map's default pane.
  const geo = L.geoJSON({
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: {},
        geometry: {
          type: "LineString",
          coordinates: [
            [119.3, 26.08],
            [119.31, 26.09],
          ],
        },
      },
      {
        type: "Feature",
        properties: {},
        geometry: {
          type: "Polygon",
          coordinates: [
            [
              [119.2, 26.0],
              [119.4, 26.0],
              [119.4, 26.2],
              [119.2, 26.2],
              [119.2, 26.0],
            ],
          ],
        },
      },
    ],
  });
  mg.mainLayer.addLayer(geo);
  const kids = [];
  const declaredPane = window.map.getPane(PANE);
  geo.eachLayer(c => {
    const renderer = c._renderer;
    const container = renderer && renderer._container;
    const parent = container ? container.parentNode : null;
    kids.push({
      pane: c.options.pane,
      paneSet: c.options.paneSet,
      hasRendererOpt: Boolean(c.options.renderer),
      hasRenderer: Boolean(renderer),
      isPath: Boolean(container),
      // DOM truth: the SVG container's parent must be the declared pane element.
      inDeclaredPane: declaredPane ? parent === declaredPane : false,
      parentTag: parent ? parent.tagName : null,
      parentClass: parent ? parent.className.slice(0, 60) : null,
    });
  });
  return {
    groupPane: geo.options.pane,
    paneExists: Boolean(window.map.getPane(PANE)),
    kids,
  };
};
