// True once the toggle's path is drawn as the MINIMIZE glyph (icon has
// swapped from MAXIMIZE to MINIMIZE after the `fullscreenchange` event).
// Used only as a `wait_for_function` predicate — the wait itself is what
// asserts the async icon swap has landed.
() =>
  document
    .querySelector(".foliplus-fullscreen-toggle path")
    .getAttribute("d")
    .indexOf("M8 3v3") === 0;
