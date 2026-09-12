() => {
  const mm = window.__measureManager;
  const map = window.__map;
  mm.setMode("circle");
  map.fire("click", { latlng: L.latLng(26.08, 119.3) }); // center → state 1
  map.invalidateSize();
  const node = () =>
    document.querySelector(".foliplus-measure-node:not(.foliplus-measure-node-solid)");
  const center = () => document.querySelector(".foliplus-measure-node-solid");

  // With the 3-pane layout, paint order is guaranteed by pane z-index
  // (graph < node < label), not by SVG sibling order. Check that each
  // element's ancestor pane has the expected z relationship.
  const paneZ = el => {
    if (!el) return null;
    const pane = el.closest(".leaflet-pane");
    return pane ? Number(getComputedStyle(pane).zIndex) : null;
  };
  const paneName = el => {
    if (!el) return null;
    const pane = el.closest(".leaflet-pane");
    if (!pane) return null;
    const m = pane.className.match(/measure_(\w+)-pane/);
    return m ? m[1] : null;
  };

  const stack = () => {
    // Graph pane z-index from the preview circle's pane.
    const circleEl = document.querySelector(".foliplus-measure-path-preview");
    const graphZ = paneZ(circleEl);
    return {
      circle: graphZ,
      dashed: paneZ(document.querySelector(".foliplus-measure-path-dashed")),
      fill: paneZ(document.querySelector(".foliplus-measure-shape-fill")),
      node: paneZ(node()),
      center: paneZ(center()),
      nodePane: paneName(node()),
      centerPane: paneName(center()),
    };
  };

  map.fire("mousemove", { latlng: L.latLng(26.085, 119.305) });
  const r1 = node()?.getBoundingClientRect();
  map.fire("mousemove", { latlng: L.latLng(26.09, 119.31) });
  const r2 = node()?.getBoundingClientRect();
  const s2 = stack();
  map.fire("mousemove", { latlng: L.latLng(26.091, 119.311) });
  const s3 = stack();
  return {
    x1: r1?.x ?? null,
    y1: r1?.y ?? null,
    x2: r2?.x ?? null,
    y2: r2?.y ?? null,
    stack: s2,
    stackAfterThirdMove: s3,
  };
};
