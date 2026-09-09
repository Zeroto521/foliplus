async () => {
  const map = window.__map;
  const mm = window.__measureManager;
  const svgOf = paneName => {
    const pane = map.getPane(paneName);
    return pane ? pane.querySelector("svg") : null;
  };
  const pathsIn = paneName =>
    svgOf(paneName) ? Array.from(svgOf(paneName).querySelectorAll("path")) : [];
  const isNode = p => p.classList.contains("foliplus-measure-node");
  const isSolid = p => p.classList.contains("foliplus-measure-node-solid");
  const z = name => {
    const el = map.getPane(name);
    return el ? parseInt(el.style.zIndex, 10) : NaN;
  };

  const snapshot = () => {
    const all = pathsIn("measure_node");
    const nodes = all.filter(isNode);
    // Sibling order among all paths in the node pane is the paint order.
    const idx = p => all.indexOf(p);
    const solid = nodes.find(isSolid);
    const hollow = nodes.find(p => !isSolid(p));
    return {
      graphZ: z("measure_graph"),
      nodeZ: z("measure_node"),
      labelZ: z("measure_label"),
      graphHasNode: pathsIn("measure_graph").some(isNode),
      graphHasShape: pathsIn("measure_graph").some(p =>
        p.classList.contains("foliplus-measure-path"),
      ),
      nodePane: {
        total: nodes.length,
        solid: !!solid,
        hollow: !!hollow,
        solidBeforeHollow: !!solid && !!hollow && idx(solid) < idx(hollow),
        classes: nodes.map(p => p.getAttribute("class")),
      },
    };
  };

  mm.setMode("circle");
  // Center first: this is the attach whose slot in the graph pane would be
  // permanently first for the rest of the session.
  map.fire("click", { latlng: L.latLng(26.08, 119.3) });
  map.invalidateSize();
  map.fire("mousemove", { latlng: L.latLng(26.085, 119.305) });
  map.fire("mousemove", { latlng: L.latLng(26.09, 119.31) });
  map.invalidateSize();

  const duringDraw = snapshot();

  // Finish the circle: the final center replaces the preview one and the
  // finalized radius node joins the node pane.
  map.fire("click", { latlng: L.latLng(26.09, 119.31) });
  map.invalidateSize();
  // finishCircle runs on a timer (FINALIZE_DELAY), so snapshot only after it
  // lands — otherwise the node pane is caught mid-teardown.
  await new Promise(resolve => setTimeout(resolve, 300));

  return { duringDraw, after: snapshot() };
};
