() => {
  const ctrl = document.querySelector(".foliplus-heatmap-ctrl");
  return [...ctrl.querySelectorAll(".foliplus-dropdown-trigger")].map((el, i) => {
    const r = el.getBoundingClientRect();
    const row = el.closest(".foliplus-form-row");
    return {
      i,
      name: (el.getAttribute("aria-label") || el.textContent || "").trim(),
      x: Math.round(r.left + r.width / 2),
      y: Math.round(r.top + r.height / 2),
      w: Math.round(r.width),
      hidden: row ? !!row.closest(".foliplus-hidden") : false,
    };
  });
};
