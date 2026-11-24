() => {
  // A DivIcon that embeds an image the export cannot read back (an
  // unreachable origin). The export must not skip it silently: the failure
  // is counted in the render stats and reported on the console with the URL.
  const api = window.map.foliplus && window.map.foliplus.LayerAPI;
  if (!api) return { error: "no LayerAPI" };
  for (const li of [...api.layers]) {
    if (li.layer instanceof L.TileLayer) api.setVisible(li.id, false);
  }

  const id = "__export_divicon_broken_image__";
  const paneName = "__export_divicon_broken_image_pane__";
  const g = api.createLayers({ id, name: "Broken Image", panes: [{ name: paneName }] });
  const brokenUrl = "http://127.0.0.1:9/foliplus-missing-icon.png";
  const icon = L.divIcon({
    className: "",
    html: '<img src="' + brokenUrl + '" width="16" height="16">',
    iconSize: [16, 16],
    iconAnchor: [8, 8],
  });
  const marker = L.marker([26.08, 119.3], { icon });
  g.mainLayer.addLayer(marker);
  g.register();
  return { marker: true, paneName, brokenUrl };
};
