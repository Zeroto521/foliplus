() => {
  const mm = window.__measureManager;
  const map = window.__map;
  mm.setMode("circle");
  map.fire("click", { latlng: L.latLng(26.08, 119.3) }); // center → state 1
  map.invalidateSize();
  // The radius node is the only .foliplus-measure-node WITHOUT the -solid
  // modifier (the center dot is NODE_SOLID).
  const node = () =>
    document.querySelector(".foliplus-measure-node:not(.foliplus-measure-node-solid)");
  const center = () =>
    document.querySelector(".foliplus-measure-node-solid");
  // Renderer root sibling order == paint order (later siblings paint above).
  const stack = () => {
    const svg = document.querySelector("svg.leaflet-overlay-pane svg") ||
      document.querySelector("svg");
    const root = svg ? svg.querySelector("g") || svg : null;
    const sibs = root ? Array.from(root.children) : [];
    const idx = cls => {
      const el = sibs.find(e => e.classList && e.classList.contains(cls));
      return el ? sibs.indexOf(el) : -1;
    };
    return {
      circle: idx("foliplus-measure-path-preview"),
      dashed: idx("foliplus-measure-path-dashed"),
      fill: idx("foliplus-measure-shape-fill"),
      node: sibs.indexOf(node()),
      center: sibs.indexOf(center()),
    };
  };
  // First mousemove: the radius node must be created here.
  map.fire("mousemove", { latlng: L.latLng(26.085, 119.305) });
  const r1 = node()?.getBoundingClientRect();
  const s1 = stack();
  // Second mousemove: the node must follow the cursor.
  map.fire("mousemove", { latlng: L.latLng(26.09, 119.31) });
  const r2 = node()?.getBoundingClientRect();
  const s2 = stack();
  // Third mousemove: the preview circle's `setRadius` and the line's
  // `setLatLngs` both re-sort the SVG root to their own tail, so without a
  // matching re-add the center node would be painted over by frame 3 —
  // `setLatLng`/`setRadius` do not participate in that re-sort. This is the
  // regression that the one-frame check above cannot see (PR #252).
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
