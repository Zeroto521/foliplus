// Drag the bottom root onto the top root's row and compare the panel row
// order against the registry (the stale row-order bug). The block order is seeded with the
// folder key + both roots LISTED, so the stale order the bug leaves behind is
// reproduced: a registry reorder reprices z but a panel reading the block
// order keeps the old rows.
() => {
  const m = window.__layerCtrl.mgr;
  if (!m || !m.ui) throw new Error("__layerCtrl / manager ui missing");
  const ui = m.ui;
  if (typeof ui.onDrop !== "function") {
    throw new Error("ui.onDrop not wired — panel never attached");
  }
  const rowById = id =>
    ui.uiContainer.querySelector(`.foliplus-layer-item[data-layer-id="${id}"]`);
  const rootRows = () =>
    [...ui.uiContainer.querySelectorAll(".foliplus-layer-item")]
      .map(e => e.dataset.layerId)
      .filter(id => id && id.startsWith("root"));

  m.registerLayer({ id: "root1", name: "Root1", layer: new L.LayerGroup() });
  m.registerLayer({ id: "root2", name: "Root2", layer: new L.LayerGroup() });

  const beforeRegistry = m.layers.map(l => l.id).filter(id => id.startsWith("root"));
  const beforeDom = rootRows();

  // Drag root2 onto root1's row: onDrop routes to reorderLayer(root2, root1).
  ui.listPanel.dragEntry = m.layers.find(l => l.id === "root2");
  ui.onDrop({
    target: rowById("root1"),
    preventDefault: () => {},
    dataTransfer: { effectAllowed: "", dropEffect: "" },
  });

  const afterRegistry = m.layers.map(l => l.id).filter(id => id.startsWith("root"));
  const afterDom = rootRows();
  return {
    beforeDom,
    beforeRegistry,
    afterRegistry,
    afterDom,
    panelMatchesRegistry: afterDom.join(",") === afterRegistry.join(","),
    zOrderChanged: afterRegistry.join(",") !== beforeRegistry.join(","),
  };
};
