// Row lookup: handleDrop must resolve the drop target by data-layer-id, not by
// its DOM position.
//
// Swap alpha's and beta's ROWS in the DOM (registry stays doc-derived), then
// drag alpha onto beta. By id, beta is a real target. By DOM position, beta's
// row now sits at alpha's own index, which handleDrop would read as a self-drop
// and abort, leaving the registry behind the panel.
() => {
  const m = window.__layerCtrl.mgr;
  if (!m || !m.ui) throw new Error("__layerCtrl / manager ui missing");
  const ui = m.ui;
  if (typeof ui.onDrop !== "function") {
    throw new Error("ui.onDrop not wired — panel never attached");
  }
  const rowById = id =>
    ui.uiContainer.querySelector(`.foliplus-layer-item[data-layer-id="${id}"]`);
  // All layer rows including the color basemap — it is now a registry member.
  const dataRows = () => [...ui.uiContainer.querySelectorAll(".foliplus-layer-item")];

  m.registerLayer({ id: "alpha", name: "A", layer: new L.LayerGroup() });
  m.registerLayer({ id: "beta", name: "B", layer: new L.LayerGroup() });
  m.registerLayer({ id: "gamma", name: "C", layer: new L.LayerGroup() });

  const regIdx = id => m.layers.findIndex(l => l.id === id);
  const domIds = () => dataRows().map(e => e.dataset.layerId);

  const alphaRow = rowById("alpha");
  const betaRow = rowById("beta");
  if (!alphaRow || !betaRow) throw new Error("alpha/beta rows missing");
  // Swap the two rows' DOM positions only; the registry keeps its doc order.
  // One insert moves beta ahead of alpha, yielding [.., beta, alpha, ..].
  const parent = alphaRow.parentNode;
  parent.insertBefore(betaRow, alphaRow);

  const beforeRegistry = m.layers.map(l => l.id);
  const domOrder = domIds();
  // The precondition that makes a positional lookup wrong: beta's row now sits
  // at alpha's registry index, so a DOM-position read reports a self-drop.
  if (domOrder[regIdx("alpha")] !== "beta" || domOrder[regIdx("beta")] !== "alpha") {
    throw new Error(
      `no usable DOM/registry divergence (dom ${JSON.stringify(domOrder)}, registry ${JSON.stringify(beforeRegistry)})`,
    );
  }

  // Drag alpha onto beta's row. The session is armed with the registry entry
  // itself — the drop re-resolves its position, so the swapped DOM cannot
  // re-point the move at a neighbor.
  ui.listPanel.dragEntry = m.layers[regIdx("alpha")];
  ui.onDrop({
    target: betaRow,
    preventDefault: () => {},
    dataTransfer: { effectAllowed: "", dropEffect: "" },
  });

  const afterRegistry = m.layers.map(l => l.id);
  return {
    beforeRegistry,
    afterRegistry,
    domIds: domIds(),
    // handleDrop must have resolved beta by id and moved the registry. The
    // DOM-position read reports beta at alpha's own index and aborts as a
    // self-drop, leaving the registry untouched.
    registryMoved: afterRegistry.join(",") !== beforeRegistry.join(","),
    // Panel and registry must agree once the drop has settled.
    panelMatchesRegistry: domIds().join(",") === afterRegistry.join(","),
    dragDisarmed: ui.listPanel.dragEntry === null,
  };
};
