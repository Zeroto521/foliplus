() => {
  const panel = document.querySelector(".foliplus-panel-content");
  if (!panel) return null;
  const item = panel.querySelector(".foliplus-layer-item");
  if (!item) return null;
  // Focus via double-click on the layer row (the documented entry that
  // draws the focus rectangle).
  item.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
  const rect = document.querySelector("path.foliplus-focus-rect");
  if (!rect) return { rectDrawn: false };
  const cs = getComputedStyle(rect);
  return {
    rectDrawn: true,
    // Marching-ants look: accent stroke + shared dash rhythm + the march
    // animation. Values come from the live cascade so a broken token or a
    // reverted rule fails here instead of only in a human eye.
    stroke: cs.stroke,
    strokeWidth: cs.strokeWidth,
    strokeDasharray: cs.strokeDasharray,
    animationName: cs.animationName,
    fill: cs.fill,
  };
};
