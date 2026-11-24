// True while the fullscreen toggle carries the `foliplus-hidden` marker.
// hide_self hides the toggle only: the bar's zoom buttons stay visible while
// fullscreen, so the user can still zoom with Leaflet's own control replaced.
() =>
  document
    .querySelector(".foliplus-fullscreen-toggle")
    .classList.contains("foliplus-hidden");
