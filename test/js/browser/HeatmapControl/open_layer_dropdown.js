// Opens the Heatmap layer dropdown (the panel's layer row) if it is closed.
() => {
  const select = document.querySelector(
    ".foliplus-heatmap-ctrl select[data-heatmap-layer]",
  );
  if (!select) return { ok: false, reason: "no-select" };
  const row = select.closest(".foliplus-form-row");
  const trigger = row ? row.querySelector(".foliplus-dropdown-trigger") : null;
  if (!trigger) return { ok: false, reason: "no-trigger" };
  const list = document.querySelector(".foliplus-dropdown-list");
  if (!list || list.hidden) trigger.click();
  return { ok: true };
};
