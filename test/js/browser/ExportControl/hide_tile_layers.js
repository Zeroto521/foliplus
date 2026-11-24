() => {
  // Hide every TileLayer through the LayerAPI intent (the export must not
  // paint opaque basemap tiles over the marker being asserted on).
  const api = window.map.foliplus && window.map.foliplus.LayerAPI;
  if (!api) return { error: "no LayerAPI" };
  let hidden = 0;
  for (const li of [...api.layers]) {
    if (li.layer instanceof L.TileLayer) {
      api.setVisible(li.id, false);
      hidden++;
    }
  }
  return { hidden };
};
