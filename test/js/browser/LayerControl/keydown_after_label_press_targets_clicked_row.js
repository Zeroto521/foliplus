() => {
  const panel = document.querySelector(".foliplus-panel-content");
  if (!panel) return null;
  const items = Array.from(
    panel.querySelectorAll(".foliplus-layer-item:not(.foliplus-color-layer-item)"),
  );
  if (items.length < 2) return null;

  // Anchor the keyboard cursor on the first row. The browser has already
  // seen the real pointer press on row 1's label (the test does that before
  // this snippet runs); only the keyboard route is exercised here.
  items[0].focus();
  items[0].dispatchEvent(
    new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
  );
  items[0].dispatchEvent(
    new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }),
  );

  // Enter must now target the row the pointer just selected, not the row the
  // arrow keys anchored. resolveActiveIdx() prefers document.activeElement
  // over ui.activeIdx, so a pointer that only re-homes ui.activeIdx would
  // make Enter resolve from the wrong row.
  const box = items[1].querySelector('input[type="checkbox"]');
  const beforeState = box.checked;
  items[1].dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  const afterState = box.checked;

  return {
    beforeState,
    afterState,
    toggled: beforeState !== afterState,
    // May be set: the arrow-key anchor keeps the keyboard route active, so
    // Chromium can still report :focus-visible for a focus the test moved.
    focusedRow:
      panel.querySelector(".foliplus-layer-focused")?.getAttribute("data-layer-id") ??
      null,
    expectedRow: items[1].getAttribute("data-layer-id"),
  };
};
