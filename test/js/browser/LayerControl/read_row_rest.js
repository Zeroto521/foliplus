// Reads the resting visual state of the first row (bg / shadow / drag-handle
// opacity). No .foliplus-active read — used when the row is expected to be
// inactive (e.g. after cancel).
() => {
  const r = document.querySelector(".foliplus-layer-item");
  const cs = getComputedStyle(r);
  const d = r.querySelector(".drag-handle");
  return {
    bg: cs.backgroundColor,
    shadow: cs.boxShadow,
    drag: d ? getComputedStyle(d).opacity : null,
  };
};
