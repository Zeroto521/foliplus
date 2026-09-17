() => {
  const ctrl = window.__layerCtrl;
  const map = ctrl.m.map;
  const api = map.foliplus.LayerAPI;

  // A GeoJSON whose point features become Leaflet Markers (Leaflet's default
  // pointToLayer) — the shape that ignored the opacity control, because
  // `GeoJSON.setStyle` only forwards to Path children.
  const geo = L.geoJson({
    type: "FeatureCollection",
    features: [0, 1, 2].map(i => ({
      type: "Feature",
      properties: { name: "p" + i, value: i + 1 },
      geometry: {
        type: "Point",
        coordinates: [119.3 + i * 0.02, 26.08 + i * 0.02],
      },
    })),
  });
  api.registerLayer({ id: "opacity_markers", name: "Opacity Markers", layer: geo });

  const li = api.layers.find(l => l.id === "opacity_markers");
  if (!li) return { error: "register failed" };
  if (!li.layer) return { error: "layer not linked" };

  ctrl.m.ui.openStylePanel("opacity_markers");
  const range = document.querySelector(".foliplus-style-opacity-range");
  const number = document.querySelector(".foliplus-style-opacity-number");
  if (!range) {
    return {
      error: "no opacity row",
      hasPanel: !!document.querySelector(".foliplus-layer-style-panel"),
    };
  }
  range.value = "40";
  range.dispatchEvent(new Event("input", { bubbles: true }));

  const markerOpacity = [];
  const markerApis = [];
  li.layer.eachLayer(child => {
    // Behaviour-based, so a minified build (class names are mangled) says the
    // same thing: markers expose setOpacity and no setStyle at all.
    markerApis.push({
      setStyle: typeof child.setStyle === "function",
      setOpacity: typeof child.setOpacity === "function",
    });
    if (child.options && "opacity" in child.options) {
      markerOpacity.push(child.options.opacity);
    }
  });
  const iconOpacity = Array.from(document.querySelectorAll(".leaflet-marker-icon"))
    .map(el => el.style.opacity)
    .filter(Boolean);

  return {
    error: null,
    // The crux: the group DOES expose setStyle, which is exactly what the old
    // walk used and what skipped every marker.
    groupHasSetStyle: typeof li.layer.setStyle === "function",
    markerApis,
    markerCount: markerOpacity.length,
    markerOpacity,
    iconOpacity,
    registryOpacity: li.opacity,
    numberValue: number ? number.value : null,
    fillVar: range.style.getPropertyValue("--opacity-fill"),
  };
};
