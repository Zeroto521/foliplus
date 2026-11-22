// Find a marker on the map and expose it under a stable global so the
// downstream helpers can reach it. Folium names its own marker var
// (`marker_<hash>`) when a Marker is a direct child element, but a marker
// created by a GeoJSON layer's pointToLayer has no script var at all — so the
// lookup walks the live map instead of the rendered script text. Returns the
// global's name, or null when no marker is on the page.
() => {
  let found = null;
  const walk = node => {
    if (found || !node) return;
    if (node instanceof L.Marker) {
      found = node;
      return;
    }
    if (typeof node.eachLayer === "function") node.eachLayer(walk);
  };
  window.map.eachLayer(walk);
  if (!found) return null;
  window.__foundMarker = found;
  return "__foundMarker";
};
