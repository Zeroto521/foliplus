() => {
  const btn = document.querySelector(".foliplus-layer-ctrl .foliplus-toggle-btn");
  if (!btn) return "no-panel";
  if (!btn.closest(".foliplus-layer-ctrl").classList.contains("expanded")) btn.click();
  return btn.closest(".foliplus-layer-ctrl").classList.contains("expanded");
};
