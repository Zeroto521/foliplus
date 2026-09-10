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
  item.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));

  // Enter without a more-menu open toggles visibility; the keyboard cursor
  // stays on the row. Escape must lift the JS class and leave DOM focus
  // wherever the user was (the checkbox here) — never blur to <body>.
  const checkbox = item.querySelector('input[type="checkbox"]');
  if (!checkbox) return null;
  checkbox.focus();
  checkbox.dispatchEvent(
    new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
  );

  return {
    cursorCleared: !item.classList.contains("foliplus-layer-focused"),
    // Focus stays inside the row (checkbox or the row itself).
    focused: document.activeElement === item || item.contains(document.activeElement),
    suppressLeft: Boolean(panel.querySelector(".foliplus-layer-focus-suppressed")),
  };
};
