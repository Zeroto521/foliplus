() => {
  // Register two overlay layers through the same path a third-party component
  // would use -- its own constructor runs after the LayerControl IIFE has
  // attached its panel, so registerLayer lands while `ui` already exists.
  const api = window.map?.foliplus?.LayerAPI;
  if (!api) return null;
  api.registerLayer({
    id: "__probeA__",
    name: "Probe A",
    layer: L.featureGroup(),
  });
  api.registerLayer({
    id: "__probeB__",
    name: "Probe B",
    layer: L.featureGroup(),
  });
  return { registered: api.layers.filter(l => l.id.startsWith("__probe")).length };
};
