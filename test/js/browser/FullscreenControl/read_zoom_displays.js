// Computed `display` of both zoom buttons. Reads are paired because both
// share the hide rule — asserting them together surfaces a half-applied
// hide.
() => ({
  zoomIn: getComputedStyle(document.querySelector(".foliplus-zoom-in")).display,
  zoomOut: getComputedStyle(document.querySelector(".foliplus-zoom-out")).display,
});
