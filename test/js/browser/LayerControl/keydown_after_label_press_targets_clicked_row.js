() => {
  const panel = document.querySelector(".foliplus-panel-content");
  if (!panel) return null;
  const items = Array.from(
    panel.querySelectorAll(".foliplus-layer-item:not(.foliplus-color-layer-item)"),
  );
  if (items.length < 2) return null;

  // Activate the keyboard route from row 0 and leave ui.activeIdx there.
  // Arrow keys re-home the index without moving DOM focus, so the pointer
  // press's focus on row 1 survives; dispatching from items[0] makes the
  // event target row 0, so neither call can re-anchor focus.
  //
  // Load-bearing: resolveActiveIdx() prefers document.activeElement over
  // ui.activeIdx, so an items[0].focus() here would make Enter resolve from
  // row 0 and toggled read False. Keyboard navigation in foliplus is
  // Enter/arrow-driven, not focus-driven, so there is no reason to move
  // focus at all.
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
