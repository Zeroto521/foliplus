// Opens the ⋮ → Style panel on the overlay row at *index*.
index => {
  const rows = Array.from(
    document.querySelectorAll(".foliplus-layer-item[data-layer-type=overlay]"),
  );
  if (rows.length === 0) return { ok: false, reason: "no-overlay-row" };
  const row = rows[index];
  if (!row) return { ok: false, reason: "row-out-of-range", n: rows.length };
  row.querySelector(".foliplus-layer-more-btn").click();
  const menu = row.querySelector(".foliplus-layer-more-menu.open");
  if (!menu) return { ok: false, reason: "menu-not-open" };
  // Tag-agnostic: the overflow menu renders native <button>s, and the row
  // contract is the data-action value, not the element name.
  const item = menu.querySelector('[data-action="style-layer"]');
  if (!item) return { ok: false, reason: "no-style-item" };
  item.click();
  const panel = row.querySelector(".foliplus-layer-style-panel");
  return { ok: !!panel, nRows: rows.length };
};
