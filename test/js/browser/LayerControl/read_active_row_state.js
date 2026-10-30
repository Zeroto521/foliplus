// Active-row state: grip / more-button color / bg color (not glow). Used
// when asserting the row is on a specific surface.
() => {
  const r = document.querySelector(".foliplus-layer-item.foliplus-active");
  return {
    grip: getComputedStyle(r.querySelector(".foliplus-drag-cell .drag-handle")).opacity,
    more: getComputedStyle(r.querySelector(".foliplus-layer-more-btn")).color,
    bg: getComputedStyle(r).backgroundColor,
  };
};
