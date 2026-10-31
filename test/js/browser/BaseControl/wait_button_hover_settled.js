// wait_for_function predicate (args: selector): a hovered button's
// background-color has reached its settled hover value.
//
// The unified button :hover rule transitions background-color over
// --foliplus-transition-fast (0.15s ease). Reading a screenshot before the
// transition finishes captures a mid-blend fill whose corner pixels are not
// yet the settled color, so the corner-pink density check can flake on
// raster timing. Wait until computed background-color is the settled value,
// not a fixed wait_for_timeout.
//
// The settled hover color is selector-specific: toggle/tool buttons hover to
// accent-light (rgb(253,232,232)), while the panel button (foliplus-panel-btn)
// hovers to --foliplus-ctrl-hover-bg (neutral-100, rgb(245,245,245)) -- see
// button.css. A single fixed color would never match the panel button and the
// wait would time out.
selector => {
  const el = document.querySelector(selector);
  if (!el) return false;
  const cs = getComputedStyle(el);
  const settled = selector === "#panel" ? "rgb(245, 245, 245)" : "rgb(253, 232, 232)";
  return cs.backgroundColor === settled;
};
