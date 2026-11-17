// Sets the border mode (and optionally colour/weight) through the style
// panel for one layer, then returns true. Used by the browser test to
// assert that a user solid choice overrides a declared follow_fill.
// Synchronous (no Promise/setTimeout).
([name, mode, color, weight]) => {
  const api = window.map.foliplus && window.map.foliplus.LayerAPI;
  let row = document.querySelector(
    `[data-layer-id="${CSS.escape(name)}"][data-layer-type]`,
  );
  if (!row)
    row = Array.from(
      document.querySelectorAll('[data-layer-type]:not([data-layer-type="base"])'),
    ).find(r => r.textContent.includes(name));
  if (!row) return false;
  let panel = row.querySelector(".foliplus-layer-style-panel");
  if (!panel) {
    row.querySelector(".foliplus-layer-more-btn").click();
    const it = row.querySelector(
      '.foliplus-layer-more-menu button[data-action="style-layer"]',
    );
    it.click();
    panel = row.querySelector(".foliplus-layer-style-panel");
  }
  const sel = panel.querySelector(".foliplus-style-border-mode-select");
  if (sel) {
    sel.value = mode;
    sel.dispatchEvent(new Event("change", { bubbles: true }));
  }
  const col = panel.querySelector(".foliplus-style-border-color-input");
  if (col && color && !col.disabled) {
    col.value = color;
    col.dispatchEvent(new Event("input", { bubbles: true }));
  }
  return true;
};
