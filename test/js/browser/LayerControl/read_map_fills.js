// Read the fill color actually painted on the map, not the panel.
//
// The ramp mode repaints each polygon to a per-value color, so the map's path
// elements carry distinct fill attributes. Reading the panel's color bar is a
// false positive (the DOM changed, the map may not have). This probe reads only
// the SVG the map renders — path elements under the map pane — and reports the
// distinct fill set, so a caller can assert "many" (ramp) or "one" (solid)
// without naming a color.
() => {
  const paths = [...document.querySelectorAll(".leaflet-map-pane path")];
  const fills = [...new Set(paths.map(p => p.getAttribute("fill")))];
  const present = fills.filter(f => f !== null && f !== "");
  return {
    count: paths.length,
    distinct: fills.length,
    present: present.length,
    // Sorted for deterministic comparison; never assert an exact color.
    fills: present.sort(),
  };
};
