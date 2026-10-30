// Active-row state: grip / more-button color / glow (boxShadow). Used to
// verify the row is visibly lit.
() => {
  const r = document.querySelector(".foliplus-layer-item.foliplus-active");
  return {
    grip: getComputedStyle(r.querySelector(".foliplus-drag-cell .drag-handle")).opacity,
    more: getComputedStyle(r.querySelector(".foliplus-layer-more-btn")).color,
    glow: getComputedStyle(r).boxShadow !== "none",
  };
};
