() => {
  const ctrl = document.querySelector(".foliplus-layer-ctrl");
  if (!ctrl) return { error: "layer control not found" };
  const closeBtn = ctrl.querySelector(".foliplus-close-btn");
  const icon = ctrl.querySelector(".foliplus-header-icon");
  if (!closeBtn) return { error: "close button not found" };
  if (!icon) return { error: "header icon not found" };
  const r1 = closeBtn.getBoundingClientRect();
  const r2 = icon.getBoundingClientRect();
  const closeY = r1.top + r1.height / 2;
  const iconY = r2.top + r2.height / 2;
  return {
    closeY,
    iconY,
    deltaPx: closeY - iconY,
    closeH: r1.height,
    iconH: r2.height,
  };
};
