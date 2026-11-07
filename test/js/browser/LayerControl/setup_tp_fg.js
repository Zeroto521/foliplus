// Registers a test-only FeatureGroup (with a polygon and a marker) so we can
// exercise LayerAPI registration through the browser.
fixtures => {
  const api = window.map.foliplus.LayerAPI;
  const fg = L.featureGroup([L.polygon(fixtures.polygon), L.marker(fixtures.marker)]);
  fg.addTo(window.map);
  api.registerLayer({ id: "__tp_fg__", name: "TP FG", layer: fg });
  return true;
};
