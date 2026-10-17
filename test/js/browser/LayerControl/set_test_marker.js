// Assigns a Folium marker var (named by hash suffix) to a stable global
// for downstream pan/coordinate helpers.
markerVar => {
  window.__testMarker = window[markerVar];
};
