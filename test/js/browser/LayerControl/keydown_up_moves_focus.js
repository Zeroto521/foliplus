() => {
  const panel = document.querySelector(".foliplus-panel-content");
  if (!panel) return null;
  const items = Array.from(
    panel.querySelectorAll(
      ".foliplus-layer-item:not(.foliplus-color-layer-item), .foliplus-layer-toggle-all",
    ),
  );
  if (items.length < 2) return null;
  const lastItem = items[items.length - 1];
  lastItem.focus();
  lastItem.dispatchEvent(
    new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }),
  );
  const activeItem = panel.querySelector(".foliplus-layer-focused");
  const focusedId = activeItem
    ? activeItem.getAttribute("data-layer-id") || activeItem.getAttribute("data-group")
    : null;
  const expectedId = items[items.length - 2]
    ? items[items.length - 2].getAttribute("data-layer-id") ||
      items[items.length - 2].getAttribute("data-group")
    : null;
  return {
    focusedElement: focusedId,
    expectedElement: expectedId,
    totalItems: items.length,
  };
};
