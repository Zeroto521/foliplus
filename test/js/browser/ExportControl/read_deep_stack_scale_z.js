() => {
  // Compare export-mode scale/attribution z against every data-layer pane.
  // A deep overlay stack (z = 600 + n*10) used to climb past the old
  // scale z of 850 and cover the scale control entirely; the scale z must
  // sit above every data pane and still under the crop mask.
  const scale = document.querySelector(".leaflet-control-scale");
  const attr = document.querySelector(".leaflet-control-attribution");
  const box = document.querySelector(".foliplus-export-box");
  const zOf = el => (el ? parseInt(getComputedStyle(el).zIndex, 10) : null);

  // LayerControl stamps each managed pane's z inline; collect those.
  const paneZs = [...document.querySelectorAll(".leaflet-pane")]
    .map(el => zOf(el))
    .filter(z => Number.isFinite(z) && z > 0);
  const maxPaneZ = paneZs.length ? Math.max(...paneZs) : null;

  return {
    scaleZ: zOf(scale),
    attrZ: zOf(attr),
    boxZ: zOf(box),
    maxPaneZ,
    paneZs,
    paneCount: paneZs.length,
  };
};
