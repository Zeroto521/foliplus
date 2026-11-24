// Records Leaflet's own zoom control node so a later read can prove the same
// node survived fullscreen entry and exit. The control under test must not
// replace, copy or remove the map's zoom control.
() => {
  window.__foliplusZoomControl = document.querySelector(".leaflet-control-zoom");
  return Boolean(window.__foliplusZoomControl);
};
