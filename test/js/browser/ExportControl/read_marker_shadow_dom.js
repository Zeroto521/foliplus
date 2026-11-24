() => {
  // Read the DOM the export's shadow channel has to paint for the marker on
  // this page: the leaf's shadow element and the sprite it carries.
  const api = window.map.foliplus && window.map.foliplus.LayerAPI;
  if (!api) return { error: "no LayerAPI" };
  // Leaflet classes the default <img> shadow, but a divIcon shadow
  // (awesome-markers) is the plugin's own DIV; cover both shapes.
  const shadows = Array.from(
    document.querySelectorAll(".awesome-marker-shadow, .leaflet-marker-shadow"),
  );
  const out = shadows.map(el => {
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return {
      tag: el.tagName,
      backgroundImage: cs.backgroundImage,
      backgroundColor: cs.backgroundColor,
      width: Math.round(r.width),
      height: Math.round(r.height),
    };
  });
  return { count: out.length, shadows: out };
};
