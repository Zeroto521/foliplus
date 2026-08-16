() => {
  const panel = document.querySelector(".foliplus-panel-content");
  if (!panel) return null;
  const items = Array.from(
    panel.querySelectorAll(".foliplus-layer-item:not(.foliplus-color-layer-item)"),
  );
  if (items.length === 0) return null;
  const item = items[0];
  item.focus();
  item.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
  const beforeEscape = panel.querySelector(".foliplus-layer-focused");
  item.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  const afterEscape = panel.querySelector(".foliplus-layer-focused");
  return {
    beforeEscape: !!beforeEscape,
    afterEscape: !!afterEscape,
    focusCleared: !afterEscape,
  };
};
