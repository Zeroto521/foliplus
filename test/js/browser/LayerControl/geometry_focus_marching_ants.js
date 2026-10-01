() => {
  const path = document.querySelector("path.leaflet-interactive");
  if (!path) return null;
  path.setAttribute("tabindex", "-1");
  path.focus();
  const cs = getComputedStyle(path);
  const marquee = document.querySelector("path.foliplus-focus-rect");
  const mcs = marquee ? getComputedStyle(marquee) : null;
  return {
    focused: document.activeElement === path,
    // UA ring must be gone (black on Windows / system blue on macOS).
    outlineStyle: cs.outlineStyle,
    // The geometry stroke itself is untouched (lines must stay solid).
    stroke: cs.stroke,
    strokeDasharray: cs.strokeDasharray,
    // Selection signal: marching-ants bbox.
    marqueePresent: marquee !== null,
    marqueeStroke: mcs ? mcs.stroke : null,
    marqueeDasharray: mcs ? mcs.strokeDasharray : null,
    marqueeAnimation: mcs ? mcs.animationName : null,
  };
};
