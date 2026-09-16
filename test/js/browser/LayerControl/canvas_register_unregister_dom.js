() => {
  const api = window.map.foliplus && window.map.foliplus.LayerAPI;
  if (!api) return null;
  const id = "__test_canvas_reg__";
  const paneName = "foliplus-canvas-" + id;
  const cvs = api.createCanvas({ id, name: "Canvas Test" });
  cvs.register();

  // Pane model: canvas lives in its own foliplus-layer-pane, registered on the map.
  const pane = window.map.getPane(paneName);
  const inPane = !!pane && pane.classList.contains("foliplus-layer-pane");
  const canvasParent = cvs.canvas.parentElement === pane;

  // After register, enforceOrder (debounced) or setZIndex must be able to
  // z-order the pane. Drive setZIndex directly so the assertion is not
  // racing the debounce.
  cvs.setZIndex(640);
  const paneZ = pane ? pane.style.zIndex : null;

  const item = document.querySelector(`[data-layer-id="${id}"]`);
  const hasItem = !!item;
  const info = api.layers.find(l => l.id === id);
  const registeredPaneName = info ? info.paneName : null;

  cvs.unregister();
  const itemAfter = document.querySelector(`[data-layer-id="${id}"]`);
  // unregister keeps the pane for re-register; destroy is what drops it.
  const paneAfterUnregister = !!window.map.getPane(paneName);
  cvs.destroy();
  const paneAfterDestroy = !!window.map.getPane(paneName);

  return {
    hasItem,
    hasItemAfter: !!itemAfter,
    inPane,
    canvasParent,
    paneZ,
    registeredPaneName,
    paneAfterUnregister,
    paneAfterDestroy,
  };
};
