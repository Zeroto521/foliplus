() => {
  const panel = document.querySelector(".foliplus-panel-content");
  if (!panel) return null;
  const item = panel.querySelector(
    ".foliplus-layer-item:not(.foliplus-color-layer-item)",
  );
  if (!item) return null;
  // Focus via double-click on the layer row (a documented entry point).
  item.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
  // The focus rectangle + inverse mask render on the map as SVG paths.
  const rect = document.querySelector("path.foliplus-focus-rect");
  const mask = document.querySelector("path.foliplus-focus-mask");
  return {
    rectDrawn: rect !== null,
    maskDrawn: mask !== null,
    rowHighlighted: item.classList.contains("foliplus-layer-focusing"),
  };
};
