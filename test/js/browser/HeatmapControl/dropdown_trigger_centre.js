// Real-mouse press on the first dropdown trigger (Layer select) inside the
// heatmap panel, returning its centre. Used to prove opening a portalled
// dropdown does not collapse the host fold panel.
() => {
  const row = document.querySelector(
    ".foliplus-heatmap-ctrl select[data-heatmap-layer]",
  );
  if (!row) return null;
  const trg = row
    .closest(".foliplus-form-row")
    ?.querySelector(".foliplus-dropdown-trigger");
  if (!trg) return null;
  const r = trg.getBoundingClientRect();
  return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
};
