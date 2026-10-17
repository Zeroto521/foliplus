// Reads every row's composite state: bg, glow, drag-handle opacity, more
// button colour, type-icon colour.
() =>
  [...document.querySelectorAll(".foliplus-layer-item")].map(r => {
    const cs = getComputedStyle(r);
    const g = r.querySelector(".foliplus-drag-cell .drag-handle");
    const m = r.querySelector(".foliplus-layer-more-btn");
    const i = r.querySelector(".foliplus-type-icon-col");
    return {
      bg: cs.backgroundColor,
      glow: cs.boxShadow !== "none",
      grip: g ? getComputedStyle(g).opacity : null,
      more: m ? getComputedStyle(m).color : null,
      icon: i ? getComputedStyle(i).color : null,
    };
  });
