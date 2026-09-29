() => {
  const path = document.querySelector("path.leaflet-interactive");
  if (!path) return null;
  // Make the path focusable the way a keyboard user / script would, then
  // focus it so the :focus recipe is live. tabindex=-1 keeps it out of the
  // tab order — we only need the focus state.
  path.setAttribute("tabindex", "-1");
  path.focus();
  const cs = getComputedStyle(path);
  return {
    focused: document.activeElement === path,
    outlineStyle: cs.outlineStyle,
    // ⑤: accent marching ants on a white casing.
    stroke: cs.stroke,
    strokeWidth: cs.strokeWidth,
    strokeDasharray: cs.strokeDasharray,
    animationName: cs.animationName,
    // Casing is zero-blur white drop-shadows (see --foliplus-focus-casing).
    filter: cs.filter,
  };
};
