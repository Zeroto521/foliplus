// Row lookup: initLayerItem must resolve the row by data-layer-id, not by the
// layer's registry index.
//
// initLayerItem writes the layer name into the row's checkbox aria-label.
// Reorder the registry so a neighbour sits at alpha's registry index, then run
// initLayerItem for alpha: an index-based lookup would have stamped alpha's
// name into the checkbox of whatever layer is at that position.
() => {
  const m = window.__layerCtrl.m;
  if (!m || !m.ui) throw new Error("__layerCtrl / manager ui missing");
  const ui = m.ui;
  const rowById = id =>
    ui.uiContainer.querySelector(`.foliplus-layer-item[data-layer-id="${id}"]`);
  const boxOf = id => rowById(id)?.querySelector('input[type="checkbox"]');

  m.registerLayer({ id: "alpha", name: "A", layer: new L.LayerGroup() });
  m.registerLayer({ id: "beta", name: "B", layer: new L.LayerGroup() });
  m.registerLayer({ id: "gamma", name: "C", layer: new L.LayerGroup() });

  // Move beta ahead of alpha in the registry only; the rows keep their DOM
  // order. reorder must go through the method — the registry's view is
  // read-only, so an array assignment would not move the id index either.
  const regIdx = id => m.layers.findIndex(l => l.id === id);
  m.layerRegistry.reorder(regIdx("beta"), regIdx("alpha"));

  const domOrder = [...ui.uiContainer.querySelectorAll(".foliplus-layer-item")].map(
    e => e.dataset.layerId,
  );
  const domPos = id => domOrder.indexOf(id);
  const alphaIdx = regIdx("alpha");
  // The precondition that makes a positional lookup wrong: the row sitting at
  // alpha's registry index is a different layer.
  if (domOrder[alphaIdx] === "alpha") {
    throw new Error(
      "no registry/DOM divergence for alpha (dom " +
        JSON.stringify(domOrder) +
        ", registry " +
        JSON.stringify(m.layers.map(l => l.id)) +
        ")",
    );
  }

  ui.initLayerItem(m.layerRegistry.byId.get("alpha"));

  return {
    alphaRegistryIndex: alphaIdx,
    alphaDomIndex: domPos("alpha"),
    labels: {
      alpha: boxOf("alpha")?.getAttribute("aria-label"),
      beta: boxOf("beta")?.getAttribute("aria-label"),
      gamma: boxOf("gamma")?.getAttribute("aria-label"),
    },
    // The layer whose row sat at alpha's registry index — the one an
    // index-based lookup would have rewritten.
    staleIndexWouldHaveHit: boxOf(domOrder[alphaIdx])?.getAttribute("aria-label"),
    // initLayerItem declines ids the registry does not know about.
    unknownReturnsFalse: ui.initLayerItem({ id: "__no_such_layer__" }),
  };
};
