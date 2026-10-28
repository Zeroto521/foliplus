// Open the overflow menu of the Nth overlay row and put real focus on the
// entry for `action`, so the caller can press a real activation key (Enter or
// Space). Also reports whether the entry is disabled and whether focus landed
// on it — a key pressed anywhere else would test the wrong path.
arg => {
  const { action, rowIndex = 0 } = arg ?? {};
  const rows = document.querySelectorAll(
    ".foliplus-layer-item[data-layer-type=overlay]",
  );
  const row = rows[rowIndex];
  if (!row) return { error: "no overlay row " + rowIndex };
  const more = row.querySelector(".foliplus-layer-more-btn");
  if (!more) return { error: "no more button" };
  more.click();
  const li = row.querySelector(
    '.foliplus-layer-more-menu li[data-action="' + action + '"]',
  );
  if (!li) return { error: "no menu entry " + action };
  li.focus();
  return {
    layerId: row.getAttribute("data-layer-id") ?? "",
    menuOpen: !!row.querySelector(".foliplus-layer-more-menu.open"),
    disabled: li.getAttribute("disabled") === "disabled",
    focused: document.activeElement === li,
  };
};
