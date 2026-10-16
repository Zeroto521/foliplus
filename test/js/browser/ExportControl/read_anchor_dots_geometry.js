() => {
  const handle = document.querySelector(".foliplus-export-handle");
  const center = document.querySelector(".foliplus-export-center");
  const measure = (el) => {
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return {
      boxSizing: cs.boxSizing,
      w: r.width,
      h: r.height,
      border: parseFloat(cs.borderTopWidth),
    };
  };
  return { handle: measure(handle), center: measure(center) };
};
