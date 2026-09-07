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

  // Enter on a row with no menu open enters inline rename.
  const input = item.querySelector("input");
  if (!input) {
    return null;
  }
  input.focus();
  input.dispatchEvent(
    new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
  );

  // The rename teardown is deferred so the keydown can finish bubbling; the
  // input is still present here and the cursor must already be lifted.
  // handleKeyDown re-focuses the row that the rename started from — assert on
  // the marker it applies, which is what makes the cancel visible.
  const row = item;
  const result = {
    cursorCleared: !row.classList.contains("foliplus-layer-focused"),
    suppressed: row.classList.contains("foliplus-layer-focus-suppressed"),
  };
  return result;
};
