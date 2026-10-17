// True while the map container carries the pseudo-fullscreen class.
// Used both as a `wait_for_function` predicate (poll for entry) and as a
// `page.evaluate` read (post-reject assertions).
() =>
  document
    .querySelector(".leaflet-container")
    .classList.contains("leaflet-pseudo-fullscreen");
