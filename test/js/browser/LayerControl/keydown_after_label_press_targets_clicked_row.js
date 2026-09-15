() => {
  const panel = document.querySelector(".foliplus-panel-content");
  if (!panel) return null;
  const items = Array.from(
    panel.querySelectorAll(".foliplus-layer-item:not(.foliplus-color-layer-item)"),
  );
  if (items.length < 2) return null;

  // Anchor the keyboard cursor on the first row.
  items[0].focus();
  items[0].dispatchEvent(
    new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
  );
  items[0].dispatchEvent(
    new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }),
  );

  // Pointer-click the second row. A real label click focuses the row's
  // checkbox (the label is unlabelled, so focus lands there rather than on
  // the label itself) and toggles its `checked` — the click handler resolves
  // visibility from the layer list, not `checked`, so the click itself does
  // not toggle. The press must NOT paint the cursor visual, only re-home the
  // keyboard index so Enter hits the right row.
  const box = items[1].querySelector('input[type="checkbox"]');
  const beforeState = box.checked;
  const label = items[1].querySelector(".foliplus-layer-label");
  if (!label) return null;
  label.click();

  // Enter must now target the row the pointer just selected, not the first row.
  items[1].dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  const afterState = box.checked;

  return {
    beforeState,
    afterState,
    toggled: beforeState !== afterState,
    // May be set: after keyboard nav Chromium can still report
    // :focus-visible on the next mouse focus, and focusin lights the row.
    focusedRow:
      panel.querySelector(".foliplus-layer-focused")?.getAttribute("data-layer-id") ??
      null,
    expectedRow: items[1].getAttribute("data-layer-id"),
  };
};
