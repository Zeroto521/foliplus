() => {
  const panel = document.querySelector(".foliplus-panel-content");
  if (!panel) return null;
  const items = Array.from(
    panel.querySelectorAll(".foliplus-layer-item:not(.foliplus-color-layer-item)"),
  );
  if (items.length < 2) return null;
  const lastItem = items[items.length - 1];
  lastItem.focus();
  lastItem.dispatchEvent(
    new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }),
  );
  const activeItem = panel.querySelector(".foliplus-layer-focused");
  return {
    focusedElement: activeItem ? activeItem.getAttribute("data-layer-id") : null,
    expectedElement: items[items.length - 2].getAttribute("data-layer-id"),
    totalItems: items.length,
  };
};
