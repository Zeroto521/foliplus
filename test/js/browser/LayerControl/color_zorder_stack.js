// Color z-order stack acceptance gate.
//
// The color basemap is a first-class base-group layer with its own pane.
// Row order = visual stack order: dragging the color row above a tile
// basemap makes the color pane paint over the tiles; below, the tiles
// cover it. This helper reads the actual pane z-indexes from the DOM and
// supports reordering.
//
// Driver: window.__probe = { action: "read" | "above" | "below" }
//   read  — return current z-indexes and layer order (default)
//   above — move the color layer to index 0 (topmost), enforce, re-read
//   below — move the color layer to the last index, enforce, re-read
() => {
  const spec = window.__probe || { action: "read" };
  delete window.__probe;
  const ctrl = window.__layerCtrl;
  const map = window.map;
  if (!ctrl || !map) return { error: "ctrl or map missing" };
  const m = ctrl.m;

  // Read the z-index of a pane by its class prefix.
  const zOfPaneWithPrefix = prefix => {
    const pane = Array.from(document.querySelectorAll(".leaflet-pane")).find(p =>
      p.className.includes(prefix),
    );
    return pane ? parseInt(getComputedStyle(pane).zIndex, 10) || null : null;
  };

  // Reorder: move the color layer above or below the tile basemaps.
  if (spec.action === "above" || spec.action === "below") {
    const colorLi = m.layerRegistry.get("foliplus_color_map");
    if (!colorLi) return { error: "color layer not registered" };
    const colorIdx = m.layerRegistry.indexOf(colorLi);
    if (spec.action === "above") {
      m.layerRegistry.reorder(colorIdx, 0);
    } else {
      // Move to the last index among base layers.
      const baseCount = m.layers.filter(l => l.isBase).length;
      const lastBaseIdx = m.layerRegistry.indexOf(m.layers[baseCount - 1]);
      m.layerRegistry.reorder(colorIdx, lastBaseIdx);
    }
    m.enforceOrder();
  }

  // Read the layer order.
  const baseLayers = m.layers
    .map((l, i) => ({ idx: i, id: l.id, name: l.name, isBase: l.isBase }))
    .filter(l => l.isBase);

  // Find the tile basemap.
  const tileLi = m.layers.find(l => l.isBase && l.id !== "foliplus_color_map");

  // Force the ladder to be applied before reading. Without this the panes
  // carry Leaflet's CSS default (.leaflet-pane = 400), not the ladder z.
  m.enforceOrder();

  // Read pane z-indexes from the DOM.
  // Color pane: class includes "foliplus-color-"
  const colorPaneZ = zOfPaneWithPrefix("foliplus-color-");

  // Tile pane: the tile layer gets a fallback pane (foliplus-pane-{stamp}).
  // Find the pane that is NOT the color pane and NOT a shared Leaflet pane.
  let tilePaneZ = null;
  if (tileLi) {
    const panes = Array.from(document.querySelectorAll(".leaflet-pane"));
    const tilePanes = panes.filter(
      p =>
        p.className.includes("foliplus-layer-pane") &&
        !p.className.includes("foliplus-color-"),
    );
    if (tilePanes.length > 0) {
      tilePaneZ = parseInt(getComputedStyle(tilePanes[0]).zIndex, 10) || null;
    }
  }

  return {
    ok: true,
    action: spec.action,
    colorPaneZ,
    tilePaneZ,
    colorPaneFound: colorPaneZ !== null,
    tilePaneFound: tilePaneZ !== null,
    baseOrder: baseLayers,
  };
};
