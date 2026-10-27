// Act on the Facility Points row's style panel: open it (default), pick the
// solid fill arm so the caller can assert the take-over repainted the map, or
// click the panel's Reset so the caller can assert the author's per-feature
// paint came back.
arg => {
  const { solid = false, reset = false } = arg ?? {};
  if (solid) {
    const select = document.querySelector(".foliplus-style-fill-mode-select");
    if (!select) return { ok: false, reason: "no-mode-select" };
    select.value = "solid";
    select.dispatchEvent(new Event("change", { bubbles: true }));
    return { ok: true };
  }
  if (reset) {
    const btn = document.querySelector(".foliplus-style-reset-btn");
    if (!btn) return { ok: false, reason: "no-reset-button" };
    btn.click();
    return { ok: true };
  }
  const row = [
    ...document.querySelectorAll(".foliplus-layer-item[data-layer-type=overlay]"),
  ].find(r => r.textContent.includes("Facility Points"));
  if (!row) return { ok: false, reason: "no-row" };
  row.querySelector(".foliplus-layer-more-btn").click();
  const menu = row.querySelector(".foliplus-layer-more-menu.open");
  if (!menu) return { ok: false, reason: "no-menu" };
  const item = menu.querySelector('li[data-action="style-layer"]');
  if (!item) return { ok: false, reason: "no-style-item" };
  item.click();
  return { ok: !!row.querySelector(".foliplus-layer-style-panel") };
};
