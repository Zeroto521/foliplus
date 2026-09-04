// Report which panes the polygon centroid dot / label / del icon live in, the
// z-index of each pane they belong to, and whether the dot is hit-testable.
// A dot that lands in the graph pane sits behind the label (whose pane z
// enforces its own stacking) and the area label's pane z is re-written on
// every layer-order pass — that is what can bury the dot under the fill.
() => {
  const map = window.__map;
  const report = el => {
    const icon = el._icon || el;
    const rect = icon.getBoundingClientRect();
    const cx = rect.x + rect.width / 2;
    const cy = rect.y + rect.height / 2;
    const under = document.elementFromPoint(cx, cy);
    return {
      graph: icon.closest(".leaflet-measure_graph-pane") ? "graph" : null,
      label: icon.closest(".leaflet-measure_label-pane") ? "label" : null,
      graphZ: icon.closest(".leaflet-measure_graph-pane")
        ? icon.closest(".leaflet-measure_graph-pane").style.zIndex
        : null,
      labelZ: icon.closest(".leaflet-measure_label-pane")
        ? icon.closest(".leaflet-measure_label-pane").style.zIndex
        : null,
      iconZ: icon.style.zIndex || null,
      hit: under ? under.className.toString().split(" ").join(".") : null,
      above: document
        .elementsFromPoint(cx, cy)
        .map(e => e.className.toString().split(" ").join(".")),
    };
  };

  const mm = window.__measureManager;
  const out = {
    items: [],
    mapSize: [map.getSize().x, map.getSize().y],
    center: mm.measurements[0] ? mm.measurements[0].center : null,
  };
  const center = out.center;
  const allMarkers = (function walk(group) {
    const out = [];
    const layers = group.getLayers ? group.getLayers() : [];
    layers.forEach(l => out.push(...(l instanceof L.LayerGroup ? walk(l) : [l])));
    return out;
  })(mm.layers.mainLayer);
  const markers = center
    ? allMarkers.filter(l => {
        if (!(l instanceof L.Marker)) return false;
        const p = l.getLatLng();
        return (
          Math.abs(p.lat - center.lat) < 1e-9 && Math.abs(p.lng - center.lng) < 1e-9
        );
      })
    : [];
  markers.forEach(m => {
    // The icon element carries the dot class; a label marker's icon is a
    // blank divIcon and the label class lives on its child chip div.
    const el = m.getElement();
    const cls = (
      (el && (el.querySelector(".foliplus-measure-label") || el).className) ||
      ""
    ).toString();
    out.items.push({ cls, ...report(m) });
  });
  return out;
};
