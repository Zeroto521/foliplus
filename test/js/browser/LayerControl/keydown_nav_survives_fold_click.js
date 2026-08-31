() => {
  const panel = document.querySelector(".foliplus-panel-content");
  if (!panel) return null;
  const items = Array.from(
    panel.querySelectorAll(
      ".foliplus-layer-item:not(.foliplus-color-layer-item), .foliplus-layer-toggle-all",
    ),
  );
  if (items.length < 2) return null;

  const focusedRow = () => panel.querySelector(".foliplus-layer-focused");

  const focusedKey = () => {
    const row = focusedRow();
    return row
      ? row.getAttribute("data-layer-id") || row.getAttribute("data-group") || "unknown"
      : null;
  };

  const focusedVisible = row => !!row && row.style.display !== "none";
  const focusedFolded = row =>
    !!row && row.classList.contains("foliplus-layer-group-folded");

  // Establish the cursor on the first navigable row.
  items[0].focus();
  panel.dispatchEvent(
    new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
  );
  const beforeFold = focusedKey();

  // Fold the overlay group — the fold button lives inside a toggle-all row
  // that has no data-layer-id, which previously made the re-home miss and the
  // cursor (and DOM focus) fall off the panel entirely.
  const foldBtn = panel.querySelector(
    '.foliplus-layer-toggle-all[data-group="overlay"] .foliplus-layer-fold-btn',
  );
  if (!foldBtn) return null;
  foldBtn.click();

  const afterFold = focusedKey();
  const afterFoldRow = focusedRow();
  const afterFoldVisible = focusedVisible(afterFoldRow);
  const afterFoldFolded = focusedFolded(afterFoldRow);
  const focusInPanel = panel.contains(document.activeElement);

  // The cursor must never land on a folded-away row in either direction.
  // Reading the row itself (not just its key) is what makes this assertion
  // meaningful: a plain index ± 1 would leave the cursor on a display:none row.
  const keydown = key =>
    panel.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));

  keydown("ArrowDown");
  const afterDown = focusedKey();
  const afterDownRow = focusedRow();
  const afterDownVisible = focusedVisible(afterDownRow);
  const afterDownFolded = focusedFolded(afterDownRow);

  // ArrowUp must not land on a folded row either.
  keydown("ArrowUp");
  const afterUp = focusedKey();
  const afterUpRow = focusedRow();
  const afterUpVisible = focusedVisible(afterUpRow);
  const afterUpFolded = focusedFolded(afterUpRow);

  // ArrowUp again must clamp at the top rather than step off the list.
  keydown("ArrowUp");
  const afterUpClamped = focusedKey();

  // Enter must still toggle the row the cursor is now on — read that row's own
  // checkbox rather than assuming a fixed group.
  const cursorRow = panel.querySelector(".foliplus-layer-focused");
  const cb = cursorRow?.querySelector('input[type="checkbox"]') ?? null;
  const beforeChecked = cb ? cb.checked : null;
  keydown("Enter");
  const afterEnter = cb ? cb.checked : null;

  return {
    beforeFold,
    afterFold,
    afterFoldVisible,
    afterFoldFolded,
    focusInPanel,
    afterDown,
    afterDownVisible,
    afterDownFolded,
    afterUp,
    afterUpVisible,
    afterUpFolded,
    afterUpClamped,
    enterToggled: beforeChecked !== null && beforeChecked !== afterEnter,
  };
};
