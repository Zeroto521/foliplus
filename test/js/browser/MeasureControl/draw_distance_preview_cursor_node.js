() => {
  const mm = window.__measureManager;
  const map = window.__map;
  mm.setMode("distance");
  map.fire("click", { latlng: L.latLng(26.08, 119.3) }); // anchor → 1 point
  map.invalidateSize();
  // The cursor dot is the only .foliplus-measure-node WITHOUT the -solid
  // modifier (the placed anchor is NODE_SOLID).
  const node = () =>
    document.querySelector(".foliplus-measure-node:not(.foliplus-measure-node-solid)");
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
  // Right-click finishes: the transient preview node must be removed.
  map.fire("contextmenu", { latlng: L.latLng(26.09, 119.31) });
  return {
    x1: r1?.x ?? null,
    y1: r1?.y ?? null,
    x2: r2?.x ?? null,
    y2: r2?.y ?? null,
    stack: s,
    removedAfterFinish: !node(),
  };
};
