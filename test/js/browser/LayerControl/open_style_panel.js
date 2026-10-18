// Opens the ⋮ → Style panel on the first overlay-type row.
// Returns whether the panel is open and ready for interaction.
() => {
  const ROW = ".foliplus-layer-item[data-layer-type=overlay]";
  const row = document.querySelector(ROW);
  if (!row) return { ok: false, reason: "no-overlay-row" };
  row.querySelector(".foliplus-layer-more-btn").click();
  const menu = row.querySelector(".foliplus-layer-more-menu.open");
  if (!menu) return { ok: false, reason: "menu-not-open" };
  const item = menu.querySelector('li[data-action="style-layer"]');
  if (!item) return { ok: false, reason: "no-style-item" };
  item.click();
  const panel = row.querySelector(".foliplus-layer-style-panel");
  return { ok: !!panel };
};
