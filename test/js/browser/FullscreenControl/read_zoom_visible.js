// True while the zoom-in button no longer carries the `foliplus-hidden`
// marker. The negative of `read_zoom_hidden`.
() =>
  !document.querySelector(".foliplus-zoom-in").classList.contains("foliplus-hidden");
