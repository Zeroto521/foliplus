// The point at the overlay's center must resolve to the overlay itself —
// a lit sibling would paint over it and break hit-testing.
sel => {
  const el = document.querySelector(sel);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
  return hit ? !!hit.closest(sel) : null;
};
