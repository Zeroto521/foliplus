// Reads the resting state of the first row: bg/shadow/drag-handle opacity +
// whether the row carries the .foliplus-active cursor class.
() => {
  const r = document.querySelector(".foliplus-layer-item");
  const cs = getComputedStyle(r);
  const d = r.querySelector(".drag-handle");
  return {
    bg: cs.backgroundColor,
    shadow: cs.boxShadow,
    drag: d ? getComputedStyle(d).opacity : null,
    active: r.classList.contains("foliplus-active"),
  };
};
