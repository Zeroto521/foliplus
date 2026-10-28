() => {
  const row = document.querySelector(
    '.foliplus-layer-item[data-layer-id="foliplus_measure"]',
  );
  if (!row) return { ok: false, reason: "no-row" };
  row.querySelector(".foliplus-layer-more-btn").click();
  const item = row.querySelector(
    '.foliplus-layer-more-menu li[data-action="filter-layer"]',
  );
  if (!item) return { ok: false, reason: "no-filter-entry" };
  item.click();
  return { ok: true };
};
