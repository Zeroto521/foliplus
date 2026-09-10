() => {
  const mm = window.__measureManager;
  const map = window.__map;
  mm.setMode("polygon");
  // Polygon places its vertices as plain NODE_HOLLOW (distance's anchor is the
  // only NODE_SOLID node), so the cursor dot is not identifiable by its own
  // class. It is identifiable by interactivity: placed nodes are interactive
  // and get the .leaflet-interactive class, the transient cursor dot is not.
  const cursor = () =>
    document.querySelector(".foliplus-measure-node:not(.leaflet-interactive)");
  // Nothing to cursor at yet: entering the mode must not float a dot.
  const idle = document.querySelectorAll(".foliplus-measure-node").length === 0;

  // Two vertices, so the preview fill renders alongside the outline.
  map.fire("click", { latlng: L.latLng(26.08, 119.3) });
  map.fire("click", { latlng: L.latLng(26.085, 119.305) });
  map.invalidateSize();
  // Renderer root sibling order == paint order (later siblings paint above).
  const stack = el => {
    const svg = el && el.closest("svg");
    const root = svg ? svg.querySelector("g") || svg : null;
    const sibs = root ? Array.from(root.children) : [];
    const idx = name => {
      const e = sibs.find(e => e.classList && e.classList.contains(name));
      return e ? sibs.indexOf(e) : -1;
    };
    return {
      preview: idx("foliplus-measure-path-preview"),
      dashed: idx("foliplus-measure-path-dashed"),
      fill: idx("foliplus-measure-shape-fill"),
      node: sibs.indexOf(el),
    };
  };
  // First mousemove: the cursor dot must be created and positioned here.
  map.fire("mousemove", { latlng: L.latLng(26.09, 119.31) });
  const r1 = cursor()?.getBoundingClientRect();
  // Second mousemove: the node must follow the cursor. It is recreated each
  // frame (see PreviewMode.moveCursorNode) so the DOM node identity changes —
  // only the visual position and the "still exactly one dot" invariant hold.
  map.fire("mousemove", { latlng: L.latLng(26.095, 119.315) });
  const r2 = cursor()?.getBoundingClientRect();
  const dotsAfterTwo = document.querySelectorAll(
    ".foliplus-measure-node:not(.leaflet-interactive)",
  ).length;
  const s = stack(cursor());
  // Third mousemove: the recreated node must still sit above the preview
  // fill in DOM order — the old in-place `setLatLng` path let the fill climb
  // over it because `setLatLngs` re-sorts the SVG root but `setLatLng` does
  // not. Recreating keeps "newest sibling wins" as the only rule.
  map.fire("mousemove", { latlng: L.latLng(26.096, 119.316) });
  const dotsAfterThree = document.querySelectorAll(
    ".foliplus-measure-node:not(.leaflet-interactive)",
  ).length;
  const s2 = stack(cursor());
  // Right-click with fewer than 3 points cancels: preview node must be removed.
  map.fire("contextmenu", { latlng: L.latLng(26.095, 119.315) });
  return {
    idle,
    created: !!r1,
    x1: r1?.x ?? null,
    y1: r1?.y ?? null,
    x2: r2?.x ?? null,
    y2: r2?.y ?? null,
    dotsAfterTwo,
    dotsAfterThree,
    stack: s,
    stackAfterThirdMove: s2,
    removedAfterFinish: !cursor(),
  };
};
