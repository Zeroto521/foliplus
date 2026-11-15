// Reads the pinned style panel's box against the map, its anchor row and the
// inline width cap.
//
// Proves the card's horizontal policy end to end: right-aligned with its row
// while there is room, shrunk to the map's 8px edge inset on a narrow map, and
// still flipping above its row on a short map. Geometry only — no writes.
() => {
  const rect = el => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return {
      top: r.top,
      left: r.left,
      right: r.right,
      bottom: r.bottom,
      width: r.width,
      height: r.height,
    };
  };
  const row = document.querySelector(".foliplus-layer-item[data-layer-type=overlay]");
  const panel = row ? row.querySelector(".foliplus-layer-style-panel") : null;
  return {
    viewport: { width: innerWidth, height: innerHeight },
    map: rect(document.querySelector(".leaflet-container")),
    row: rect(row),
    panel: rect(panel),
    maxWidth: panel ? panel.style.maxWidth : null,
    flipped: panel ? panel.classList.contains("foliplus-row-panel-up") : null,
    cap: panel ? panel.style.getPropertyValue("--foliplus-row-panel-max-height") : null,
  };
};
