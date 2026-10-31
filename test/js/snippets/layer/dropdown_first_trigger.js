() => {
  const drawer = document.querySelector(".foliplus-layer-style-panel");
  const el = drawer ? drawer.querySelector(".foliplus-dropdown-trigger") : null;
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
};
