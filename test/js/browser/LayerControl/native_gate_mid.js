() => {
  const slider = document.querySelector(".foliplus-style-zoom-range-max");
  if (!slider) return { error: "zoom range max slider not rendered" };

  const row = document.querySelector('.foliplus-layer-item[data-layer-id="ng_gate"]');
  if (!row) return { error: "gate layer row not found" };
  const cb = row.querySelector('input[type="checkbox"]');
  if (!cb) return { error: "row checkbox not found" };

  // Read the cursor BEFORE focusing the checkbox: focusing a row descendant
  // re-homes the cursor by design, so a read after it cannot attribute the
  // cursor to the keypress under test.
  const rowFocused = !!document.querySelector(".foliplus-layer-focused");
  cb.focus();
  return {
    sliderAfter: Number(slider.value),
    cbBefore: cb.checked,
    cbTag: cb.tagName.toLowerCase(),
    cbType: cb.type,
    focusedTag: document.activeElement.tagName.toLowerCase(),
    focusedType: document.activeElement.type,
    rowFocused,
    // The cursor state the checkbox focus alone left behind — the baseline the
    // keypress under test is measured against.
    rowFocusedAfterFocus: !!document.querySelector(".foliplus-layer-focused"),
  };
};
