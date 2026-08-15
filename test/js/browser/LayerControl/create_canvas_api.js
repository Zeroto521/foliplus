() => {
  const api = window.map.foliplus && window.map.foliplus.LayerAPI;
  if (!api) return null;
  const cvs = api.createCanvas({ id: "__test_canvas__" });
  return {
    hasCanvas: !!cvs.canvas,
    hasCtx: !!cvs.ctx,
    hasResize: typeof cvs.resize === "function",
    hasDestroy: typeof cvs.destroy === "function",
    hasUpdatePosition: typeof cvs.updatePosition === "function",
    hasSetZIndex: typeof cvs.setZIndex === "function",
    hasSetVisible: typeof cvs.setVisible === "function",
    hasGetSize: typeof cvs.getSize === "function",
    canvasTag: cvs.canvas.tagName,
  };
};
