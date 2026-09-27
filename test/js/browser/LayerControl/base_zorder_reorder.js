// Base-group reorder gate: every base basemap (tile + color) must repaint
// when its row moves.
//
// The tier the ladder writes must be the tier that paints: each base layer
// owns a synthesized pane (or the color pane) that carries its tiles/canvas,
// NOT the shared `.leaflet-tile-pane` (whose z is fixed at 200 by Leaflet's
// CSS). This helper reads each base layer's own pane z and supports
// reordering between two tile basemaps.
//
// Driver: window.__probe = { action: "read" | "swap-tiles" }
//   read  — per-base layer pane z + where its tiles live (default)
//   swap-tiles — put the last base layer above the first base layer
() => {
  const spec = window.__probe || { action: "read" };
  delete window.__probe;
  const ctrl = window.__layerCtrl;
  if (!ctrl) return { error: "ctrl missing" };
  const m = ctrl.m;

  const tilePane = document.querySelector(".leaflet-tile-pane");
  const read = () => {
    m.enforceOrder();
    const bases = [];
    for (const li of m.layers) {
      if (!li.isBase) continue;
      const surface = m.surfaceFor(li);
      const el = surface && surface.panes[0] ? surface.panes[0].element : null;
      bases.push({
        id: li.id,
        name: li.name,
        z: el ? parseInt(getComputedStyle(el).zIndex, 10) || null : null,
        paintsHere: el ? el.querySelectorAll("img, canvas").length : 0,
      });
    }
    return {
      bases,
      sharedTilePaneImages: tilePane ? tilePane.querySelectorAll("img").length : -1,
    };
  };

  if (spec.action === "swap-tiles") {
    const tileIds = m.layers
      .filter(l => l.isBase && l.id !== "foliplus_color_map")
      .map(l => l.id);
    if (tileIds.length < 2) return { error: `need two tile basemaps, got ${tileIds}` };
    const from = m.layerRegistry.get(tileIds[tileIds.length - 1]);
    const to = m.layerRegistry.get(tileIds[0]);
    const fromIdx = m.layerRegistry.indexOf(from);
    const toIdx = m.layerRegistry.indexOf(to);
    m.layerRegistry.reorder(fromIdx, toIdx);
    m.enforceOrder();
    return { ok: true, ...read() };
  }

  return { ok: true, ...read() };
};
