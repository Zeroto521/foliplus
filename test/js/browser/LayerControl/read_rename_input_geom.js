// Measures the inline-rename input against the row's own geometry so we can
// assert the padding is dropped while renaming (the row must not grow).
() => {
  const row = [...document.querySelectorAll(".foliplus-layer-item")].find(r =>
    r.querySelector(".foliplus-layer-rename-input"),
  );
  const input = row?.querySelector(".foliplus-layer-rename-input");
  if (!row || !input) return null;
  const rr = row.getBoundingClientRect();
  const ir = input.getBoundingClientRect();
  return {
    rowH: Math.round(rr.height),
    inputH: Math.round(ir.height),
    inputX: Math.round(ir.x),
    labelX: Math.round(
      row.querySelector(".foliplus-layer-label").getBoundingClientRect().x,
    ),
    padTop: getComputedStyle(row).paddingTop,
    padBottom: getComputedStyle(row).paddingBottom,
  };
};
