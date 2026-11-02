// Measures the open style panel against the map's visible area.
() => {
  const panel = document.querySelector(".foliplus-layer-style-panel");
  if (!panel) return { ok: false, reason: "panel-missing" };
  const row = panel.closest(".foliplus-layer-item");
  if (!row) return { ok: false, reason: "row-missing" };
  const mapEl = document.querySelector(".leaflet-container");
  if (!mapEl) return { ok: false, reason: "map-missing" };
  const pr = panel.getBoundingClientRect();
  const mr = mapEl.getBoundingClientRect();
  const rr = row.getBoundingClientRect();
  const cs = getComputedStyle(panel);
  return {
    ok: true,
    panel: {
      top: pr.top,
      bottom: pr.bottom,
      height: pr.height,
      scrollHeight: panel.scrollHeight,
      clientHeight: panel.clientHeight,
      cssMaxHeight: cs.maxHeight,
      topCss: cs.top,
      bottomCss: cs.bottom,
    },
    row: { top: rr.top, bottom: rr.bottom },
    map: { top: mr.top, bottom: mr.bottom, height: mr.height },
    flipUp: panel.classList.contains("foliplus-row-panel-up"),
  };
};
