() => {
  // Toggle the color basemap's real checkbox (not the color picker).
  const row = document.querySelector(
    '.foliplus-layer-item[data-layer-id="foliplus_color_map"]',
  );
  if (!row) return { ok: false, reason: "no color row" };
  const cb = row.querySelector('input[type="checkbox"]');
  if (!cb) return { ok: false, reason: "no checkbox on color row" };
  cb.click();
  return { ok: true, checked: cb.checked };
};
