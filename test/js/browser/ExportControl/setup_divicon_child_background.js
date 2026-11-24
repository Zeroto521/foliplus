() => {
  // A DivIcon whose pin body is a CHILD element's flat background-color.
  //
  // The root marker element Leaflet creates for a DivIcon is transparent
  // (no background-image, no background-color, no <img>, no <svg>); the
  // visible pin is an arbitrary HTML descendant. The export's remaining
  // pass only painted the ROOT's background-color, so such a marker
  // exported nothing at all. The child's background must reach the canvas.
  const api = window.map.foliplus && window.map.foliplus.LayerAPI;
  if (!api) return { error: "no LayerAPI" };
  for (const li of [...api.layers]) {
    if (li.layer instanceof L.TileLayer) api.setVisible(li.id, false);
  }

  const id = "__export_divicon_child_bg__";
  const paneName = "__export_divicon_child_bg_pane__";
  const g = api.createLayers({
    id,
    name: "DivIcon Child BG",
    panes: [{ name: paneName }],
  });
  const icon = L.divIcon({
    className: "",
    html: '<div style="width:22px;height:22px;border-radius:50%;background:#00cc66;border:2px solid #004400"></div>',
    iconSize: [22, 22],
    iconAnchor: [11, 11],
  });
  const marker = L.marker([26.08, 119.3], { icon });
  g.mainLayer.addLayer(marker);
  g.register();

  const child = marker.getElement() && marker.getElement().firstElementChild;
  const cs = child ? getComputedStyle(child) : null;
  return {
    marker: true,
    paneName,
    childBackground: cs ? cs.backgroundColor : null,
  };
};
