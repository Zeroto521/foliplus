// True once the map container has dropped the pseudo-fullscreen class.
// The negative of `read_pseudo_fullscreen_on`.
() =>
  !document
    .querySelector(".leaflet-container")
    .classList.contains("leaflet-pseudo-fullscreen");
