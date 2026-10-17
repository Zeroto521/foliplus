() => {
  const dot = document.querySelector("path.foliplus-dot-solid");
  if (!dot) return { error: "no centroid dot path found" };
  const fill = document.querySelector(".foliplus-measure-shape-fill");
  if (!fill) return { error: "no fill path found" };
  const paneZ = el => {
    const pane = el.closest(".leaflet-pane");
    return pane ? Number(getComputedStyle(pane).zIndex) : null;
  };
  const paneName = el => {
    const pane = el.closest(".leaflet-pane");
    if (!pane) return null;
    const m = pane.className.match(/foliplus-measure-(\w+)-pane/);
    return m ? m[1] : null;
  };
  const dotZ = paneZ(dot);
  const fillZ = paneZ(fill);
  return {
    dotIsPath: dot.tagName === "path",
    dotPane: paneName(dot),
    fillPane: paneName(fill),
    dotZ,
    fillZ,
    dotAboveFill: dotZ > fillZ,
  };
};
