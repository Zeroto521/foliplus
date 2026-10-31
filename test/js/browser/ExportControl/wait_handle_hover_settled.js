// wait_for_function predicate: a hovered handle's background-color has
// reached accent-light (#fde8e8) and is stable across a frame.
//
// The handle's :hover rule transitions background-color over
// --foliplus-transition-fast (0.15s ease). Reading a screenshot before the
// transition finishes captures a mid-blend fill whose corner pixels are not
// yet the full accent-light, so the corner-pink density check can flake on
// raster timing. Wait until computed background-color is the settled value
// (the transition has finished), not a fixed wait_for_timeout.
() => {
  const handle = document.querySelector(".foliplus-export-handle.br");
  if (!handle) return false;
  const cs = getComputedStyle(handle);
  // accent-light resolves to rgb(253, 232, 232) (from --foliplus-red-50).
  return cs.backgroundColor === "rgb(253, 232, 232)";
};
