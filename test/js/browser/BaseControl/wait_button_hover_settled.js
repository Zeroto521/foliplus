// wait_for_function predicate (args: selector): a hovered button's
// background-color has reached accent-light (#fde8e8).
//
// The unified button :hover rule transitions background-color over
// --foliplus-transition-fast (0.15s ease). Reading a screenshot before the
// transition finishes captures a mid-blend fill whose corner pixels are not
// yet the full accent-light, so the corner-pink density check can flake on
// raster timing. Wait until computed background-color is the settled value,
// not a fixed wait_for_timeout.
selector => {
  const el = document.querySelector(selector);
  if (!el) return false;
  // accent-light resolves to rgb(253, 232, 232) (from --foliplus-red-50).
  return getComputedStyle(el).backgroundColor === "rgb(253, 232, 232)";
};
