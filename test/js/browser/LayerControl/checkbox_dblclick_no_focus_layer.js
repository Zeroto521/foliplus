() => {
  const panel = document.querySelector(".foliplus-panel-content");
  if (!panel) return null;
  const items = Array.from(
    panel.querySelectorAll(".foliplus-layer-item:not(.foliplus-color-layer-item)"),
  );
  if (items.length === 0) return null;
  const row = items[0];
  const checkbox = row.querySelector('input[type="checkbox"]');
  if (!checkbox) return null;

  // Two quick toggles — the browser fires dblclick after the second click.
  checkbox.click();
  checkbox.click();

  return {
    focusing: row.classList.contains("foliplus-layer-focusing"),
    mask: Boolean(document.querySelector(".foliplus-focus-mask")),
    focusActive: Boolean(document.querySelector(".foliplus-focus-active")),
  };
};
