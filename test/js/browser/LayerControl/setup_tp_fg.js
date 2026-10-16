// Registers a test-only FeatureGroup (with a polygon and a marker) so we can
// exercise LayerAPI registration through the browser.
() => {
  const api = window.map.foliplus.LayerAPI;
  const fg = L.featureGroup([
    L.polygon([
      [26.3, 119.2],
      [26.34, 119.2],
      [26.32, 119.25],
    ]),
    L.marker([26.33, 119.23]),
  ]);
  fg.addTo(window.map);
  api.registerLayer({ id: "__tp_fg__", name: "TP FG", layer: fg });
  return true;
};
