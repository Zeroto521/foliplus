// Act on the Facility Points row's style panel: open it (default), pick a
// scheme from the author-scheme picker, pick the solid arm so the caller can
// assert the take-over repainted the map, or click Reset so the caller can
// assert the author's own paint came back.
arg => {
  const { solid = false, reset = false, scheme = "" } = arg ?? {};
  if (scheme) {
    const trigger = document.querySelector(".foliplus-style-scheme-trigger");
    if (!trigger) return { ok: false, reason: "no-scheme-trigger" };
    // The list may already be open (a previous step selected a disabled
    // entry, which leaves it mounted): open it only when needed.
    let item = document.querySelector(
      '.foliplus-scheme-picker-item[data-scheme-name="' + scheme + '"]',
    );
    if (!item) {
      trigger.click();
      item = document.querySelector(
        '.foliplus-scheme-picker-item[data-scheme-name="' + scheme + '"]',
      );
    }
    if (!item) return { ok: false, reason: "no-scheme-item" };
    item.click();
    return { ok: true };
  }
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
