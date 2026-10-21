() => {
  const host = document.querySelector(".foliplus-style-zoom-range-control");
  if (!host) return { error: "zoom range slider not rendered" };
  const thumb = host.querySelectorAll(".foliplus-slider-thumb")[1];
  if (!thumb) return { error: "zoom range max thumb not rendered" };

  const row = document.querySelector('.foliplus-layer-item[data-layer-id="ng_gate"]');
  if (!row) return { error: "gate layer row not found" };
  const cb = row.querySelector('input[type="checkbox"]');
  if (!cb) return { error: "row checkbox not found" };

  // Read the cursor BEFORE focusing the checkbox: focusing a row descendant
  // re-homes the cursor by design, so a read after it cannot attribute the
  // cursor to the keypress under test.
  const rowFocused = !!document.querySelector(".foliplus-is-focused-row");
  cb.focus();
  return {
    sliderAfter: Number(thumb.getAttribute("aria-valuenow")),
    cbBefore: cb.checked,
    cbTag: cb.tagName.toLowerCase(),
    cbType: cb.type,
    focusedTag: document.activeElement.tagName.toLowerCase(),
    focusedType:
      document.activeElement.type || document.activeElement.getAttribute("role") || "",
    rowFocused,
    // The cursor state the checkbox focus alone left behind — the baseline the
    // keypress under test is measured against.
    rowFocusedAfterFocus: !!document.querySelector(".foliplus-is-focused-row"),
  };
};
