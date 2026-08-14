() => {
  const api = window.foliplus && window.foliplus.LayerAPI;
  if (!api) return null;
  const fg = L.featureGroup();
  // feature must be set directly on the layer instance,
  // not as an option — extractPoints checks l.feature
  const m1 = L.marker([26.08, 119.3]);
  m1.feature = { type: "Feature" };
  const m2 = L.circleMarker([26.09, 119.31]);
  m2.feature = { type: "Feature" };
  fg.addLayer(m1);
  fg.addLayer(m2);
  api.registerLayer({ id: "__test_extract__", layer: fg });
  const pts = api.extractPoints("__test_extract__");
  api.unregisterLayer("__test_extract__");
  return {
    count: pts.length,
    lat0: pts[0]?.lat,
    lng0: pts[0]?.lng,
    lat1: pts[1]?.lat,
    lng1: pts[1]?.lng,
  };
};
