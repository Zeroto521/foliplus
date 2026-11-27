// Appends clones of the last result row so the panel crosses its max-height.
count => {
  const panel = document.querySelector(".foliplus-search-result-panel");
  if (!panel) return { ok: false, reason: "no-panel" };
  const rows = panel.querySelectorAll(".foliplus-search-result-item");
  if (!rows.length) return { ok: false, reason: "no-row" };
  const template = rows[rows.length - 1];
  for (let i = 0; i < count; i++) panel.appendChild(template.cloneNode(true));
  return {
    ok: true,
    rows: panel.querySelectorAll(".foliplus-search-result-item").length,
  };
};
