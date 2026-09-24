() => {
  // Toggle the colour basemap's real checkbox (not the colour picker).
  const row = document.querySelector(".foliplus-color-layer-item");
  if (!row) return { ok: false, reason: "no color row" };
  const cb = row.querySelector('input[type="checkbox"]');
  if (!cb) return { ok: false, reason: "no checkbox on color row" };
  cb.click();
  return { ok: true, checked: cb.checked };
};
