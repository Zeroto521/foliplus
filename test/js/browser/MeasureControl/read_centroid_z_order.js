() => {
  // Reads the pane z-indices under the polygon centroid dot, the shape fill
  // and the area chip. The invariant pinned here is label > node > fill, so
  // the centroid chip always sits above the centroid dot.
  const dot = document.querySelector("path.foliplus-measure-node-solid");
  if (!dot) return { error: "no centroid dot path found" };
  const fill = document.querySelector(".foliplus-measure-shape-fill");
  if (!fill) return { error: "no fill path found" };
  const label = document.querySelector(".foliplus-measure-label");
  if (!label) return { error: "no label found" };
  const paneZ = el => {
    const pane = el.closest(".leaflet-pane");
    return pane ? Number(getComputedStyle(pane).zIndex) : null;
  };
  return {
    dotPaneZ: paneZ(dot),
    fillPaneZ: paneZ(fill),
    labelPaneZ: paneZ(label),
    labelAboveDot: paneZ(label) > paneZ(dot),
    dotAboveFill: paneZ(dot) > paneZ(fill),
  };
};
