() => {
  const api = window.map.foliplus && window.map.foliplus.LayerAPI;
  if (!api) return null;
  const cvs = api.createCanvas({ id: "__test_canvas__" });
  // Method shape is readable at create; the pane is born at register() —
  // the factory prices a canvas pane at its slot (#509), so the pane
  // assertions below only make sense after register.
  const shape = {
    hasCanvas: !!cvs.canvas,
    hasCtx: !!cvs.ctx,
    hasResize: typeof cvs.resize === "function",
    hasDestroy: typeof cvs.destroy === "function",
    hasUpdatePosition: typeof cvs.updatePosition === "function",
    hasSetVisible: typeof cvs.setVisible === "function",
    hasGetSize: typeof cvs.getSize === "function",
    canvasTag: cvs.canvas.tagName,
    canvasClass: cvs.canvas.classList.contains("foliplus-canvas-layer"),
  };
  cvs.register();
  const pane = cvs.canvas.parentElement;
  const paneName = "foliplus-canvas-__test_canvas__";
  return {
    ...shape,
    parentIsPane: !!pane && pane.classList.contains("foliplus-layer-pane"),
    paneRegistered: !!window.map.getPane(paneName),
    paneName,
  };
};
