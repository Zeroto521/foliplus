// ROW-cursor wake of a sibling row (glow + drag grip) — the row's own state
// display. Nothing may suppress it.
([idx, rowSel]) => {
  const r = document.querySelectorAll(rowSel)[idx];
  if (!r) return null;
  const cs = getComputedStyle(r);
  const g = r.querySelector(".foliplus-drag-cell .drag-handle");
  return {
    glow: cs.boxShadow !== "none",
    grip: g ? getComputedStyle(g).opacity : null,
  };
};
