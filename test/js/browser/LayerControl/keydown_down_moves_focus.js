() => {
  const panel = document.querySelector(".foliplus-panel-content");
  if (!panel) return null;
  const items = Array.from(
    panel.querySelectorAll(".foliplus-layer-item:not(.foliplus-color-layer-item)"),
  );
  if (items.length < 2) return null;
  const firstItem = items[0];
  firstItem.focus();
  firstItem.dispatchEvent(
    new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
  );
  const activeItem = panel.querySelector(".foliplus-layer-focused");
  return {
    focusedElement: activeItem ? activeItem.getAttribute("data-layer-id") : null,
    expectedElement: items[1].getAttribute("data-layer-id"),
  };
};
