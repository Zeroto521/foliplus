// Row lookup: handleDrop must resolve the drop target by data-layer-id, not by
// its DOM position.
//
// Reorder the registry so beta sits at a registry index different from its DOM
// position, then drag alpha onto beta. By id, beta is past alpha — a real
// forward move. By DOM position beta reads as alpha's own index, which
// handleDrop treats as a self-drop and aborts, leaving the registry behind the
// panel.
() => {
  const m = window.__layerCtrl.m;
  if (!m || !m.ui) throw new Error("__layerCtrl / manager ui missing");
  const ui = m.ui;
  if (typeof ui.onDrop !== "function") {
    throw new Error("ui.onDrop not wired — panel never attached");
  }
  const rowById = id =>
    ui.uiContainer.querySelector(`.foliplus-layer-item[data-layer-id="${id}"]`);
  // The color basemap row has no registry entry, so it is excluded from every
  // order comparison.
  const dataRows = () =>
    [...ui.uiContainer.querySelectorAll(".foliplus-layer-item")].filter(
      e => !e.classList.contains("foliplus-color-layer-item"),
    );

  m.registerLayer({ id: "alpha", name: "A", layer: new L.LayerGroup() });
  m.registerLayer({ id: "beta", name: "B", layer: new L.LayerGroup() });
  m.registerLayer({ id: "gamma", name: "C", layer: new L.LayerGroup() });

  const regIdx = id => m.layers.findIndex(l => l.id === id);
  const domIds = () => dataRows().map(e => e.dataset.layerId);

  // Move beta ahead of alpha in the registry only; the rows keep their DOM
  // order. reorder goes through the method — the registry's view is read-only.
  m.layerRegistry.reorder(regIdx("beta"), regIdx("alpha"));

  const beforeRegistry = m.layers.map(l => l.id);
  const domOrder = domIds();
  const betaIdx = regIdx("beta");
  // The precondition that makes a positional lookup wrong: the row sitting at
  // beta's registry index is a different layer, and beta's own DOM position is
  // alpha's registry index — so a DOM-position read reports a self-drop.
  if (domOrder[betaIdx] === "beta" || domOrder.indexOf("beta") !== regIdx("alpha")) {
    throw new Error(
      "no usable registry/DOM divergence (dom " +
        JSON.stringify(domOrder) +
        ", registry " +
        JSON.stringify(beforeRegistry) +
        ")",
    );
  }

  // Drag alpha (registry idx of alpha) onto beta.
  ui.dragIdx = regIdx("alpha");
  ui.onDrop({
    target: rowById("beta"),
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
    dragDisarmed: ui.dragIdx === null,
  };
};
