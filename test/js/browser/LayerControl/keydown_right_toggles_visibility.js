() => {
  const panel = document.querySelector(".foliplus-panel-content");
  if (!panel) return null;
  const items = Array.from(panel.querySelectorAll(
    '.foliplus-layer-item:not(.foliplus-color-layer-item)'
  ));
  if (items.length === 0) return null;
  const item = items[0];
  item.focus();
  const checkbox = item.querySelector('input[type="checkbox"]');
  if (!checkbox) return null;
  const beforeState = checkbox.checked;
  item.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
  return {
    beforeState,
    afterState: checkbox.checked,
    toggled: beforeState !== checkbox.checked
  };
};