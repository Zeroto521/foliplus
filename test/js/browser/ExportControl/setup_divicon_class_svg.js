() => {
  // A DivIcon whose inline <svg> takes its paint from a page CSS class.
  //
  // The export clones the <svg> and serialises it as a standalone image,
  // which has no stylesheet — class-derived fill/stroke is lost and the
  // shape falls back to the default black fill. The clone must carry the
  // computed styles of the live elements.
  const api = window.map.foliplus && window.map.foliplus.LayerAPI;
  if (!api) return { error: "no LayerAPI" };
  for (const li of [...api.layers]) {
    if (li.layer instanceof L.TileLayer) api.setVisible(li.id, false);
  }

  const id = "__export_divicon_class_svg__";
  const paneName = "__export_divicon_class_svg_pane__";
  const g = api.createLayers({
    id,
    name: "DivIcon Class SVG",
    panes: [{ name: paneName }],
  });
  const icon = L.divIcon({
    className: "",
    html:
      "<style>.export-page-svg-shape{fill:#6600ff;stroke:#ffffff;stroke-width:0}</style>" +
      '<svg class="export-page-svg-shape" width="24" height="24">' +
      '<circle cx="12" cy="12" r="9"></circle></svg>',
    iconSize: [24, 24],
    iconAnchor: [12, 12],
  });
  const marker = L.marker([26.08, 119.3], { icon });
  g.mainLayer.addLayer(marker);
  g.register();

  const svg = marker.getElement() && marker.getElement().querySelector("svg");
  const circle = svg ? svg.querySelector("circle") : null;
  const cs = circle ? getComputedStyle(circle) : null;
  return {
    marker: true,
    paneName,
    circleFill: cs ? cs.fill : null,
    circleStroke: cs ? cs.stroke : null,
  };
};
