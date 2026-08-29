() => {
  const map = window.__map;
  // Simulate another component's interactive feature: a marker with a popup,
  // added straight to the map (not through a foliplus layer).
  const marker = L.marker([26.085, 119.305], { interactive: true }).addTo(map);
  window.__testMarker = marker;

  const state = { before: marker.options.interactive };

  window.__measureManager.setMode("distance");
  state.during = marker.options.interactive;
  state.iconDuring = marker._icon
    ? marker._icon.classList.contains("leaflet-interactive")
    : null;

  window.__measureManager.clearActiveMode();
  state.after = marker.options.interactive;
  state.iconAfter = marker._icon
    ? marker._icon.classList.contains("leaflet-interactive")
    : null;

  marker.remove();
  return state;
};
