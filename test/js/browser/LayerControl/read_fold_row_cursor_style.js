() => {
  const panel = document.querySelector(".foliplus-panel-content");
  if (!panel) return null;
  const items = Array.from(
    panel.querySelectorAll(
      ".foliplus-layer-item:not(.foliplus-color-layer-item), .foliplus-layer-toggle-all",
    ),
  );
  if (items.length < 2) return null;
  const foldRow = items[0];
  const btn = foldRow.querySelector(".foliplus-layer-fold-btn");
  const restIcon = btn ? getComputedStyle(btn).color : null;
  // ArrowDown onto the first data item, then ArrowUp onto the fold (toggle-all)
  // row, so the keyboard cursor is on the group header. The fold icon must wake
  // (flip colour) like it does on hover — red if the group is expanded (preview
  // "will fold"), black if folded (preview "will expand").
  const first = items[0];
  first.focus();
  first.dispatchEvent(
    new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
  );
  const dataRow = panel.querySelector(".foliplus-layer-focused");
  if (!dataRow) return { error: "no data-row cursor after ArrowDown" };
  dataRow.dispatchEvent(
    new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }),
  );
  const fold = panel.querySelector(".foliplus-layer-focused");
  if (!fold) return { error: "no fold cursor after ArrowUp" };
  const cs = getComputedStyle(fold);
  const cursorBtn = fold.querySelector(".foliplus-layer-fold-btn");
  return {
    isFold: fold.classList.contains("foliplus-layer-toggle-all"),
    bg: cs.backgroundColor,
    shadow: cs.boxShadow,
    folded: fold.classList.contains("foliplus-layer-folded"),
    restIcon,
    cursorIcon: cursorBtn ? getComputedStyle(cursorBtn).color : null,
  };
};
