// Test-only geometry fixture: appends clones of the last result row so the
// panel crosses its max-height. The clones are NOT registered with the list
// cursor (cloneNode(true) copies ids / aria-activedescendant targets), so this
// must only ever drive layout measurement, never selection.
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
