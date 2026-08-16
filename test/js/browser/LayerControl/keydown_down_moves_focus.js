() => {
  const panel = document.querySelector(".foliplus-panel-content");
  if (!panel) return null;
  const items = Array.from(
    panel.querySelectorAll(".foliplus-layer-item:not(.foliplus-color-layer-item), .foliplus-layer-toggle-all"),
  );
  if (items.length < 2) return null;
  const firstItem = items[0];
  firstItem.focus();
  firstItem.dispatchEvent(
    new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
  );
  const activeItem = panel.querySelector(".foliplus-layer-focused");
  const focusedId = activeItem
    ? (activeItem.getAttribute("data-layer-id") || activeItem.getAttribute("data-group"))
    : null;
  const expectedId = items[1]
    ? (items[1].getAttribute("data-layer-id") || items[1].getAttribute("data-group"))
    : null;
  return {
    focusedElement: focusedId,
    expectedElement: expectedId,
  };
};
