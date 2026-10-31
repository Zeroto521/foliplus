() => {
  const rows = [
    ...document.querySelectorAll(".foliplus-layer-item[data-layer-type=overlay]"),
  ];
  const row = rows.find(r => r.textContent.includes("Polygon data"));
  if (!row) return { ok: false, reason: "no-polygon-row" };
  row.querySelector(".foliplus-layer-more-btn").click();
  const menu = row.querySelector(".foliplus-layer-more-menu.open");
  if (!menu) return { ok: false, reason: "menu-not-open" };
  const item = menu.querySelector('li[data-action="style-layer"]');
  if (!item) return { ok: false, reason: "no-style-item" };
  item.click();
  return { ok: !!row.querySelector(".foliplus-layer-style-panel") };
};
