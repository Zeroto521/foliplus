() => {
  const mm = window.__measureManager;
  const map = window.__map;
  mm.setMode("distance");
  // The cursor dot is the only .foliplus-measure-node WITHOUT the -solid
  // modifier (the placed anchor is NODE_SOLID).
  const node = () =>
    document.querySelector(".foliplus-measure-node:not(.foliplus-measure-node-solid)");
  // Nothing to cursor at yet: entering the mode must not float a dot.
  const idle = node() === null;

  map.fire("click", { latlng: L.latLng(26.08, 119.3) }); // anchor → 1 point
  map.invalidateSize();
  // Renderer root sibling order == paint order (later siblings paint above).
  const stack = () => {
    const el = node();
    const svg = el && el.closest("svg");
    const root = svg ? svg.querySelector("g") || svg : null;
    const sibs = root ? Array.from(root.children) : [];
    const idx = cls => {
      const el = sibs.find(e => e.classList && e.classList.contains(cls));
      return el ? sibs.indexOf(el) : -1;
    };
    return {
      preview: idx("foliplus-measure-path-preview"),
      dashed: idx("foliplus-measure-path-dashed"),
      node: sibs.indexOf(el),
    };
  };
  // First mousemove: the cursor dot must be created and positioned here.
  map.fire("mousemove", { latlng: L.latLng(26.085, 119.305) });
  const r1 = node()?.getBoundingClientRect();
  // Second mousemove: the node must follow the cursor.
  map.fire("mousemove", { latlng: L.latLng(26.09, 119.31) });
  const r2 = node()?.getBoundingClientRect();
  const s = stack();
  // Third mousemove: the recreated node must still sit above both preview
  // paths in DOM order. The old in-place `setLatLng` path let the live line
  // climb over it — `setLatLngs` re-sorts the SVG root but `setLatLng` does
  // not (regression: PR #252).
  map.fire("mousemove", { latlng: L.latLng(26.091, 119.311) });
  const s2 = stack();
  // Right-click finishes: the transient preview node must be removed.
  map.fire("contextmenu", { latlng: L.latLng(26.09, 119.31) });
  return {
    idle,
    x1: r1?.x ?? null,
    y1: r1?.y ?? null,
    x2: r2?.x ?? null,
    y2: r2?.y ?? null,
    stack: s,
    stackAfterThirdMove: s2,
    removedAfterFinish: !node(),
  };
};
