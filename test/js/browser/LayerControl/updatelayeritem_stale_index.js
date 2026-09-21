// Row lookup: updateLayerItem must resolve the row by data-layer-id, not by the
// layer's registry index.
//
// Reorder the registry so a neighbour sits at alpha's registry index, then
// rename alpha in place. An index-based lookup would have written the new name
// into whoever is at that position.
() => {
  const m = window.__layerCtrl.m;
  if (!m || !m.ui) throw new Error("__layerCtrl / manager ui missing");
  const ui = m.ui;
  const rowById = id =>
    ui.uiContainer.querySelector(`.foliplus-layer-item[data-layer-id="${id}"]`);
  const labelOf = id => rowById(id)?.querySelector("label").textContent;

  m.registerLayer({ id: "alpha", name: "A", layer: new L.LayerGroup() });
  m.registerLayer({ id: "beta", name: "B", layer: new L.LayerGroup() });
  m.registerLayer({ id: "gamma", name: "C", layer: new L.LayerGroup() });

  const regIdx = id => m.layers.findIndex(l => l.id === id);
  // Move beta ahead of alpha in the registry only; the rows keep their DOM
  // order. reorder goes through the method — the registry's view is read-only.
  m.layerRegistry.reorder(regIdx("beta"), regIdx("alpha"));

  const domOrder = [...ui.uiContainer.querySelectorAll(".foliplus-layer-item")].map(
    e => e.dataset.layerId,
  );
  const alphaIdx = regIdx("alpha");
  if (domOrder[alphaIdx] === "alpha") {
    throw new Error(
      "no registry/DOM divergence for alpha (dom " +
        JSON.stringify(domOrder) +
        ", registry " +
        JSON.stringify(m.layers.map(l => l.id)) +
        ")",
    );
  }

  m.layerRegistry.byId.get("alpha").name = "A2";
  ui.updateLayerItem(m.layerRegistry.byId.get("alpha"));

  return {
    alphaRegistryIndex: alphaIdx,
    alphaDomIndex: domOrder.indexOf("alpha"),
    labels: {
      alpha: labelOf("alpha"),
      beta: labelOf("beta"),
      gamma: labelOf("gamma"),
    },
    // The layer whose row sat at alpha's registry index — the one an
    // index-based lookup would have rewritten.
    staleIndexWouldHaveHit: labelOf(domOrder[alphaIdx]),
  };
};
